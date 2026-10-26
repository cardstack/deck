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
//!   deckd/commit.lock         # cross-process lock around commit / outcome
//!   deckd/operations/<opId>   # `pending` | `committed <rev>` | `fenced`
//! ```
//!
//! Correctness rests on files in the repo, never on this process's memory:
//!
//! - `commit` and `outcome` run under a flock on `deckd/commit.lock`, so
//!   deckd processes on different hosts sharing the directory serialize. A
//!   per-repo in-process mutex sits in front of it because Linux NFS emulates
//!   flock with POSIX locks, which don't exclude threads of one process.
//! - Whether an operation record exists is only ever learned from
//!   `create_new` (O_EXCL), which the NFS server answers. A peer's cached
//!   negative lookup can't make an existing record look absent.
//! - Every commit carries a `Deckd-Operation-Id` trailer. Before acting, each
//!   locked call sets HEAD's operation record to `committed HEAD`. A crash
//!   after publishing but before writing the record can only leave HEAD
//!   unrecorded, so after that repair every committed operation has a record.

use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Write as _};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jj_lib::backend::{BackendError, CommitId, CopyId, Signature, Timestamp, TreeValue};
use jj_lib::commit::Commit;
use jj_lib::default_backend_factories::default_backend_factories;
use jj_lib::lock::FileLock;
use jj_lib::merge::Merge;
use jj_lib::merged_tree_builder::MergedTreeBuilder;
use jj_lib::object_id::ObjectId as _;
use jj_lib::repo::{ReadonlyRepo, Repo as _, RepoLoader};
use jj_lib::repo_path::RepoPathBuf;
use jj_lib::signing_factory::signer_from_settings;
use jj_lib::trailer::parse_description_trailers;
use serde::{Deserialize, Serialize};

use super::jj_lib::{hermetic_git_env, is_valid_history_path, user_settings};

/// Trailer deckd adds to every explicit commit. Callers may not set it.
const OPERATION_ID_TRAILER: &str = "Deckd-Operation-Id";

/// How long a call waits for another process's commit lock before giving up.
const LOCK_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, thiserror::Error)]
pub enum CommitError {
    #[error("{0}")]
    Invalid(String),
    #[error("parent {parent} is not HEAD {head}")]
    ParentMismatch { parent: String, head: String },
    #[error("operation {0} was reported absent and can never commit")]
    OperationFenced(String),
    #[error("revision {0} not found")]
    RevisionNotFound(String),
    #[error("timed out waiting for the commit lock on {0}")]
    LockTimeout(String),
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

/// Explicit-content commits, operation outcomes and tree hashes. Holds no
/// state that correctness depends on; a fresh instance behaves exactly like
/// one that has been running.
pub struct CommitService {
    gates: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}

impl Default for CommitService {
    fn default() -> Self {
        Self::new()
    }
}

impl CommitService {
    pub fn new() -> Self {
        hermetic_git_env();
        Self {
            gates: Mutex::new(HashMap::new()),
        }
    }

    /// Record `request.changes` as one revision on top of `request.parent`.
    /// Runs on a blocking thread: it waits on locks and drives jj-lib's
    /// `!Send` futures to completion while holding them.
    pub fn commit(&self, repo_dir: &Path, request: CommitRequest) -> CommitResult<CommitOutcome> {
        validate_repo_dir(repo_dir)?;
        validate_operation_id(&request.operation_id)?;
        validate_commit_request(&request)?;
        let gate = self.gate(repo_dir);
        let _in_process = gate.lock().unwrap_or_else(|e| e.into_inner());
        let _file_lock = lock_repo(repo_dir)?;
        pollster::block_on(commit_locked(repo_dir, request))
    }

    /// Report whether `operation_id` committed. Reporting it absent fences it:
    /// from then on a commit with that ID is refused.
    pub fn outcome(&self, repo_dir: &Path, operation_id: &str) -> CommitResult<OperationOutcome> {
        validate_repo_dir(repo_dir)?;
        validate_operation_id(operation_id)?;
        let gate = self.gate(repo_dir);
        let _in_process = gate.lock().unwrap_or_else(|e| e.into_inner());
        let _file_lock = lock_repo(repo_dir)?;
        pollster::block_on(outcome_locked(repo_dir, operation_id))
    }

