//! Explicit-content commits for a history repo addressed by path.
//!
//! The caller (realm-server) stages every file's final bytes and asks deckd to
//! record exactly those changes as one revision on top of `parent`. Nothing is
//! read from a working copy: the repo has no workspace, so a revision can never
//! pick up bytes some other request left on disk.
//!
//! Layout under `repo` (the caller chooses where that directory lives):
//!
//! ```text
//! <repo>/
//!   jj/                       # bare jj repo, internal git backend
//!   deckd/HEAD                # recorded HEAD; locked around every call
//!   deckd/operations/<opId>   # `pending <digest>` | `committed <rev> <digest>` | `fenced`
//! ```
//!
//! Correctness rests on files in the repo, never on this process's memory:
//!
//! - `commit`, `outcome` and `head` hold an exclusive lock on `deckd/HEAD`,
//!   which is never deleted, so deckd processes on different hosts sharing the
//!   directory serialize. A per-repo in-process mutex sits in front of it
//!   because Linux NFS emulates flock with POSIX locks, which don't exclude
//!   threads of one process. The mutex is keyed by the directory's device and
//!   inode, so every spelling of one repo shares it.
//! - `deckd/HEAD` holds the revision deckd last recorded, written before jj
//!   publishes it. It is read through the locked descriptor, and taking an NFS
//!   lock revalidates that file's cached data, so it is current even when this
//!   host's listing of jj's operation heads is stale. jj's HEAD must equal it
//!   before anything is written. When jj is exactly one commit behind (a crash
//!   between recording and publishing, or a stale listing), the recorded
//!   commit is published again, which is idempotent. Any other disagreement is
//!   reloaded until it settles, then refused as `HistoryUnsettled`.
//! - A revision is recorded only after its git objects are on stable storage,
//!   so `deckd/HEAD` never names a commit a power loss could take away.
//! - Whether an operation record exists is only ever learned from
//!   `create_new` (O_EXCL), which the NFS server answers. A peer's cached
//!   negative lookup can't make an existing record look absent. Records and
//!   the directory entries naming them are synced before a call returns.
//! - Every commit carries a `Deckd-Operation-Id` trailer. Before acting, each
//!   locked call sets HEAD's operation record to `committed HEAD`. A crash
//!   after publishing but before writing the record can only leave HEAD
//!   unrecorded, so after that repair every committed operation has a record.
//! - A record keeps a digest of the request that claimed it. Replaying a
//!   committed operation with a different request is refused, so a reused
//!   operation ID can't silently drop a write.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs::{File, OpenOptions, TryLockError};
use std::io::{ErrorKind, Read as _, Seek as _, SeekFrom, Write as _};
use std::os::unix::fs::MetadataExt as _;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, TryLockError as MutexTryLockError, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures::AsyncReadExt as _;
use jj_lib::backend::{BackendError, CommitId, CopyId, Signature, Timestamp, TreeValue};
use jj_lib::commit::Commit;
use jj_lib::default_backend_factories::default_backend_factories;
use jj_lib::merge::Merge;
use jj_lib::merged_tree::MergedTree;
use jj_lib::merged_tree_builder::MergedTreeBuilder;
use jj_lib::object_id::ObjectId as _;
use jj_lib::repo::{ReadonlyRepo, Repo as _, RepoLoader};
use jj_lib::repo_path::{RepoPath, RepoPathBuf};
use jj_lib::signing_factory::signer_from_settings;
use jj_lib::trailer::parse_description_trailers;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use super::jj_lib::{hermetic_git_env, is_valid_history_path, user_settings};

/// Trailer deckd adds to every explicit commit. Callers may not set it.
const OPERATION_ID_TRAILER: &str = "Deckd-Operation-Id";

/// How long a call waits for the repo's locks before giving up.
const LOCK_TIMEOUT: Duration = if cfg!(test) {
    Duration::from_secs(5)
} else {
    Duration::from_secs(30)
};

/// How long a call waits for jj's HEAD to agree with `deckd/HEAD`.
const SETTLE_TIMEOUT: Duration = if cfg!(test) {
    Duration::from_millis(300)
} else {
    Duration::from_secs(5)
};

#[derive(Debug, thiserror::Error)]
pub enum CommitError {
    #[error("{0}")]
    Invalid(String),
    #[error("parent {parent} is not HEAD {head}")]
    ParentMismatch { parent: String, head: String },
    #[error("operation {0} was reported absent and can never commit")]
    OperationFenced(String),
    #[error("operation {operation_id} already committed a different request as {revision}")]
    OperationMismatch {
        operation_id: String,
        revision: String,
    },
    #[error("revision {0} not found")]
    RevisionNotFound(String),
    #[error("timed out waiting for the commit lock on {0}")]
    LockTimeout(String),
    #[error("history HEAD {observed} does not match recorded HEAD {recorded}; retry")]
    HistoryUnsettled { recorded: String, observed: String },
    #[error("{0}")]
    Internal(String),
}

type CommitResult<T> = Result<T, CommitError>;

fn internal(error: impl std::fmt::Display) -> CommitError {
    CommitError::Internal(error.to_string())
}