    /// The current HEAD, creating an empty repo (HEAD is the root commit) if
    /// there is none yet.
    pub fn head(&self, repo_dir: &Path) -> CommitResult<RevisionTree> {
        validate_repo_dir(repo_dir)?;
        let repo = if repo_dir.join("jj").is_dir() {
            pollster::block_on(load_repo(repo_dir))?
        } else {
            let gate = self.gate(repo_dir);
            let _in_process = gate.lock().unwrap_or_else(|e| e.into_inner());
            let _file_lock = lock_repo(repo_dir)?;
            pollster::block_on(load_or_init(repo_dir))?
        };
        let head = head_commit(&repo)?;
        Ok(RevisionTree {
            revision: head.id().hex(),
            tree: tree_hash(&head),
        })
    }

    pub fn tree_hash(&self, repo_dir: &Path, revision: &str) -> CommitResult<RevisionTree> {
        validate_repo_dir(repo_dir)?;
        if !repo_dir.join("jj").is_dir() {
            return Err(CommitError::RevisionNotFound(revision.to_owned()));
        }
        let repo = pollster::block_on(load_repo(repo_dir))?;
        let commit = get_commit(&repo, revision)?;
        Ok(RevisionTree {
            revision: commit.id().hex(),
            tree: tree_hash(&commit),
        })
    }

    fn gate(&self, repo_dir: &Path) -> Arc<Mutex<()>> {
        let mut gates = self.gates.lock().unwrap_or_else(|e| e.into_inner());
        gates
            .entry(repo_dir.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

/// The body of [`CommitService::commit`]. Callers hold both repo locks.
async fn commit_locked(repo_dir: &Path, request: CommitRequest) -> CommitResult<CommitOutcome> {
    let repo = load_or_init(repo_dir).await?;
    let head = head_commit(&repo)?;
    repair_head_record(repo_dir, &head)?;

    let record_path = operation_record_path(repo_dir, &request.operation_id);
    if !claim_record(&record_path, Record::Pending)? {
        match read_record(&record_path)? {
            Record::Committed(revision) => {
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
            // would have marked it committed if it had. Take it over.
            Record::Pending => {}
        }
    }

    let head_hex = head.id().hex();
    if CommitId::try_from_hex(&request.parent).as_ref() != Some(head.id()) {
        // Leave no claim behind, so the caller can retry this operation
        // on the new HEAD.
        std::fs::remove_file(&record_path).map_err(internal)?;
        return Err(CommitError::ParentMismatch {
            parent: request.parent,
            head: head_hex,
        });
    }

    let tree = build_tree(&repo, &head, &request.changes).await?;
    if tree.tree_ids() == head.tree_ids() {
        write_record(&record_path, &Record::Committed(head_hex.clone()))?;
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
    tx.commit(format!(
        "commit {} for operation {}",
        commit.id().hex(),
        request.operation_id
    ))
    .await
    .map_err(internal)?;

    let revision = commit.id().hex();
    write_record(&record_path, &Record::Committed(revision.clone()))?;
    Ok(CommitOutcome {
        revision,
        tree: tree_hash(&commit),
        created: true,
        replayed: false,
    })
}

/// The body of [`CommitService::outcome`]. Callers hold both repo locks.
async fn outcome_locked(repo_dir: &Path, operation_id: &str) -> CommitResult<OperationOutcome> {
    let repo = load_or_init(repo_dir).await?;
    let head = head_commit(&repo)?;
    repair_head_record(repo_dir, &head)?;

    let record_path = operation_record_path(repo_dir, operation_id);
    if claim_record(&record_path, Record::Fenced)? {
        return Ok(OperationOutcome::Absent);
    }
    match read_record(&record_path)? {
        Record::Committed(revision) => Ok(OperationOutcome::Committed { revision }),
        Record::Fenced => Ok(OperationOutcome::Absent),
        Record::Pending => {
            write_record(&record_path, &Record::Fenced)?;
            Ok(OperationOutcome::Absent)
        }
    }
}

/// Take the cross-process commit lock on `repo_dir`, creating the repo
/// directory if needed. Callers hold the repo's in-process gate first.
fn lock_repo(repo_dir: &Path) -> CommitResult<FileLock> {
    create_repo_dir(repo_dir)?;
    let deckd_dir = repo_dir.join("deckd");
    std::fs::create_dir_all(deckd_dir.join("operations")).map_err(internal)?;
    let lock_path = deckd_dir.join("commit.lock");
    let started = Instant::now();
    loop {
        match FileLock::try_lock(lock_path.clone()).map_err(internal)? {
            Some(file_lock) => return Ok(file_lock),
            None if started.elapsed() >= LOCK_TIMEOUT => {
                return Err(CommitError::LockTimeout(repo_dir.display().to_string()))
            }
            None => std::thread::sleep(Duration::from_millis(10)),
        }
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
        if !is_valid_history_path(&change.path) {
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
        std::fs::rename(&staging, &jj_dir).map_err(internal)?;
    }
    load_repo(repo_dir).await
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

async fn build_tree(
    repo: &Arc<ReadonlyRepo>,
    parent: &Commit,
    changes: &[Change],
) -> CommitResult<jj_lib::merged_tree::MergedTree> {
    let store = repo.store();
    let mut builder = MergedTreeBuilder::new(parent.tree());
    for change in changes {
        let path = RepoPathBuf::from_internal_string(change.path.clone())
            .map_err(|e| CommitError::Invalid(format!("invalid path {:?}: {e}", change.path)))?;
        let value = match &change.content {
            Some(bytes) => {
                let id = store
                    .write_file(&path, &mut bytes.as_slice())
                    .await
                    .map_err(internal)?;
                Merge::normal(TreeValue::File {
                    id,
                    executable: false,
                    copy_id: CopyId::placeholder(),
                })
            }
            None => Merge::absent(),
        };
        builder.set_or_remove(path, value);
    }
    builder.write_tree().await.map_err(internal)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Record {
    Pending,
    Committed(String),
    Fenced,
}

impl Record {
    fn encode(&self) -> String {
        match self {
            Record::Pending => "pending\n".into(),
            Record::Committed(revision) => format!("committed {revision}\n"),
            Record::Fenced => "fenced\n".into(),
        }
    }

    fn decode(text: &str) -> CommitResult<Self> {
        let text = text.trim();
        match text.split_once(' ') {
            None if text == "pending" || text.is_empty() => Ok(Record::Pending),
            None if text == "fenced" => Ok(Record::Fenced),
            Some(("committed", revision)) => Ok(Record::Committed(revision.to_owned())),
            _ => Err(CommitError::Internal(format!(
                "unreadable operation record {text:?}"
            ))),
        }
    }
}

fn operation_record_path(repo_dir: &Path, operation_id: &str) -> PathBuf {
    repo_dir.join("deckd").join("operations").join(operation_id)
}

/// Create the record with `create_new`. Returns false when it already exists.
/// An empty record (a crash between create and write) reads as `pending`.
fn claim_record(path: &Path, record: Record) -> CommitResult<bool> {
    let mut file = match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == ErrorKind::AlreadyExists => return Ok(false),
        Err(e) => return Err(internal(e)),
    };
    file.write_all(record.encode().as_bytes())
        .map_err(internal)?;
    file.sync_all().map_err(internal)?;
    Ok(true)
}

fn read_record(path: &Path) -> CommitResult<Record> {
    Record::decode(&std::fs::read_to_string(path).map_err(internal)?)
}

/// Replace a record atomically: write a temporary file, then rename it over.
fn write_record(path: &Path, record: &Record) -> CommitResult<()> {
    let dir = path
        .parent()
        .ok_or_else(|| CommitError::Internal("operation record has no parent".into()))?;
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
    File::open(dir)
        .and_then(|d| d.sync_all())
        .map_err(internal)?;
    Ok(())
}

/// Make HEAD's operation record say `committed HEAD`. The record is written
/// whenever it doesn't already say so, including when reading it fails: a
/// missing file may only be a stale NFS lookup, and the write is the truth.
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
    let expected = Record::Committed(head.id().hex());
    if read_record(&path).ok().as_ref() != Some(&expected) {
        write_record(&path, &expected)?;
    }
    Ok(())
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
    use futures::AsyncReadExt as _;

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
}