#[derive(Debug, Clone, Deserialize)]
pub struct Author {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CommitTrailer {
    pub key: String,
    pub value: String,
}

/// One staged path: new bytes, or a delete.
#[derive(Debug, Clone)]
pub struct Change {
    pub path: String,
    pub content: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct CommitRequest {
    pub parent: String,
    pub operation_id: String,
    pub author: Author,
    pub message: String,
    pub trailers: Vec<CommitTrailer>,
    pub changes: Vec<Change>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommitOutcome {
    pub revision: String,
    pub tree: String,
    /// False when the changes left the tree as it was and no revision was
    /// written; `revision` is then the unchanged HEAD.
    pub created: bool,
    /// True when this operation ID had already committed and nothing new
    /// was written.
    pub replayed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum OperationOutcome {
    Committed { revision: String },
    Absent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RevisionTree {
    pub revision: String,
    pub tree: String,
}

/// One file in a revision's tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TreeEntry {
    pub path: String,
    /// The git blob ID of the file's bytes.
    pub blob: String,
    pub executable: bool,
}

/// A path's bytes at a revision, or `None` where the revision has no file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileContent {
    pub path: String,
    pub content: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadResult {
    pub files: Vec<FileContent>,
    /// The paths asked for and not read, because reading them would have
    /// taken the answer past `READ_MAX_BYTES`.
    pub remaining: Vec<String>,
}

/// The most file content one `read` returns. The answer is base64 in one JSON
/// body, a third larger again, and is held in memory on both sides.
pub const READ_MAX_BYTES: usize = if cfg!(test) { 16 } else { 32 * 1024 * 1024 };

/// Explicit-content commits, operation outcomes and tree hashes. Holds no
/// state that correctness depends on; a fresh instance behaves exactly like
/// one that has been running.
pub struct CommitService {
    /// When set, every repo must resolve to a directory inside it.
    root: Option<PathBuf>,
    gates: Mutex<Gates>,
}

/// In-process gates by the repo directory's (device, inode). Entries no call
/// holds are pruned, so the map only grows with concurrent repos.
type Gates = HashMap<(u64, u64), Weak<Mutex<()>>>;

impl Default for CommitService {
    fn default() -> Self {
        Self::new()
    }
}

impl CommitService {
    /// A service that accepts any absolute repo path.
    pub fn new() -> Self {
        hermetic_git_env();
        Self {
            root: None,
            gates: Mutex::new(HashMap::new()),
        }
    }

    /// A service that refuses repos outside `root`, which must exist.
    pub fn with_root(root: &Path) -> std::io::Result<Self> {
        Ok(Self {
            root: Some(std::fs::canonicalize(root)?),
            ..Self::new()
        })
    }

    /// Record `request.changes` as one revision on top of `request.parent`.
    /// Runs on a blocking thread: it waits on locks and drives jj-lib's
    /// `!Send` futures to completion while holding them.
    pub fn commit(&self, repo_dir: &Path, request: CommitRequest) -> CommitResult<CommitOutcome> {
        validate_operation_id(&request.operation_id)?;
        validate_commit_request(&request)?;
        self.locked(repo_dir, |repo_dir, head_file| {
            pollster::block_on(commit_locked(repo_dir, head_file, request))
        })
    }

    /// Report whether `operation_id` committed. Reporting it absent fences it:
    /// from then on a commit with that ID is refused.
    pub fn outcome(&self, repo_dir: &Path, operation_id: &str) -> CommitResult<OperationOutcome> {
        validate_operation_id(operation_id)?;
        self.locked(repo_dir, |repo_dir, head_file| {
            pollster::block_on(outcome_locked(repo_dir, head_file, operation_id))
        })
    }

    /// The current HEAD, creating an empty repo (HEAD is the root commit) if
    /// there is none yet.
    pub fn head(&self, repo_dir: &Path) -> CommitResult<RevisionTree> {
        let head = self.locked(repo_dir, |repo_dir, head_file| {
            pollster::block_on(settled_head(repo_dir, head_file)).map(|(_repo, head)| head)
        })?;
        Ok(RevisionTree {
            revision: head.id().hex(),
            tree: tree_hash(&head),
        })
    }

    /// The tree of `revision`, which must be in the repo's history: a commit
    /// object that was written but never published is not found.
    pub fn tree_hash(&self, repo_dir: &Path, revision: &str) -> CommitResult<RevisionTree> {
        let (_repo, commit) = self.published(repo_dir, revision)?;
        Ok(RevisionTree {
            revision: commit.id().hex(),
            tree: tree_hash(&commit),
        })
    }

    /// Every file in `revision`'s tree with its git blob ID, in path order.
    /// The blob ID is the git object ID of the file's bytes, so a caller can
    /// tell whether a file on disk matches without reading it out of history.
    pub fn tree(&self, repo_dir: &Path, revision: &str) -> CommitResult<Vec<TreeEntry>> {
        let (_repo, commit) = self.published(repo_dir, revision)?;
        let mut entries = Vec::new();
        for (path, value) in commit.tree().entries() {
            let path = path.as_internal_file_string().to_owned();
            match value.map_err(internal)?.into_resolved() {
                Ok(Some(TreeValue::File { id, executable, .. })) => entries.push(TreeEntry {
                    path,
                    blob: id.hex(),
                    executable,
                }),
                // Explicit commits write only regular files, so anything else
                // is a repo this service did not write.
                _ => {
                    return Err(CommitError::Internal(format!(
                        "{path:?} is not a regular file in revision {revision}"
                    )))
                }
            }
        }
        Ok(entries)
    }

    /// The bytes `revision` holds at each of `paths`, in the order asked, or
    /// `None` for a path that is absent or a directory there. Stops before the
    /// file that would take the content past `READ_MAX_BYTES` (unless it is
    /// the first), returning the paths it did not read as `remaining`, so a
    /// caller reads a large set in several calls.
    pub fn read(
        &self,
        repo_dir: &Path,
        revision: &str,
        paths: &[String],
    ) -> CommitResult<ReadResult> {
        for path in paths {
            if !is_valid_commit_path(path) {
                return Err(CommitError::Invalid(format!("invalid path {path:?}")));
            }
        }
        let (repo, commit) = self.published(repo_dir, revision)?;
        pollster::block_on(async {
            let tree = commit.tree();
            let mut files = Vec::new();
            let mut total = 0usize;
            for (index, path) in paths.iter().enumerate() {
                let repo_path = RepoPathBuf::from_internal_string(path.clone())
                    .map_err(|e| CommitError::Invalid(format!("invalid path {path:?}: {e}")))?;
                let value = tree.path_value(&repo_path).await.map_err(internal)?;
                let content = match value.as_resolved() {
                    Some(Some(TreeValue::File { id, .. })) => {
                        let mut bytes = Vec::new();
                        repo.store()
                            .read_file(&repo_path, id)
                            .await
                            .map_err(internal)?
                            .read_to_end(&mut bytes)
                            .await
                            .map_err(internal)?;
                        Some(bytes)
                    }
                    _ => None,
                };
                let size = content.as_ref().map_or(0, Vec::len);
                if index > 0 && total + size > READ_MAX_BYTES {
                    return Ok(ReadResult {
                        files,
                        remaining: paths[index..].to_vec(),
                    });
                }
                total += size;
                files.push(FileContent {
                    path: path.clone(),
                    content,
                });
            }
            Ok(ReadResult {
                files,
                remaining: Vec::new(),
            })
        })
    }

    /// The repo and `revision` as a commit in its history. Reads without the
    /// repo locks, and takes them only when this host's view doesn't show the
    /// revision, which settles HEAD first.
    fn published(
        &self,
        repo_dir: &Path,
        revision: &str,
    ) -> CommitResult<(Arc<ReadonlyRepo>, Commit)> {
        let repo_dir = self.resolve_repo_dir(repo_dir)?;
        let not_found = || CommitError::RevisionNotFound(revision.to_owned());
        let id = CommitId::try_from_hex(revision).ok_or_else(not_found)?;
        // Load first rather than testing for `jj/`: a cached negative lookup
        // must not turn an existing revision into a 404.
        let repo = match pollster::block_on(load_repo(&repo_dir)) {
            Ok(repo) => repo,
            Err(_) if !repo_dir.join("jj").exists() => return Err(not_found()),
            Err(error) => return Err(error),
        };
        let heads: Vec<CommitId> = repo.view().heads().iter().cloned().collect();
        if let Some(commit) = pollster::block_on(published_commit(&repo, &heads, &id))? {
            return Ok((repo, commit));
        }
        // Unlocked, this host's listing may not show a peer's latest commit
        // yet. Only a miss pays for the lock, which settles HEAD.
        self.locked(&repo_dir, |repo_dir, head_file| {
            pollster::block_on(async {
                let (repo, head) = settled_head(repo_dir, head_file).await?;
                let commit = published_commit(&repo, &[head.id().clone()], &id).await?;
                Ok(commit.map(|commit| (repo, commit)))
            })
        })?
        .ok_or_else(not_found)
    }

    /// Run `body` holding both repo locks, with the resolved repo directory
    /// and the locked `deckd/HEAD`. Both locks share one `LOCK_TIMEOUT`, so a
    /// busy or stuck repo can't park blocking threads indefinitely.
    fn locked<T>(
        &self,
        repo_dir: &Path,
        body: impl FnOnce(&Path, &mut File) -> CommitResult<T>,
    ) -> CommitResult<T> {
        let repo_dir = self.resolve_repo_dir(repo_dir)?;
        create_repo_dir(&repo_dir)?;
        let deadline = Instant::now() + LOCK_TIMEOUT;
        let gate = self.gate(&repo_dir)?;
        let _in_process = lock_gate(&gate, &repo_dir, deadline)?;
        let mut head_file = lock_repo(&repo_dir, deadline)?;
        body(&repo_dir, &mut head_file)
    }

    /// `repo_dir` with symlinks resolved. Its parent (normally the realm
    /// directory) must exist, so a mistyped path fails instead of quietly
    /// growing a new tree; the repo directory itself need not.
    fn resolve_repo_dir(&self, repo_dir: &Path) -> CommitResult<PathBuf> {
        validate_repo_dir(repo_dir)?;
        let (Some(parent), Some(name)) = (repo_dir.parent(), repo_dir.file_name()) else {
            return Err(CommitError::Invalid("repo must name a directory".into()));
        };
        let missing_parent = || {
            CommitError::Invalid(format!(
                "parent directory of {} does not exist",
                repo_dir.display()
            ))
        };
        let parent = std::fs::canonicalize(parent).map_err(|_| missing_parent())?;
        let mut resolved = parent.join(name);
        if resolved.is_symlink() {
            resolved = std::fs::canonicalize(&resolved).map_err(|_| missing_parent())?;
        }
        if let Some(root) = &self.root {
            if !resolved.starts_with(root) || resolved == *root {
                return Err(CommitError::Invalid(format!(
                    "repo must be inside {}",
                    root.display()
                )));
            }
        }
        Ok(resolved)
    }

    fn gate(&self, repo_dir: &Path) -> CommitResult<Arc<Mutex<()>>> {
        let metadata = std::fs::metadata(repo_dir).map_err(internal)?;
        let key = (metadata.dev(), metadata.ino());
        let mut gates = self.gates.lock().unwrap_or_else(|e| e.into_inner());
        gates.retain(|_, gate| gate.strong_count() > 0);
        if let Some(gate) = gates.get(&key).and_then(Weak::upgrade) {
            return Ok(gate);
        }
        let gate = Arc::new(Mutex::new(()));
        gates.insert(key, Arc::downgrade(&gate));
        Ok(gate)
    }
}

/// Take a repo's in-process gate, giving up at `deadline`.
fn lock_gate<'a>(
    gate: &'a Mutex<()>,
    repo_dir: &Path,
    deadline: Instant,
) -> CommitResult<MutexGuard<'a, ()>> {
    loop {
        match gate.try_lock() {
            Ok(guard) => return Ok(guard),
            Err(MutexTryLockError::Poisoned(poisoned)) => return Ok(poisoned.into_inner()),
            Err(MutexTryLockError::WouldBlock) if Instant::now() >= deadline => {
                return Err(CommitError::LockTimeout(repo_dir.display().to_string()))
            }
            Err(MutexTryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
}

/// The body of [`CommitService::commit`]. Callers hold both repo locks.
async fn commit_locked(
    repo_dir: &Path,
    head_file: &mut File,
    request: CommitRequest,
) -> CommitResult<CommitOutcome> {
    let (repo, head) = settled_head(repo_dir, head_file).await?;
    repair_head_record(repo_dir, &head)?;

    let digest = request_digest(&request);
    let record_path = operation_record_path(repo_dir, &request.operation_id);
    if !claim_record(&record_path, &Record::Pending(Some(digest.clone())))? {
        match read_record(&record_path)? {
            Record::Committed {
                revision,
                digest: recorded,
            } => {
                if recorded.is_some_and(|recorded| recorded != digest) {
                    return Err(CommitError::OperationMismatch {
                        operation_id: request.operation_id,
                        revision,
                    });
                }
                let commit = get_commit(&repo, &revision)?;
                return Ok(CommitOutcome {
                    revision,
                    tree: tree_hash(&commit),
                    created: false,
                    replayed: true,
                });
            }
            Record::Fenced => {
                return Err(CommitError::OperationFenced(request.operation_id));
            }
            // A crashed attempt that never published: the repair above
            // would have marked it committed if it had. Take it over, so a
            // replay is checked against this request.
            Record::Pending(_) => {
                write_record(&record_path, &Record::Pending(Some(digest.clone())))?;
            }
        }
    }

    let head_hex = head.id().hex();
    if CommitId::try_from_hex(&request.parent).as_ref() != Some(head.id()) {
        // Leave no claim behind, so the caller can retry this operation
        // on the new HEAD.
        remove_record(&record_path)?;
        return Err(CommitError::ParentMismatch {
            parent: request.parent,
            head: head_hex,
        });
    }

    let tree = match build_tree(&repo, &head, &request.changes).await {
        Ok(tree) => tree,
        Err(error) => {
            remove_record(&record_path)?;
            return Err(error);
        }
    };
    if tree.tree_ids() == head.tree_ids() {
        write_record(
            &record_path,
            &Record::Committed {
                revision: head_hex.clone(),
                digest: Some(digest),
            },
        )?;
        return Ok(CommitOutcome {
            revision: head_hex,
            tree: tree_hash(&head),
            created: false,
            replayed: false,
        });
    }

    let signature = Signature {
        name: request.author.name.clone(),
        email: request.author.email.clone(),
        timestamp: Timestamp::now(),
    };
    let mut tx = repo.start_transaction();
    let commit = tx
        .repo_mut()
        .new_commit(vec![head.id().clone()], tree)
        .set_description(description(&request))
        .set_author(signature.clone())
        .set_committer(signature)
        .write()
        .await
        .map_err(internal)?;
    let revision = commit.id().hex();
    sync_new_objects(repo_dir, &commit, &request.changes).await?;
    // The commit point: from here a crash leaves this revision as HEAD, and
    // the next locked call publishes it if jj hasn't.
    write_recorded_head(head_file, &revision)?;
    tx.commit(format!(
        "commit {revision} for operation {}",
        request.operation_id
    ))
    .await
    .map_err(internal)?;

    write_record(
        &record_path,
        &Record::Committed {
            revision: revision.clone(),
            digest: Some(digest),
        },
    )?;
    Ok(CommitOutcome {
        revision,
        tree: tree_hash(&commit),
        created: true,
        replayed: false,
    })
}

/// The body of [`CommitService::outcome`]. Callers hold both repo locks.
async fn outcome_locked(
    repo_dir: &Path,
    head_file: &mut File,
    operation_id: &str,
) -> CommitResult<OperationOutcome> {
    let (_repo, head) = settled_head(repo_dir, head_file).await?;
    repair_head_record(repo_dir, &head)?;

    let record_path = operation_record_path(repo_dir, operation_id);
    if claim_record(&record_path, &Record::Fenced)? {
        return Ok(OperationOutcome::Absent);
    }
    match read_record(&record_path)? {
        Record::Committed { revision, .. } => Ok(OperationOutcome::Committed { revision }),
        Record::Fenced => Ok(OperationOutcome::Absent),
        Record::Pending(_) => {
            write_record(&record_path, &Record::Fenced)?;
            Ok(OperationOutcome::Absent)
        }
    }
}

/// Take the cross-process lock on an existing repo directory, giving up at
/// `deadline`, and return the locked `deckd/HEAD`. Callers hold the repo's
/// in-process gate first. Dropping the file releases the lock.
fn lock_repo(repo_dir: &Path, deadline: Instant) -> CommitResult<File> {
    let deckd_dir = repo_dir.join("deckd");
    std::fs::create_dir_all(deckd_dir.join("operations")).map_err(internal)?;
    // The lock file is never deleted. Deleting one on release (as jj-lib's
    // `FileLock` does) lets two NFS clients each hold "the" lock: one on the
    // unlinked inode, which NFS keeps alive under a hidden name, and one on
    // its replacement.
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(deckd_dir.join("HEAD"))
        .map_err(internal)?;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(TryLockError::WouldBlock) if Instant::now() >= deadline => {
                return Err(CommitError::LockTimeout(repo_dir.display().to_string()))
            }
            Err(TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(10)),
            Err(TryLockError::Error(error)) => return Err(internal(error)),
        }
    }
}

/// `deckd/HEAD` can't be replaced by a rename, because it is the lock, so it
/// holds two fixed-size slots, each `<seq> <revision> <check>\n`. A write goes
/// to the slot that doesn't hold the latest value, so a write torn by a crash
/// leaves the previous value intact in the other slot.
const HEAD_SLOT_LEN: usize = 16 + 1 + 40 + 1 + 16 + 1;

/// The latest intact slot in the locked `deckd/HEAD`, as (sequence, revision).
/// With none (no write ever finished), HEAD is the root commit.
fn read_head_slots(head_file: &mut File) -> CommitResult<Option<(u64, CommitId)>> {
    let mut bytes = Vec::new();
    head_file.seek(SeekFrom::Start(0)).map_err(internal)?;
    head_file.read_to_end(&mut bytes).map_err(internal)?;
    Ok(bytes
        .chunks(HEAD_SLOT_LEN)
        .take(2)
        .filter_map(parse_head_slot)
        .max_by_key(|(seq, _)| *seq))
}

fn parse_head_slot(slot: &[u8]) -> Option<(u64, CommitId)> {
    let text = std::str::from_utf8(slot).ok()?.strip_suffix('\n')?;
    let (body, check) = text.rsplit_once(' ')?;
    if slot.len() != HEAD_SLOT_LEN || check != format!("{:016x}", fnv1a(body.as_bytes())) {
        return None;
    }
    let (seq, revision) = body.split_once(' ')?;
    Some((
        u64::from_str_radix(seq, 16).ok()?,
        CommitId::try_from_hex(revision)?,
    ))
}

/// The revision in the locked `deckd/HEAD`.
fn read_recorded_head(head_file: &mut File, root: &CommitId) -> CommitResult<CommitId> {
    Ok(read_head_slots(head_file)?.map_or_else(|| root.clone(), |(_, revision)| revision))
}

/// Record `revision` in the locked `deckd/HEAD` and sync it.
fn write_recorded_head(head_file: &mut File, revision: &str) -> CommitResult<()> {
    if revision.len() != 40 {
        return Err(CommitError::Internal(format!(
            "cannot record revision {revision:?}"
        )));
    }
    let seq = read_head_slots(head_file)?.map_or(0, |(seq, _)| seq) + 1;
    let body = format!("{seq:016x} {revision}");
    let slot = format!("{body} {:016x}\n", fnv1a(body.as_bytes()));
    let offset = (seq % 2) * HEAD_SLOT_LEN as u64;
    head_file.seek(SeekFrom::Start(offset)).map_err(internal)?;
    head_file.write_all(slot.as_bytes()).map_err(internal)?;
    head_file.sync_all().map_err(internal)
}

/// FNV-1a, enough to tell a torn slot from an intact one.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3)
    })
}

/// Load the repo and return its HEAD once it agrees with `deckd/HEAD`. Callers
/// hold both repo locks.
async fn settled_head(
    repo_dir: &Path,
    head_file: &mut File,
) -> CommitResult<(Arc<ReadonlyRepo>, Commit)> {
    let started = Instant::now();
    loop {
        let repo = load_or_init(repo_dir).await?;
        let recorded = read_recorded_head(head_file, repo.store().root_commit_id())?;
        let head = head_commit(&repo)?;
        if head.id() == &recorded {
            return Ok((repo, head));
        }
        // jj one commit behind: the recorded revision was written and then
        // either never published (a crash) or published where this host's
        // listing can't see it yet. Publishing it is right in both cases, and
        // publishing it twice merges to the same single head.
        if let Ok(commit) = repo.store().get_commit(&recorded) {
            if commit.parent_ids() == std::slice::from_ref(head.id()) {
                let mut tx = repo.start_transaction();
                tx.repo_mut().add_head(&commit).await.map_err(internal)?;
                let repo = tx
                    .commit(format!("publish recorded HEAD {}", recorded.hex()))
                    .await
                    .map_err(internal)?;
                return Ok((repo, commit));
            }
        }
        if started.elapsed() >= SETTLE_TIMEOUT {
            return Err(CommitError::HistoryUnsettled {
                recorded: recorded.hex(),
                observed: head.id().hex(),
            });
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn validate_repo_dir(repo_dir: &Path) -> CommitResult<()> {
    if !repo_dir.is_absolute() {
        return Err(CommitError::Invalid("repo must be an absolute path".into()));
    }
    if repo_dir
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(CommitError::Invalid("repo must not contain `..`".into()));
    }
    Ok(())
}

/// Operation IDs name files, so they're limited to a filename-safe alphabet
/// and may not start with `.` (temporary records do).
fn validate_operation_id(operation_id: &str) -> CommitResult<()> {
    let valid = (1..=128).contains(&operation_id.len())
        && !operation_id.starts_with('.')
        && operation_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
    if valid {
        Ok(())
    } else {
        Err(CommitError::Invalid(format!(
            "invalid operation id {operation_id:?}: use 1-128 of [A-Za-z0-9._-], not starting with `.`"
        )))
    }
}

/// A path a commit may write or delete. Beyond what reads accept, it has no
/// `.` segment (git rejects such trees) and no `.git` segment (git refuses to
/// check one out). History only grows, so a bad tree could never be removed.
fn is_valid_commit_path(path: &str) -> bool {
    is_valid_history_path(path)
        && !path
            .split('/')
            .any(|segment| segment == "." || segment.eq_ignore_ascii_case(".git"))
}

fn validate_commit_request(request: &CommitRequest) -> CommitResult<()> {
    if CommitId::try_from_hex(&request.parent).is_none() {
        return Err(CommitError::Invalid(format!(
            "parent {:?} is not a revision id",
            request.parent
        )));
    }
    if request.author.name.trim().is_empty() || request.author.email.trim().is_empty() {
        return Err(CommitError::Invalid(
            "author name and email are required".into(),
        ));
    }
    // These would corrupt the git signature line.
    let unsafe_author_char = |c: char| matches!(c, '\n' | '\r' | '<' | '>');
    if request.author.name.contains(unsafe_author_char)
        || request.author.email.contains(unsafe_author_char)
    {
        return Err(CommitError::Invalid(
            "author must not contain newlines, `<` or `>`".into(),
        ));
    }
    // With no message, the trailer block would be the first paragraph, and
    // trailer parsing (as in git) ignores trailers there.
    if request.message.trim().is_empty() {
        return Err(CommitError::Invalid("message is required".into()));
    }
    for trailer in &request.trailers {
        let key_ok = !trailer.key.is_empty()
            && trailer
                .key
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-');
        if !key_ok || trailer.value.contains('\n') || trailer.value.contains('\r') {
            return Err(CommitError::Invalid(format!(
                "invalid trailer {:?}",
                trailer.key
            )));
        }
        if trailer.key.eq_ignore_ascii_case(OPERATION_ID_TRAILER) {
            return Err(CommitError::Invalid(format!(
                "{OPERATION_ID_TRAILER} is set by deckd from operationId"
            )));
        }
    }
    let mut seen = HashSet::new();
    for change in &request.changes {
        if !is_valid_commit_path(&change.path) {
            return Err(CommitError::Invalid(format!(
                "invalid path {:?}",
                change.path
            )));
        }
        if !seen.insert(change.path.as_str()) {
            return Err(CommitError::Invalid(format!(
                "path {:?} appears more than once",
                change.path
            )));
        }
    }
    // A listed path inside another listed path would turn a file into a
    // directory or back, changing what the other entry says.
    for change in &request.changes {
        let mut ancestor = change.path.as_str();
        while let Some((parent, _)) = ancestor.rsplit_once('/') {
            if seen.contains(parent) {
                return Err(CommitError::Invalid(format!(
                    "path {:?} is inside listed path {parent:?}",
                    change.path
                )));
            }
            ancestor = parent;
        }
    }
    Ok(())
}

fn description(request: &CommitRequest) -> String {
    let mut description = request.message.trim_end().to_owned();
    description.push_str("\n\n");
    for trailer in &request.trailers {
        description.push_str(&format!("{}: {}\n", trailer.key, trailer.value));
    }
    description.push_str(&format!(
        "{OPERATION_ID_TRAILER}: {}\n",
        request.operation_id
    ));
    description
}

fn create_repo_dir(repo_dir: &Path) -> CommitResult<()> {
    // The parent (normally the realm directory) must already exist, so a
    // mistyped path fails instead of quietly growing a new tree.
    match std::fs::create_dir(repo_dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Err(CommitError::Invalid(format!(
            "parent directory of {} does not exist",
            repo_dir.display()
        ))),
        Err(e) => Err(internal(e)),
    }
}

/// Load the repo, creating it first if needed. Callers hold the repo lock.
/// The repo is built in a temporary directory and renamed into place, so a
/// crash mid-init never leaves a half-made `jj/`.
async fn load_or_init(repo_dir: &Path) -> CommitResult<Arc<ReadonlyRepo>> {
    let jj_dir = repo_dir.join("jj");
    // A cached negative lookup can make an existing `jj/` look absent; the
    // rename in `install_repo` is what decides.
    if !jj_dir.is_dir() {
        let staging = repo_dir.join("deckd").join(format!("init-{}", nonce()));
        std::fs::create_dir_all(&staging).map_err(internal)?;
        let settings = user_settings(None).map_err(internal)?;
        let backend_initializer: &jj_lib::repo::BackendInitializer = &|settings, store_path| {
            Ok(Box::new(jj_lib::git_backend::GitBackend::init_internal(
                settings,
                store_path,
                gix::hash::Kind::Sha1,
            )?))
        };
        ReadonlyRepo::init(
            &settings,
            &staging,
            backend_initializer,
            signer_from_settings(&settings).map_err(internal)?,
            ReadonlyRepo::default_workspace_store_initializer(),
            ReadonlyRepo::default_op_store_initializer(),
            ReadonlyRepo::default_op_heads_store_initializer(),
            ReadonlyRepo::default_index_store_initializer(),
            ReadonlyRepo::default_submodule_store_initializer(),
        )
        .await
        .map_err(internal)?;
        install_repo(&staging, &jj_dir)?;
    }
    load_repo(repo_dir).await
}

/// Move a freshly initialized repo into place. When `jj/` already exists the
/// staged copy is discarded and the existing repo wins.
fn install_repo(staging: &Path, jj_dir: &Path) -> CommitResult<()> {
    match std::fs::rename(staging, jj_dir) {
        Ok(()) => Ok(()),
        Err(e)
            if matches!(
                e.kind(),
                ErrorKind::AlreadyExists | ErrorKind::DirectoryNotEmpty
            ) =>
        {
            std::fs::remove_dir_all(staging).map_err(internal)
        }
        Err(e) => Err(internal(e)),
    }
}

async fn load_repo(repo_dir: &Path) -> CommitResult<Arc<ReadonlyRepo>> {
    let settings = user_settings(None).map_err(internal)?;
    RepoLoader::init_from_file_system(
        &settings,
        &repo_dir.join("jj"),
        &default_backend_factories(),
    )
    .map_err(internal)?
    .load_at_head()
    .await
    .map_err(internal)
}

/// HEAD is the single visible head. History is linear, so more than one head
/// means two writers raced past the lock; that is reported, never resolved.
fn head_commit(repo: &Arc<ReadonlyRepo>) -> CommitResult<Commit> {
    let heads = repo.view().heads();
    let mut iter = heads.iter();
    match (iter.next(), iter.next()) {
        (Some(head), None) => repo.store().get_commit(head).map_err(internal),
        _ => Err(CommitError::Internal(format!(
            "history has {} heads; expected exactly one",
            heads.len()
        ))),
    }
}

fn get_commit(repo: &Arc<ReadonlyRepo>, revision: &str) -> CommitResult<Commit> {
    let not_found = || CommitError::RevisionNotFound(revision.to_owned());
    let id = CommitId::try_from_hex(revision).ok_or_else(not_found)?;
    match repo.store().get_commit(&id) {
        Ok(commit) => Ok(commit),
        Err(BackendError::ObjectNotFound { .. }) => Err(not_found()),
        Err(e) => Err(internal(e)),
    }
}

fn tree_hash(commit: &Commit) -> String {
    match commit.tree_ids().as_resolved() {
        Some(tree_id) => tree_id.hex(),
        // Explicit commits never write conflicted trees.
        None => String::new(),
    }
}

/// `id` as a commit in history: an ancestor of, or one of, `heads`. A commit
/// object that was written but never published isn't in the index.
async fn published_commit(
    repo: &Arc<ReadonlyRepo>,
    heads: &[CommitId],
    id: &CommitId,
) -> CommitResult<Option<Commit>> {
    let index = repo.index();
    if !index.has_id(id).await.map_err(internal)? {
        return Ok(None);
    }
    for head in heads {
        if index.is_ancestor(id, head).await.map_err(internal)? {
            return Ok(Some(repo.store().get_commit(id).map_err(internal)?));
        }
    }
    Ok(None)
}

/// Sync the git objects `commit` added: the commit, every tree on the way to
/// a changed path, and each written file. git doesn't sync loose objects, and
/// recording a commit whose objects a power loss could drop would leave
/// `deckd/HEAD` naming a revision the store doesn't have. An object with no
/// loose file was already packed, and so already durable.
async fn sync_new_objects(
    repo_dir: &Path,
    commit: &Commit,
    changes: &[Change],
) -> CommitResult<()> {
    let tree = commit.tree();
    let mut ids = BTreeSet::from([commit.id().hex(), tree_hash(commit)]);
    for change in changes {
        let path = RepoPathBuf::from_internal_string(change.path.clone()).map_err(internal)?;
        for ancestor in path.ancestors().skip(1) {
            if ancestor.is_root() {
                break;
            }
            if let Some(Some(TreeValue::Tree(id))) = tree
                .path_value(ancestor)
                .await
                .map_err(internal)?
                .as_resolved()
            {
                ids.insert(id.hex());
            }
        }
        if let Some(Some(TreeValue::File { id, .. })) = tree
            .path_value(&path)
            .await
            .map_err(internal)?
            .as_resolved()
        {
            ids.insert(id.hex());
        }
    }
    let mut dirs = BTreeSet::new();
    for id in &ids {
        let path = loose_object_path(repo_dir, id);
        match File::open(&path) {
            Ok(file) => file.sync_all().map_err(internal)?,
            Err(e) if e.kind() == ErrorKind::NotFound => continue,
            Err(e) => return Err(internal(e)),
        }
        // The fan-out directory, and `objects/` in case that was new too.
        let dir = path
            .parent()
            .ok_or_else(|| internal("object has no parent"))?;
        dirs.insert(dir.to_path_buf());
        dirs.extend(dir.parent().map(Path::to_path_buf));
    }
    dirs.iter().try_for_each(|dir| sync_dir(dir))
}

fn loose_object_path(repo_dir: &Path, hex: &str) -> PathBuf {
    repo_dir
        .join("jj/store/git/objects")
        .join(&hex[..2])
        .join(&hex[2..])
}

fn sync_dir(dir: &Path) -> CommitResult<()> {
    File::open(dir).and_then(|d| d.sync_all()).map_err(internal)
}

/// What the parent tree holds at `path`.
enum Existing {
    Absent,
    File {
        executable: bool,
    },
    Directory,
    /// A symlink, submodule or conflict.
    Other,
}

async fn existing(tree: &MergedTree, path: &RepoPath) -> CommitResult<Existing> {
    let value = tree.path_value(path).await.map_err(internal)?;
    Ok(match value.as_resolved() {
        Some(None) => Existing::Absent,
        Some(Some(TreeValue::Tree(_))) => Existing::Directory,
        Some(Some(TreeValue::File { executable, .. })) => Existing::File {
            executable: *executable,
        },
        _ => Existing::Other,
    })
}

/// HEAD's tree with `changes` applied. A change may not turn a file into a
/// directory or back: that would remove paths the request didn't list. A
/// write keeps an existing file's executable bit; it replaces a symlink or
/// submodule with a regular file holding the given bytes.
async fn build_tree(
    repo: &Arc<ReadonlyRepo>,
    parent: &Commit,
    changes: &[Change],
) -> CommitResult<MergedTree> {
    let store = repo.store();
    let base = parent.tree();
    let mut builder = MergedTreeBuilder::new(base.clone());
    for change in changes {
        let path = RepoPathBuf::from_internal_string(change.path.clone())
            .map_err(|e| CommitError::Invalid(format!("invalid path {:?}: {e}", change.path)))?;
        for ancestor in path.ancestors().skip(1) {
            if ancestor.is_root() {
                break;
            }
            if let Existing::File { .. } | Existing::Other = existing(&base, ancestor).await? {
                return Err(CommitError::Invalid(format!(
                    "path {:?} is inside file {:?}",
                    change.path,
                    ancestor.as_internal_file_string()
                )));
            }
        }
        let executable = match existing(&base, &path).await? {
            Existing::Directory => {
                return Err(CommitError::Invalid(format!(
                    "path {:?} is a directory; list the files inside it instead",
                    change.path
                )));
            }
            Existing::File { executable } => executable,
            Existing::Absent | Existing::Other => false,
        };
        let value = match &change.content {
            Some(bytes) => {
                let id = store
                    .write_file(&path, &mut bytes.as_slice())
                    .await
                    .map_err(internal)?;
                Merge::normal(TreeValue::File {
                    id,
                    executable,
                    copy_id: CopyId::placeholder(),
                })
            }
            None => Merge::absent(),
        };
        builder.set_or_remove(path, value);
    }
    builder.write_tree().await.map_err(internal)
}

/// An operation record. `Pending` and `Committed` carry the digest of the
/// request that claimed the operation; it is absent only when the record was
/// rebuilt from HEAD without a readable claim.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Record {
    Pending(Option<String>),
    Committed {
        revision: String,
        digest: Option<String>,
    },
    Fenced,
}

impl Record {
    fn encode(&self) -> String {
        let with_digest = |text: String, digest: &Option<String>| match digest {
            Some(digest) => format!("{text} {digest}\n"),
            None => format!("{text}\n"),
        };
        match self {
            Record::Pending(digest) => with_digest("pending".into(), digest),
            Record::Committed { revision, digest } => {
                with_digest(format!("committed {revision}"), digest)
            }
            Record::Fenced => "fenced\n".into(),
        }
    }

    fn decode(text: &str) -> CommitResult<Self> {
        let words: Vec<&str> = text.split_whitespace().collect();
        let digest = |word: Option<&&str>| word.map(|w| w.to_string());
        match words.as_slice() {
            [] => Ok(Record::Pending(None)),
            ["pending", rest @ ..] if rest.len() <= 1 => Ok(Record::Pending(digest(rest.first()))),
            ["fenced"] => Ok(Record::Fenced),
            ["committed", revision, rest @ ..] if rest.len() <= 1 => Ok(Record::Committed {
                revision: revision.to_string(),
                digest: digest(rest.first()),
            }),
            _ => Err(CommitError::Internal(format!(
                "unreadable operation record {:?}",
                text.trim()
            ))),
        }
    }
}

/// A digest of everything a commit request asks for except its parent. A
/// retry may name a newer parent after a conflict; anything else differing
/// means the operation ID was reused for another write.
fn request_digest(request: &CommitRequest) -> String {
    fn field(hasher: &mut Sha256, bytes: &[u8]) {
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(bytes);
    }
    let mut hasher = Sha256::new();
    field(&mut hasher, request.author.name.as_bytes());
    field(&mut hasher, request.author.email.as_bytes());
    field(&mut hasher, request.message.as_bytes());
    hasher.update((request.trailers.len() as u64).to_be_bytes());
    for trailer in &request.trailers {
        field(&mut hasher, trailer.key.as_bytes());
        field(&mut hasher, trailer.value.as_bytes());
    }
    // Paths are unique, so their order carries no meaning.
    let mut changes: Vec<&Change> = request.changes.iter().collect();
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    hasher.update((changes.len() as u64).to_be_bytes());
    for change in changes {
        field(&mut hasher, change.path.as_bytes());
        match &change.content {
            Some(bytes) => {
                field(&mut hasher, b"write");
                field(&mut hasher, bytes);
            }
            None => field(&mut hasher, b"delete"),
        }
    }
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn operation_record_path(repo_dir: &Path, operation_id: &str) -> PathBuf {
    repo_dir.join("deckd").join("operations").join(operation_id)
}

fn record_dir(path: &Path) -> CommitResult<&Path> {
    path.parent()
        .ok_or_else(|| CommitError::Internal("operation record has no parent".into()))
}

/// Create the record with `create_new`. Returns false when it already exists.
/// An empty record (a crash between create and write) reads as `pending`.
/// The record and its directory entry are synced, so a crash can't undo a
/// claim this call reported.
fn claim_record(path: &Path, record: &Record) -> CommitResult<bool> {
    let mut file = match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::AlreadyExists => return Ok(false),
        Err(e) => return Err(internal(e)),
    };
    file.write_all(record.encode().as_bytes())
        .map_err(internal)?;
    file.sync_all().map_err(internal)?;
    sync_dir(record_dir(path)?)?;
    Ok(true)
}

fn read_record(path: &Path) -> CommitResult<Record> {
    Record::decode(&std::fs::read_to_string(path).map_err(internal)?)
}

/// Replace a record atomically: write a temporary file, then rename it over.
fn write_record(path: &Path, record: &Record) -> CommitResult<()> {
    let dir = record_dir(path)?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| CommitError::Internal("operation record has no name".into()))?;
    let tmp = dir.join(format!(".{name}.{}", nonce()));
    {
        let mut file = File::create(&tmp).map_err(internal)?;
        file.write_all(record.encode().as_bytes())
            .map_err(internal)?;
        file.sync_all().map_err(internal)?;
    }
    std::fs::rename(&tmp, path).map_err(internal)?;
    sync_dir(dir)
}

/// Remove a claim that never published.
fn remove_record(path: &Path) -> CommitResult<()> {
    std::fs::remove_file(path).map_err(internal)?;
    sync_dir(record_dir(path)?)
}

/// Make HEAD's operation record say `committed HEAD`, keeping the digest a
/// pending claim recorded. The record is written whenever it doesn't already
/// say so, including when reading it fails: a missing file may only be a
/// stale NFS lookup, and the write is the truth. A `fenced` record for HEAD's
/// operation means the lock failed to exclude a writer; that is refused
/// loudly, never overwritten.
fn repair_head_record(repo_dir: &Path, head: &Commit) -> CommitResult<()> {
    let Some(operation_id) = parse_description_trailers(head.description())
        .into_iter()
        .find(|t| t.key == OPERATION_ID_TRAILER)
        .map(|t| t.value)
    else {
        return Ok(());
    };
    if validate_operation_id(&operation_id).is_err() {
        return Ok(());
    }
    let path = operation_record_path(repo_dir, &operation_id);
    let revision = head.id().hex();
    let digest = match read_record(&path).ok() {
        Some(Record::Committed {
            revision: recorded, ..
        }) if recorded == revision => return Ok(()),
        Some(Record::Fenced) => {
            let message = format!(
                "operation {operation_id} was reported absent but committed as {revision}; \
                 history needs an operator"
            );
            tracing::error!(repo = %repo_dir.display(), "{message}");
            return Err(CommitError::Internal(message));
        }
        Some(Record::Pending(digest) | Record::Committed { digest, .. }) => digest,
        None => None,
    };
    write_record(&path, &Record::Committed { revision, digest })
}

fn nonce() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{}-{nanos}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A realm directory whose history repo is `<realm>/.history`. The repo
    /// directory itself doesn't exist yet; deckd creates it.
    struct Realm {
        root: PathBuf,
    }

    impl Realm {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!("deckd-commit-{name}-{}", nonce()));
            std::fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn repo(&self) -> PathBuf {
            self.root.join(".history")
        }
    }

    impl Drop for Realm {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn write(path: &str, content: &str) -> Change {
        Change {
            path: path.into(),
            content: Some(content.as_bytes().to_vec()),
        }
    }

    fn delete(path: &str) -> Change {
        Change {
            path: path.into(),
            content: None,
        }
    }

    fn request(parent: &str, operation_id: &str, changes: Vec<Change>) -> CommitRequest {
        CommitRequest {
            parent: parent.into(),
            operation_id: operation_id.into(),
            author: Author {
                name: "Jane".into(),
                email: "jane@example.com".into(),
            },
            message: format!("Write for {operation_id}"),
            trailers: vec![CommitTrailer {
                key: "Boxel-Channel".into(),
                value: "host".into(),
            }],
            changes,
        }
    }

    fn head(service: &CommitService, realm: &Realm) -> String {
        service.head(&realm.repo()).unwrap().revision
    }

    fn commit(
        service: &CommitService,
        realm: &Realm,
        req: CommitRequest,
    ) -> CommitResult<CommitOutcome> {
        service.commit(&realm.repo(), req)
    }

    fn outcome(service: &CommitService, realm: &Realm, operation_id: &str) -> OperationOutcome {
        service.outcome(&realm.repo(), operation_id).unwrap()
    }

    /// Every file at `revision`, with its content.
    fn files_at(realm: &Realm, revision: &str) -> Vec<(String, String)> {
        pollster::block_on(async {
            let repo = load_repo(&realm.repo()).await.unwrap();
            let commit = get_commit(&repo, revision).unwrap();
            let mut files = Vec::new();
            for (path, value) in commit.tree().entries() {
                let Some(Some(TreeValue::File { id, .. })) = value.unwrap().into_resolved().ok()
                else {
                    panic!("unexpected tree value at {path:?}");
                };
                let mut content = String::new();
                repo.store()
                    .read_file(&path, &id)
                    .await
                    .unwrap()
                    .read_to_string(&mut content)
                    .await
                    .unwrap();
                files.push((path.as_internal_file_string().to_owned(), content));
            }
            files
        })
    }

    fn description_at(realm: &Realm, revision: &str) -> String {
        pollster::block_on(async {
            let repo = load_repo(&realm.repo()).await.unwrap();
            get_commit(&repo, revision)
                .unwrap()
                .description()
                .to_owned()
        })
    }

    fn files(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(p, c)| (p.to_string(), c.to_string()))
            .collect()
    }

    #[test]
    fn commit_contains_exactly_the_listed_paths() {
        let realm = Realm::new("explicit");
        let service = CommitService::new();
        let root = head(&service, &realm);
        // Bytes on disk that no request listed: a working-copy snapshot would
        // pick these up.
        std::fs::write(realm.root.join("unlisted.json"), "{}").unwrap();
        std::fs::write(realm.repo().join("stray.txt"), "stray").unwrap();

        let done = commit(
            &service,
            &realm,
            request(
                &root,
                "op-1",
                vec![write("Author/jane.json", "{\"name\":\"Jane\"}")],
            ),
        )
        .unwrap();

        assert!(done.created);
        assert!(!done.replayed);
        assert_eq!(head(&service, &realm), done.revision);
        assert_eq!(
            files_at(&realm, &done.revision),
            files(&[("Author/jane.json", "{\"name\":\"Jane\"}")])
        );
    }

    #[test]
    fn commit_records_message_author_and_trailers() {
        let realm = Realm::new("description");
        let service = CommitService::new();
        let root = head(&service, &realm);

        let done = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "a")]),
        )
        .unwrap();

        assert_eq!(
            description_at(&realm, &done.revision),
            "Write for op-1\n\nBoxel-Channel: host\nDeckd-Operation-Id: op-1\n"
        );
        let author = pollster::block_on(async {
            let repo = load_repo(&realm.repo()).await.unwrap();
            get_commit(&repo, &done.revision).unwrap().author().clone()
        });
        assert_eq!(
            (author.name.as_str(), author.email.as_str()),
            ("Jane", "jane@example.com")
        );
    }

    #[test]
    fn stale_parent_is_refused_with_current_head() {
        let realm = Realm::new("cas");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let first = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "1")]),
        )
        .unwrap();

        let error = commit(
            &service,
            &realm,
            request(&root, "op-2", vec![write("b.txt", "2")]),
        )
        .unwrap_err();

        match error {
            CommitError::ParentMismatch {
                parent,
                head: current,
            } => {
                assert_eq!(parent, root);
                assert_eq!(current, first.revision);
            }
            other => panic!("expected parent mismatch, got {other:?}"),
        }
        assert_eq!(head(&service, &realm), first.revision);
    }

    #[test]
    fn conflicted_operation_can_retry_on_the_new_head() {
        let realm = Realm::new("cas-retry");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let first = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "1")]),
        )
        .unwrap();
        commit(
            &service,
            &realm,
            request(&root, "op-2", vec![write("b.txt", "2")]),
        )
        .unwrap_err();

        let retried = commit(
            &service,
            &realm,
            request(&first.revision, "op-2", vec![write("b.txt", "2")]),
        )
        .unwrap();

        assert!(retried.created);
        assert_eq!(
            files_at(&realm, &retried.revision),
            files(&[("a.txt", "1"), ("b.txt", "2")])
        );
    }

    #[test]
    fn retried_operation_returns_the_original_revision() {
        let realm = Realm::new("idempotent");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let req = request(&root, "op-1", vec![write("a.txt", "1")]);
        let first = commit(&service, &realm, req.clone()).unwrap();

        // The retry's parent is now stale; the replay still wins.
        let again = commit(&service, &realm, req).unwrap();

        assert_eq!(again.revision, first.revision);
        assert_eq!(again.tree, first.tree);
        assert!(again.replayed);
        assert!(!again.created);
        assert_eq!(head(&service, &realm), first.revision);
        let parent = pollster::block_on(async {
            let repo = load_repo(&realm.repo()).await.unwrap();
            get_commit(&repo, &first.revision)
                .unwrap()
                .parent_ids()
                .to_vec()
        });
        assert_eq!(
            parent.iter().map(|id| id.hex()).collect::<Vec<_>>(),
            vec![root]
        );
    }

    #[test]
    fn absent_outcome_fences_the_operation_across_restarts() {
        let realm = Realm::new("fence");
        let service = CommitService::new();
        let root = head(&service, &realm);

        assert_eq!(outcome(&service, &realm, "op-1"), OperationOutcome::Absent);
        let refused = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "1")]),
        );
        assert!(matches!(refused, Err(CommitError::OperationFenced(_))));

        // A new instance has no memory of the fence; only the repo does.
        let restarted = CommitService::new();
        let refused = commit(
            &restarted,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "1")]),
        );
        assert!(matches!(refused, Err(CommitError::OperationFenced(_))));
        assert_eq!(
            outcome(&restarted, &realm, "op-1"),
            OperationOutcome::Absent
        );
        assert_eq!(head(&restarted, &realm), root);
    }

    #[test]
    fn outcome_reports_a_committed_operation() {
        let realm = Realm::new("outcome-committed");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let done = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "1")]),
        )
        .unwrap();

        let restarted = CommitService::new();

        assert_eq!(
            outcome(&restarted, &realm, "op-1"),
            OperationOutcome::Committed {
                revision: done.revision.clone()
            }
        );
        // Asking doesn't fence a committed operation; a retry still replays.
        let again = commit(
            &restarted,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "1")]),
        )
        .unwrap();
        assert_eq!(again.revision, done.revision);
    }

    #[test]
    fn commit_published_without_its_record_is_reported_committed() {
        let realm = Realm::new("repair");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let done = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "1")]),
        )
        .unwrap();
        let record = operation_record_path(&realm.repo(), "op-1");

        // Crash after publish: the record still holds the claim, or is gone.
        std::fs::write(&record, "pending\n").unwrap();
        assert_eq!(
            outcome(&service, &realm, "op-1"),
            OperationOutcome::Committed {
                revision: done.revision.clone()
            }
        );
        std::fs::remove_file(&record).unwrap();
        let again = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "1")]),
        )
        .unwrap();
        assert_eq!(again.revision, done.revision);
        assert!(again.replayed);
    }

    #[test]
    fn claim_left_by_a_crash_before_publish_resolves_absent() {
        let realm = Realm::new("pending");
        let service = CommitService::new();
        let root = head(&service, &realm);
        // Create the repo layout, then leave a claim as a crashed commit would.
        outcome(&service, &realm, "unrelated");
        std::fs::write(operation_record_path(&realm.repo(), "op-1"), "pending\n").unwrap();
        std::fs::write(operation_record_path(&realm.repo(), "op-2"), "").unwrap();

        assert_eq!(outcome(&service, &realm, "op-1"), OperationOutcome::Absent);
        let refused = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "1")]),
        );
        assert!(matches!(refused, Err(CommitError::OperationFenced(_))));

        // Retrying the crashed operation instead takes its claim over.
        let done = commit(
            &service,
            &realm,
            request(&root, "op-2", vec![write("b.txt", "2")]),
        )
        .unwrap();
        assert!(done.created);
    }

    #[test]
    fn racing_writers_stay_linear() {
        let realm = Realm::new("race");
        let root = head(&CommitService::new(), &realm);
        let writers = 8;

        // Each writer is its own service, as separate deckd processes would be.
        let first_round: Vec<_> = std::thread::scope(|s| {
            let handles: Vec<_> = (0..writers)
                .map(|i| {
                    let realm = &realm;
                    let root = root.clone();
                    s.spawn(move || {
                        let service = CommitService::new();
                        commit(
                            &service,
                            realm,
                            request(
                                &root,
                                &format!("op-{i}"),
                                vec![write(&format!("{i}.txt"), "x")],
                            ),
                        )
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });
        assert_eq!(first_round.iter().filter(|r| r.is_ok()).count(), 1);
        assert!(first_round
            .iter()
            .filter_map(|r| r.as_ref().err())
            .all(|e| matches!(e, CommitError::ParentMismatch { .. })));

        // Losers retry the same operation on whatever HEAD the conflict reports.
        std::thread::scope(|s| {
            for i in 0..writers {
                let realm = &realm;
                s.spawn(move || {
                    let service = CommitService::new();
                    let mut parent = head(&service, realm);
                    loop {
                        let req = request(
                            &parent,
                            &format!("op-{i}"),
                            vec![write(&format!("{i}.txt"), "x")],
                        );
                        match commit(&service, realm, req) {
                            Ok(_) => return,
                            Err(CommitError::ParentMismatch { head, .. }) => parent = head,
                            Err(other) => panic!("writer {i}: {other:?}"),
                        }
                    }
                });
            }
        });

        let service = CommitService::new();
        let tip = head(&service, &realm);
        assert_eq!(files_at(&realm, &tip).len(), writers);
        let depth = pollster::block_on(async {
            let repo = load_repo(&realm.repo()).await.unwrap();
            let mut depth = 0;
            let mut commit = get_commit(&repo, &tip).unwrap();
            while commit.id() != repo.store().root_commit_id() {
                assert_eq!(commit.parent_ids().len(), 1);
                commit = repo.store().get_commit(&commit.parent_ids()[0]).unwrap();
                depth += 1;
            }
            depth
        });
        assert_eq!(depth, writers);
    }

    #[test]
    fn parent_matches_regardless_of_hex_case() {
        let realm = Realm::new("hex-case");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let first = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "1")]),
        )
        .unwrap();

        let second = commit(
            &service,
            &realm,
            request(
                &first.revision.to_uppercase(),
                "op-2",
                vec![write("b.txt", "2")],
            ),
        )
        .unwrap();

        assert!(second.created);
    }

    /// Overwrite the locked `deckd/HEAD`, as a crashed or partitioned peer
    /// would leave it.
    fn set_recorded_head(realm: &Realm, revision: &str) {
        let mut file = lock_repo(&realm.repo(), Instant::now() + LOCK_TIMEOUT).unwrap();
        write_recorded_head(&mut file, revision).unwrap();
    }

    /// Write a commit for `operation_id` without publishing it, as a writer
    /// that crashed between recording and publishing would.
    fn unpublished_commit(realm: &Realm, parent: &str, operation_id: &str) -> String {
        pollster::block_on(async {
            let repo = load_repo(&realm.repo()).await.unwrap();
            let head = get_commit(&repo, parent).unwrap();
            let req = request(parent, operation_id, vec![write("crashed.txt", "x")]);
            let tree = build_tree(&repo, &head, &req.changes).await.unwrap();
            let mut tx = repo.start_transaction();
            let commit = tx
                .repo_mut()
                .new_commit(vec![head.id().clone()], tree)
                .set_description(description(&req))
                .write()
                .await
                .unwrap();
            commit.id().hex()
        })
    }

    fn assert_invalid(result: CommitResult<CommitOutcome>, needle: &str) {
        match result {
            Err(CommitError::Invalid(message)) => {
                assert!(message.contains(needle), "{message:?} lacks {needle:?}")
            }
            other => panic!("expected invalid request, got {other:?}"),
        }
    }

    #[test]
    fn changes_may_not_cross_a_file_directory_boundary() {
        let realm = Realm::new("boundary");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let base = commit(
            &service,
            &realm,
            request(
                &root,
                "op-base",
                vec![write("a", "1"), write("d/x", "1"), write("d/y", "1")],
            ),
        )
        .unwrap();
        let attempt =
            |op: &str, changes| commit(&service, &realm, request(&base.revision, op, changes));

        assert_invalid(attempt("op-1", vec![write("a/b", "2")]), "inside file");
        assert_invalid(attempt("op-2", vec![write("d", "2")]), "is a directory");
        assert_invalid(attempt("op-3", vec![delete("d")]), "is a directory");
        assert_invalid(
            attempt("op-4", vec![write("e", "2"), write("e/f", "2")]),
            "inside listed path",
        );
        assert_invalid(
            attempt("op-5", vec![delete("a"), write("a/b", "2")]),
            "inside listed path",
        );

        // Refused requests leave no claim, so the IDs stay usable.
        let fixed = attempt("op-1", vec![write("a2/b", "2")]).unwrap();
        assert!(fixed.created);
        assert_eq!(
            files_at(&realm, &fixed.revision),
            files(&[("a", "1"), ("a2/b", "2"), ("d/x", "1"), ("d/y", "1")])
        );
    }

    #[test]
    fn dot_and_git_segments_are_refused() {
        let realm = Realm::new("dot-paths");
        let service = CommitService::new();
        let root = head(&service, &realm);

        for path in [".", "x/./y", ".git/config", "x/.GIT/hooks", "x/.git"] {
            assert_invalid(
                commit(
                    &service,
                    &realm,
                    request(&root, "op", vec![write(path, "")]),
                ),
                "invalid path",
            );
        }
        // Names that only start with those segments are ordinary files.
        let done = commit(
            &service,
            &realm,
            request(
                &root,
                "op",
                vec![write(".gitignore", ""), write("x/.github/ci", "")],
            ),
        )
        .unwrap();
        assert!(done.created);
    }

    #[test]
    fn lock_file_records_head_and_persists() {
        let realm = Realm::new("head-file");
        let service = CommitService::new();
        let root = head(&service, &realm);

        let done = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a", "1")]),
        )
        .unwrap();

        assert_eq!(recorded_head(&realm), Some(done.revision.clone()));
        let next = commit(
            &service,
            &realm,
            request(&done.revision, "op-2", vec![write("b", "2")]),
        )
        .unwrap();
        assert_eq!(recorded_head(&realm), Some(next.revision));
    }

    fn recorded_head(realm: &Realm) -> Option<String> {
        let mut file = File::open(realm.repo().join("deckd/HEAD")).unwrap();
        read_head_slots(&mut file)
            .unwrap()
            .map(|(_, revision)| revision.hex())
    }

    #[test]
    fn torn_head_write_keeps_the_previous_revision() {
        let realm = Realm::new("torn-head");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let first = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a", "1")]),
        )
        .unwrap();
        let second = commit(
            &service,
            &realm,
            request(&first.revision, "op-2", vec![write("b", "2")]),
        )
        .unwrap();
        // A crash partway through recording a third revision: half the
        // bytes that write changes are new, half are still the old ones.
        let head_path = realm.repo().join("deckd/HEAD");
        let before = std::fs::read(&head_path).unwrap();
        set_recorded_head(&realm, &"cd".repeat(20));
        let after = std::fs::read(&head_path).unwrap();
        let changed: Vec<usize> = (0..after.len())
            .filter(|&i| before.get(i) != Some(&after[i]))
            .collect();
        let mut torn = after.clone();
        for &i in &changed[changed.len() / 2..] {
            torn[i] = before.get(i).copied().unwrap_or(0);
        }
        std::fs::write(&head_path, torn).unwrap();

        assert_eq!(recorded_head(&realm), Some(second.revision.clone()));
        assert_eq!(head(&service, &realm), second.revision);
        let next = commit(
            &service,
            &realm,
            request(&second.revision, "op-3", vec![write("c", "3")]),
        )
        .unwrap();
        assert_eq!(recorded_head(&realm), Some(next.revision));
    }

    #[test]
    fn new_objects_are_loose_where_they_are_synced() {
        let realm = Realm::new("loose-objects");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let done = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("dir/a.json", "{}")]),
        )
        .unwrap();

        let (dir_tree, blob) = pollster::block_on(async {
            let repo = load_repo(&realm.repo()).await.unwrap();
            let tree = get_commit(&repo, &done.revision).unwrap().tree();
            let value = |path: &str| {
                let path = RepoPathBuf::from_internal_string(path.to_owned()).unwrap();
                let tree = tree.clone();
                async move {
                    match tree.path_value(&path).await.unwrap().into_resolved() {
                        Ok(Some(TreeValue::Tree(id))) => id.hex(),
                        Ok(Some(TreeValue::File { id, .. })) => id.hex(),
                        other => panic!("unexpected {other:?}"),
                    }
                }
            };
            (value("dir").await, value("dir/a.json").await)
        });
        for id in [&done.revision, &done.tree, &dir_tree, &blob] {
            assert!(loose_object_path(&realm.repo(), id).is_file(), "{id}");
        }
    }

    #[test]
    fn commit_recorded_but_not_published_is_published_by_the_next_call() {
        let realm = Realm::new("roll-forward");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let revision = unpublished_commit(&realm, &root, "op-crashed");
        set_recorded_head(&realm, &revision);
        let crashed = request(&root, "op-crashed", vec![write("crashed.txt", "x")]);
        std::fs::write(
            operation_record_path(&realm.repo(), "op-crashed"),
            Record::Pending(Some(request_digest(&crashed))).encode(),
        )
        .unwrap();

        let restarted = CommitService::new();

        assert_eq!(
            outcome(&restarted, &realm, "op-crashed"),
            OperationOutcome::Committed {
                revision: revision.clone()
            }
        );
        assert_eq!(head(&restarted, &realm), revision);
        assert_eq!(files_at(&realm, &revision), files(&[("crashed.txt", "x")]));
        // The repaired record kept the claim's digest.
        let replay = commit(&restarted, &realm, crashed.clone()).unwrap();
        assert!(replay.replayed);
        let mut different = crashed;
        different.changes = vec![write("crashed.txt", "y")];
        assert!(matches!(
            commit(&restarted, &realm, different),
            Err(CommitError::OperationMismatch { .. })
        ));
        let next = commit(
            &restarted,
            &realm,
            request(&revision, "op-next", vec![write("b", "2")]),
        )
        .unwrap();
        assert!(next.created);
    }

    #[test]
    fn head_that_disagrees_with_the_record_is_refused() {
        let realm = Realm::new("unsettled");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let first = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a", "1")]),
        )
        .unwrap();
        // A recorded HEAD jj can't reach, as a stale listing would look.
        set_recorded_head(&realm, &"ab".repeat(20));

        let error = commit(
            &service,
            &realm,
            request(&first.revision, "op-2", vec![write("b", "2")]),
        )
        .unwrap_err();

        assert!(
            matches!(error, CommitError::HistoryUnsettled { .. }),
            "{error:?}"
        );
        // Nothing was claimed or written.
        set_recorded_head(&realm, &first.revision);
        assert_eq!(outcome(&service, &realm, "op-2"), OperationOutcome::Absent);
        assert_eq!(head(&service, &realm), first.revision);
    }

    #[test]
    fn fenced_record_for_head_is_reported_not_overwritten() {
        let realm = Realm::new("fence-violated");
        let service = CommitService::new();
        let root = head(&service, &realm);
        commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a", "1")]),
        )
        .unwrap();
        let record = operation_record_path(&realm.repo(), "op-1");
        std::fs::write(&record, "fenced\n").unwrap();

        let error = service.outcome(&realm.repo(), "op-2").unwrap_err();

        assert!(
            error.to_string().contains("reported absent but committed"),
            "{error}"
        );
        assert_eq!(std::fs::read_to_string(&record).unwrap(), "fenced\n");
    }

    #[test]
    fn initializing_over_an_existing_repo_keeps_it() {
        let realm = Realm::new("init-race");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let done = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a", "1")]),
        )
        .unwrap();
        let staging = realm.repo().join("deckd/init-late");
        std::fs::create_dir_all(staging.join("store")).unwrap();

        install_repo(&staging, &realm.repo().join("jj")).unwrap();

        assert!(!staging.exists());
        assert_eq!(head(&service, &realm), done.revision);
    }

    #[test]
    fn tree_hash_in_a_missing_repo_is_not_found() {
        let realm = Realm::new("tree-no-repo");
        let error = CommitService::new()
            .tree_hash(&realm.repo(), &"ab".repeat(20))
            .unwrap_err();
        assert!(matches!(error, CommitError::RevisionNotFound(_)));
    }

    #[test]
    fn delete_removes_the_path() {
        let realm = Realm::new("delete");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let first = commit(
            &service,
            &realm,
            request(
                &root,
                "op-1",
                vec![write("dir/a.txt", "a"), write("b.txt", "b")],
            ),
        )
        .unwrap();

        let second = commit(
            &service,
            &realm,
            request(&first.revision, "op-2", vec![delete("dir/a.txt")]),
        )
        .unwrap();

        assert!(second.created);
        assert_eq!(files_at(&realm, &second.revision), files(&[("b.txt", "b")]));
        assert_eq!(
            files_at(&realm, &first.revision),
            files(&[("b.txt", "b"), ("dir/a.txt", "a")])
        );
    }

    #[test]
    fn unchanged_content_records_no_revision() {
        let realm = Realm::new("noop");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let first = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a.txt", "1")]),
        )
        .unwrap();

        let same = commit(
            &service,
            &realm,
            request(
                &first.revision,
                "op-2",
                vec![write("a.txt", "1"), delete("missing.txt")],
            ),
        )
        .unwrap();

        assert!(!same.created);
        assert_eq!(same.revision, first.revision);
        assert_eq!(head(&service, &realm), first.revision);
        assert_eq!(
            outcome(&service, &realm, "op-2"),
            OperationOutcome::Committed {
                revision: first.revision
            }
        );
    }

    #[test]
    fn identical_trees_have_identical_hashes() {
        let one = Realm::new("tree-one");
        let two = Realm::new("tree-two");
        let service = CommitService::new();
        let changes = || vec![write("Author/jane.json", "{}"), write("index.json", "[]")];
        let root_one = head(&service, &one);
        let root_two = head(&service, &two);

        let a = commit(&service, &one, request(&root_one, "op-a", changes())).unwrap();
        let mut other = request(&root_two, "op-b", changes());
        other.author.name = "Someone Else".into();
        other.message = "A different message".into();
        let b = commit(&service, &two, other).unwrap();

        assert_ne!(a.revision, b.revision);
        assert_eq!(a.tree, b.tree);
        let looked_up = service.tree_hash(&one.repo(), &a.revision).unwrap();
        assert_eq!(looked_up.tree, a.tree);
        let again = CommitService::new()
            .tree_hash(&one.repo(), &a.revision)
            .unwrap();
        assert_eq!(again.tree, a.tree);
    }

    #[test]
    fn tree_hash_of_an_unknown_revision_is_not_found() {
        let realm = Realm::new("tree-missing");
        let service = CommitService::new();
        head(&service, &realm);

        let error = service
            .tree_hash(&realm.repo(), &"ab".repeat(20))
            .unwrap_err();

        assert!(matches!(error, CommitError::RevisionNotFound(_)));
    }

    #[test]
    fn invalid_requests_are_refused() {
        let realm = Realm::new("invalid");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let invalid = |req: CommitRequest| {
            matches!(commit(&service, &realm, req), Err(CommitError::Invalid(_)))
        };

        assert!(invalid(request(&root, "../escape", vec![write("a", "")])));
        assert!(invalid(request(&root, ".hidden", vec![write("a", "")])));
        assert!(invalid(request("not-hex", "op", vec![write("a", "")])));
        assert!(invalid(request(&root, "op", vec![write("/abs", "")])));
        assert!(invalid(request(&root, "op", vec![write("a/../b", "")])));
        assert!(invalid(request(
            &root,
            "op",
            vec![write("a", "1"), delete("a")]
        )));
        let mut no_message = request(&root, "op", vec![write("a", "")]);
        no_message.message = " \n".into();
        assert!(invalid(no_message));
        let mut bad_author = request(&root, "op", vec![write("a", "")]);
        bad_author.author.email = "jane@example.com> evil".into();
        assert!(invalid(bad_author));
        let mut reserved = request(&root, "op", vec![write("a", "")]);
        reserved.trailers.push(CommitTrailer {
            key: "deckd-operation-id".into(),
            value: "other".into(),
        });
        assert!(invalid(reserved));
        let relative = service.head(Path::new("relative/.history"));
        assert!(matches!(relative, Err(CommitError::Invalid(_))));
        let orphan = service.head(&realm.root.join("missing/.history"));
        assert!(matches!(orphan, Err(CommitError::Invalid(_))));
        // None of those wrote anything.
        assert_eq!(head(&service, &realm), root);
    }

    #[test]
    fn reused_operation_id_with_a_different_request_is_refused() {
        let realm = Realm::new("op-reuse");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let done = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a", "1"), delete("gone")]),
        )
        .unwrap();

        // The same request replays, from a newer parent and in any order.
        let replay = commit(
            &service,
            &realm,
            request(
                &done.revision,
                "op-1",
                vec![delete("gone"), write("a", "1")],
            ),
        )
        .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.revision, done.revision);

        let mut other_message = request(&root, "op-1", vec![write("a", "1"), delete("gone")]);
        other_message.message = "Something else".into();
        for reused in [
            request(&root, "op-1", vec![write("a", "2"), delete("gone")]),
            request(&root, "op-1", vec![write("a", "1")]),
            other_message,
        ] {
            match commit(&service, &realm, reused) {
                Err(CommitError::OperationMismatch { revision, .. }) => {
                    assert_eq!(revision, done.revision)
                }
                other => panic!("expected operation-mismatch, got {other:?}"),
            }
        }
        assert_eq!(head(&service, &realm), done.revision);
    }

    #[test]
    fn unchanged_content_replay_is_checked_too() {
        let realm = Realm::new("noop-reuse");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let base = commit(
            &service,
            &realm,
            request(&root, "op-1", vec![write("a", "1")]),
        )
        .unwrap();
        commit(
            &service,
            &realm,
            request(&base.revision, "op-noop", vec![write("a", "1")]),
        )
        .unwrap();

        let reused = commit(
            &service,
            &realm,
            request(&base.revision, "op-noop", vec![write("a", "2")]),
        );
        assert!(matches!(reused, Err(CommitError::OperationMismatch { .. })));
    }

    #[test]
    fn spellings_of_one_repo_share_a_gate_that_is_pruned() {
        let realm = Realm::new("gate");
        let service = CommitService::new();
        head(&service, &realm);
        let alias = std::env::temp_dir().join(format!("deckd-commit-alias-{}", nonce()));
        std::os::unix::fs::symlink(&realm.root, &alias).unwrap();

        let direct = service.gate(&realm.repo()).unwrap();
        let via_alias = service
            .gate(&service.resolve_repo_dir(&alias.join(".history")).unwrap())
            .unwrap();
        assert!(Arc::ptr_eq(&direct, &via_alias));

        drop((direct, via_alias));
        let other = Realm::new("gate-other");
        head(&service, &other);
        // Only the gate of the latest call is left, and nothing holds it.
        let gates = service.gates.lock().unwrap();
        assert_eq!(gates.len(), 1);
        assert!(gates.values().all(|gate| gate.strong_count() == 0));
        drop(gates);
        std::fs::remove_file(alias).unwrap();
    }

    #[test]
    fn busy_gate_times_out() {
        let realm = Realm::new("gate-timeout");
        let service = CommitService::new();
        head(&service, &realm);
        let gate = service.gate(&realm.repo()).unwrap();
        let _held = gate.lock().unwrap();

        let started = Instant::now();
        let error = std::thread::scope(|s| {
            s.spawn(|| service.head(&realm.repo()).unwrap_err())
                .join()
                .unwrap()
        });

        assert!(matches!(error, CommitError::LockTimeout(_)), "{error:?}");
        assert!(started.elapsed() >= LOCK_TIMEOUT);
    }

    #[test]
    fn repos_outside_the_root_are_refused() {
        let inside = Realm::new("root-inside");
        let outside = Realm::new("root-outside");
        let service = CommitService::with_root(&inside.root).unwrap();
        let escape = inside.root.join("escape");
        std::os::unix::fs::symlink(&outside.root, &escape).unwrap();

        assert!(service.head(&inside.repo()).is_ok());
        for repo in [outside.repo(), escape, inside.root.clone()] {
            assert!(
                matches!(service.head(&repo), Err(CommitError::Invalid(_))),
                "{repo:?}"
            );
        }
        assert!(matches!(
            service.tree_hash(&outside.repo(), &"ab".repeat(20)),
            Err(CommitError::Invalid(_))
        ));
        assert!(!outside.repo().exists());
    }

    #[test]
    fn unpublished_commit_has_no_tree_hash() {
        let realm = Realm::new("orphan");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let orphan = unpublished_commit(&realm, &root, "op-crashed");

        let error = service.tree_hash(&realm.repo(), &orphan).unwrap_err();

        assert!(
            matches!(error, CommitError::RevisionNotFound(_)),
            "{error:?}"
        );
        assert!(service.tree_hash(&realm.repo(), &root).is_ok());
    }

    #[test]
    fn rewriting_an_executable_file_keeps_it_executable() {
        let realm = Realm::new("executable");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let path = RepoPathBuf::from_internal_string("run.sh".to_owned()).unwrap();
        // Explicit commits write only regular files; imported history may not.
        let seeded = pollster::block_on(async {
            let repo = load_repo(&realm.repo()).await.unwrap();
            let parent = get_commit(&repo, &root).unwrap();
            let id = repo
                .store()
                .write_file(&path, &mut &b"#!/bin/sh\n"[..])
                .await
                .unwrap();
            let mut builder = MergedTreeBuilder::new(parent.tree());
            builder.set_or_remove(
                path.clone(),
                Merge::normal(TreeValue::File {
                    id,
                    executable: true,
                    copy_id: CopyId::placeholder(),
                }),
            );
            let tree = builder.write_tree().await.unwrap();
            let mut tx = repo.start_transaction();
            let commit = tx
                .repo_mut()
                .new_commit(vec![parent.id().clone()], tree)
                .set_description("seed\n")
                .write()
                .await
                .unwrap();
            tx.commit("seed").await.unwrap();
            commit.id().hex()
        });
        set_recorded_head(&realm, &seeded);

        let done = commit(
            &service,
            &realm,
            request(&seeded, "op-1", vec![write("run.sh", "#!/bin/sh\necho\n")]),
        )
        .unwrap();

        let executable = pollster::block_on(async {
            let repo = load_repo(&realm.repo()).await.unwrap();
            let tree = get_commit(&repo, &done.revision).unwrap().tree();
            match tree.path_value(&path).await.unwrap().into_resolved() {
                Ok(Some(TreeValue::File { executable, .. })) => executable,
                other => panic!("unexpected {other:?}"),
            }
        });
        assert!(executable);
    }

    fn git_blob_id(content: &str) -> String {
        let mut child = std::process::Command::new("git")
            .args(["hash-object", "--stdin"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(content.as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        String::from_utf8(output.stdout).unwrap().trim().to_owned()
    }

    #[test]
    fn tree_lists_every_file_with_its_git_blob_id() {
        let realm = Realm::new("tree-lists");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let revision = commit(
            &service,
            &realm,
            request(
                &root,
                "op-tree",
                vec![
                    write("b.json", "{\"b\":1}"),
                    write("dir/a.gts", "export {}"),
                ],
            ),
        )
        .unwrap()
        .revision;
        let entries = service.tree(&realm.repo(), &revision).unwrap();
        assert_eq!(
            entries,
            vec![
                TreeEntry {
                    path: "b.json".into(),
                    blob: git_blob_id("{\"b\":1}"),
                    executable: false,
                },
                TreeEntry {
                    path: "dir/a.gts".into(),
                    blob: git_blob_id("export {}"),
                    executable: false,
                },
            ]
        );
        assert_eq!(service.tree(&realm.repo(), &root).unwrap(), vec![]);
    }

    #[test]
    fn tree_of_an_unknown_revision_is_not_found() {
        let realm = Realm::new("tree-unknown");
        let service = CommitService::new();
        head(&service, &realm);
        let result = service.tree(&realm.repo(), &"ab".repeat(20));
        assert!(matches!(result, Err(CommitError::RevisionNotFound(_))));
    }

    #[test]
    fn read_returns_each_path_at_the_revision() {
        let realm = Realm::new("read-at");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let first = commit(
            &service,
            &realm,
            request(
                &root,
                "op-1",
                vec![write("a.txt", "one"), write("d/b.txt", "two")],
            ),
        )
        .unwrap()
        .revision;
        let second = commit(
            &service,
            &realm,
            request(
                &first,
                "op-2",
                vec![write("a.txt", "uno"), delete("d/b.txt")],
            ),
        )
        .unwrap()
        .revision;
        let paths: Vec<String> = ["a.txt", "d/b.txt", "d", "missing.txt"]
            .iter()
            .map(|p| p.to_string())
            .collect();
        let at = |revision: &str| {
            let found = service.read(&realm.repo(), revision, &paths).unwrap();
            assert!(found.remaining.is_empty());
            found
                .files
                .into_iter()
                .map(|f| (f.path, f.content.map(|c| String::from_utf8(c).unwrap())))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            at(&first),
            vec![
                ("a.txt".into(), Some("one".into())),
                ("d/b.txt".into(), Some("two".into())),
                ("d".into(), None),
                ("missing.txt".into(), None),
            ]
        );
        assert_eq!(
            at(&second),
            vec![
                ("a.txt".into(), Some("uno".into())),
                ("d/b.txt".into(), None),
                ("d".into(), None),
                ("missing.txt".into(), None),
            ]
        );
    }

    #[test]
    fn read_stops_before_the_byte_ceiling_and_names_the_rest() {
        let realm = Realm::new("read-ceiling");
        let service = CommitService::new();
        let root = head(&service, &realm);
        let revision = commit(
            &service,
            &realm,
            request(
                &root,
                "op-big",
                vec![
                    write("a.txt", "0123456789"),
                    write("b.txt", "0123456789"),
                    write("c.txt", "0123456789abcdefghij"),
                ],
            ),
        )
        .unwrap()
        .revision;
        let paths: Vec<String> = ["a.txt", "b.txt", "c.txt"]
            .iter()
            .map(|p| p.to_string())
            .collect();
        let found = service.read(&realm.repo(), &revision, &paths).unwrap();
        assert_eq!(
            found
                .files
                .iter()
                .map(|f| f.path.as_str())
                .collect::<Vec<_>>(),
            vec!["a.txt"]
        );
        assert_eq!(
            found.remaining,
            vec!["b.txt".to_string(), "c.txt".to_string()]
        );
        // A file over the ceiling on its own is still returned when it is
        // the first asked for, so every path can be read.
        let found = service
            .read(&realm.repo(), &revision, &found.remaining[1..])
            .unwrap();
        assert_eq!(found.files[0].content.as_ref().map(Vec::len), Some(20));
        assert!(found.remaining.is_empty());
    }

    #[test]
    fn read_refuses_invalid_paths() {
        let realm = Realm::new("read-invalid");
        let service = CommitService::new();
        let root = head(&service, &realm);
        for path in ["../x", "/abs", "a//b", ".git/config"] {
            let result = service.read(&realm.repo(), &root, &[path.to_string()]);
            assert!(
                matches!(result, Err(CommitError::Invalid(_))),
                "{path} was not refused"
            );
        }
    }
}
