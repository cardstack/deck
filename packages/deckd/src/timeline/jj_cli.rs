//! Timeline via `jj` CLI (fork/exec).
//!
//! Layout (no symlink, no nested-marker hack):
//! - Durable store: `<depot>/.deck/timeline/repo/`
//! - jj workspace stub: `<depot>/.jj/{repo` file, `working_copy/}`
//!   where `.jj/repo` is a *file* whose contents are the relative path
//!   `../.deck/timeline/repo` (jj's supported out-of-tree repo pointer,
//!   same idea as git's `gitdir:` file — not a Deck invention).
//!
//! jj still requires a `.jj` directory at the working-copy root to discover
//! the workspace; until jj-lib can root the dir under `.deck/`, that stub is
//! the only top-level machinery. The op/git store lives only under `.deck`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;

use super::{
    auto_track_fileset, is_machinery_path, timeline_dir, Actor, BoxFuture, HistoryEntry,
    RestorePlan, Timeline, TimelineError,
};

const DEFAULT_NAME: &str = "deck-history";
const DEFAULT_EMAIL: &str = "deck-history@localhost";
const FIELD_SEP: char = '\x1f';
const RECORD_SEP: char = '\x1e';
/// Relative to `<depot>/.jj/` — jj resolves this against the `.jj` directory.
const REPO_POINTER: &str = "../.deck/timeline/repo";

pub struct JjCliTimeline {
    jj_bin: String,
    locks: Mutex<std::collections::HashMap<String, std::sync::Arc<AsyncMutex<()>>>>,
}

impl JjCliTimeline {
    pub fn new(jj_bin: impl Into<String>) -> Self {
        Self {
            jj_bin: jj_bin.into(),
            locks: Mutex::new(std::collections::HashMap::new()),
        }
    }

    fn lock_for(&self, dir: &str) -> std::sync::Arc<AsyncMutex<()>> {
        let mut map = self.locks.lock().expect("locks");
        map.entry(dir.to_string())
            .or_insert_with(|| std::sync::Arc::new(AsyncMutex::new(())))
            .clone()
    }

    async fn ensure_inner(&self, depot: &Path) -> Result<(), TimelineError> {
        let tl = timeline_dir(depot);
        let jj = depot.join(".jj");
        let tl_repo = tl.join("repo");
        let jj_repo = jj.join("repo");
        tokio::fs::create_dir_all(depot.join(".deck")).await?;

        // Already on the thin stub layout.
        if jj_repo.is_file() && tl_repo.is_dir() && jj.join("working_copy").is_dir() {
            self.scrub_machinery(depot, &tl).await;
            return Ok(());
        }

        // Prior POC: `.jj` → symlink to `.deck/timeline` (+ nested marker).
        if jj.is_symlink() {
            tokio::fs::remove_file(&jj).await?;
            tokio::fs::create_dir_all(&jj).await?;
            if !tl_repo.is_dir() {
                return Err(TimelineError::Invalid(format!(
                    "symlink .jj removed but {} is missing",
                    tl_repo.display()
                )));
            }
            let tl_wc = tl.join("working_copy");
            let jj_wc = jj.join("working_copy");
            if tl_wc.is_dir() && !jj_wc.exists() {
                tokio::fs::rename(&tl_wc, &jj_wc).await?;
            }
            if !jj_wc.is_dir() {
                return Err(TimelineError::Invalid(
                    "timeline has no working_copy to place under .jj/".into(),
                ));
            }
            write_repo_pointer(&jj_repo).await?;
            self.scrub_machinery(depot, &tl).await;
            return Ok(());
        }

        // Classic: full `.jj/repo` directory at the depot root → relocate store.
        if jj_repo.is_dir() {
            tokio::fs::create_dir_all(&tl).await?;
            if tl_repo.exists() {
                return Err(TimelineError::Invalid(format!(
                    "both {} and {} exist; resolve manually",
                    jj_repo.display(),
                    tl_repo.display()
                )));
            }
            tokio::fs::rename(&jj_repo, &tl_repo).await?;
            write_repo_pointer(&jj_repo).await?;
            self.scrub_machinery(depot, &tl).await;
            return Ok(());
        }

        // Fresh depot.
        let out = Command::new(&self.jj_bin)
            .args([
                "--no-pager",
                "--color=never",
                "git",
                "init",
                "--no-colocate",
                "--config",
                "git.colocate=false",
            ])
            .current_dir(depot)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await?;
        if !out.status.success() {
            return Err(TimelineError::Jj(stderr_string(&out)));
        }
        if !jj_repo.is_dir() {
            return Err(TimelineError::Jj(
                "jj git init did not create .jj/repo".into(),
            ));
        }
        tokio::fs::create_dir_all(&tl).await?;
        tokio::fs::rename(&jj_repo, &tl_repo).await?;
        write_repo_pointer(&jj_repo).await?;
        Ok(())
    }

    async fn scrub_machinery(&self, depot: &Path, timeline: &Path) {
        let _ = self
            .jj(depot, &["file", "untrack", r#"glob:".deck/**""#], None)
            .await;
        let marker = timeline.join(".jj");
        if marker.is_file() {
            let _ = tokio::fs::remove_file(&marker).await;
        }
    }

    async fn jj(
        &self,
        depot: &Path,
        args: &[&str],
        actor: Option<&Actor>,
    ) -> Result<std::process::Output, TimelineError> {
        let name = actor
            .map(|a| sanitize(&a.name))
            .unwrap_or_else(|| DEFAULT_NAME.into());
        let email = actor
            .and_then(|a| a.email.as_deref())
            .map(sanitize)
            .unwrap_or_else(|| DEFAULT_EMAIL.into());

        let mut cmd = Command::new(&self.jj_bin);
        cmd.args([
            "--no-pager",
            "--color=never",
            "--config",
            &format!("user.name=\"{name}\""),
            "--config",
            &format!("user.email=\"{email}\""),
            "--config",
            &format!("snapshot.auto-track={}", auto_track_fileset()),
        ])
        .args(args)
        .current_dir(depot)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

        let out = cmd.output().await?;
        if !out.status.success() {
            return Err(TimelineError::Jj(stderr_string(&out)));
        }
        Ok(out)
    }
}

impl Timeline for JjCliTimeline {
    fn ensure<'a>(&'a self, dir: &'a str) -> BoxFuture<'a, Result<(), TimelineError>> {
        Box::pin(async move {
            let depot = PathBuf::from(dir);
            let lock = self.lock_for(dir);
            let _g = lock.lock().await;
            self.ensure_inner(&depot).await
        })
    }

    fn seal<'a>(
        &'a self,
        dir: &'a str,
        message: &'a str,
        actor: Option<&'a Actor>,
    ) -> BoxFuture<'a, Result<Option<String>, TimelineError>> {
        Box::pin(async move {
            let depot = PathBuf::from(dir);
            let lock = self.lock_for(dir);
            let _g = lock.lock().await;
            self.ensure_inner(&depot).await?;

            let status = self
                .jj(
                    &depot,
                    &[
                        "log",
                        "--no-graph",
                        "-r",
                        "@",
                        "-T",
                        r#"if(empty, "empty", "dirty")"#,
                    ],
                    actor,
                )
                .await?;
            if String::from_utf8_lossy(&status.stdout).trim() != "dirty" {
                return Ok(None);
            }

            // jj stamps author when the working-copy change is *created*.
            // `commit` alone would keep the previous identity — rewrite author
            // onto `@` before sealing when the caller supplied an actor.
            if actor.is_some() {
                self.jj(&depot, &["metaedit", "--update-author", "-r", "@"], actor)
                    .await?;
            }

            self.jj(&depot, &["commit", "-m", message], actor).await?;

            let id = self
                .jj(
                    &depot,
                    &["log", "--no-graph", "-r", "@-", "-T", "change_id"],
                    actor,
                )
                .await?;
            let change_id = String::from_utf8_lossy(&id.stdout).trim().to_string();
            if change_id.is_empty() {
                return Ok(None);
            }
            Ok(Some(change_id))
        })
    }

    fn list<'a>(&'a self, dir: &'a str) -> BoxFuture<'a, Result<Vec<HistoryEntry>, TimelineError>> {
        Box::pin(async move {
            let depot = PathBuf::from(dir);
            let lock = self.lock_for(dir);
            let _g = lock.lock().await;
            self.ensure_inner(&depot).await?;

            // Match Deck jj-cli HistoryEntry fields.
            let template = format!(
                "change_id ++ \"{FIELD_SEP}\" ++ commit_id ++ \"{FIELD_SEP}\" ++ \
                 committer.timestamp().format(\"%Y-%m-%dT%H:%M:%S%z\") ++ \"{FIELD_SEP}\" ++ \
                 description.first_line() ++ \"{FIELD_SEP}\" ++ \
                 if(empty, \"empty\", \"change\") ++ \"{FIELD_SEP}\" ++ \
                 author.name() ++ \"{FIELD_SEP}\" ++ \
                 diff.summary() ++ \"{RECORD_SEP}\""
            );
            let out = self
                .jj(
                    &depot,
                    &["log", "--no-graph", "-r", "::@ ~ root()", "-T", &template],
                    None,
                )
                .await?;
            let text = String::from_utf8_lossy(&out.stdout);
            let mut entries = Vec::new();
            for rec in text.split(RECORD_SEP) {
                if rec.trim().is_empty() {
                    continue;
                }
                let mut parts = rec.split(FIELD_SEP);
                let change_id = parts.next().unwrap_or("").to_string();
                let commit_id = parts.next().unwrap_or("").to_string();
                let timestamp = parts.next().unwrap_or("").to_string();
                let description = parts.next().unwrap_or("").to_string();
                let emptiness = parts.next().unwrap_or("");
                let author = parts.next().unwrap_or("").to_string();
                let summary = parts.next().unwrap_or("");
                if emptiness == "empty" || change_id.is_empty() {
                    continue;
                }
                entries.push(HistoryEntry {
                    change_id,
                    commit_id,
                    timestamp,
                    description,
                    author: if author.is_empty() || author == DEFAULT_NAME {
                        None
                    } else {
                        Some(author)
                    },
                    files_summary: summary
                        .lines()
                        .map(|l| l.trim().to_string())
                        .filter(|l| !l.is_empty())
                        .collect(),
                });
            }
            Ok(entries)
        })
    }

    fn file_at<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
        path: &'a str,
    ) -> BoxFuture<'a, Result<Option<Vec<u8>>, TimelineError>> {
        Box::pin(async move {
            let depot = PathBuf::from(dir);
            let lock = self.lock_for(dir);
            let _g = lock.lock().await;
            self.ensure_inner(&depot).await?;
            match self
                .jj(&depot, &["file", "show", "-r", revision_id, path], None)
                .await
            {
                Ok(out) => Ok(Some(out.stdout)),
                Err(TimelineError::Jj(msg))
                    if msg.contains("No such path")
                        || msg.contains("doesn't exist")
                        || msg.contains("not found") =>
                {
                    Ok(None)
                }
                Err(e) => Err(e),
            }
        })
    }

    fn file_list_at<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, TimelineError>> {
        Box::pin(async move {
            let depot = PathBuf::from(dir);
            let lock = self.lock_for(dir);
            let _g = lock.lock().await;
            self.ensure_inner(&depot).await?;
            let out = self
                .jj(&depot, &["file", "list", "-r", revision_id], None)
                .await?;
            Ok(String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty() && !is_machinery_path(l))
                .collect())
        })
    }

    fn restore_plan<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
    ) -> BoxFuture<'a, Result<RestorePlan, TimelineError>> {
        Box::pin(async move {
            let depot = PathBuf::from(dir);
            let lock = self.lock_for(dir);
            let _g = lock.lock().await;
            self.ensure_inner(&depot).await?;

            // Diff @ → revisionId summary (same as Deck jj-cli).
            let out = self
                .jj(
                    &depot,
                    &[
                        "diff",
                        "--summary",
                        "--from",
                        "@",
                        "--to",
                        revision_id,
                    ],
                    None,
                )
                .await?;
            let mut writes = Vec::new();
            let mut deletes = Vec::new();
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let Some((status, raw)) = line.split_once(' ') else {
                    return Err(TimelineError::Jj(format!(
                        "unrecognized diff summary line: {line}"
                    )));
                };
                match status {
                    "M" | "A" => {
                        if !is_machinery_path(raw) {
                            writes.push(raw.to_string());
                        }
                    }
                    "D" => {
                        if !is_machinery_path(raw) {
                            deletes.push(raw.to_string());
                        }
                    }
                    "R" => {
                        let (from, to) = expand_rename(raw);
                        if !is_machinery_path(&to) {
                            writes.push(to);
                        }
                        if !is_machinery_path(&from) {
                            deletes.push(from);
                        }
                    }
                    "C" => {
                        let (_from, to) = expand_rename(raw);
                        if !is_machinery_path(&to) {
                            writes.push(to);
                        }
                    }
                    _ => {
                        return Err(TimelineError::Jj(format!(
                            "unrecognized diff summary line: {line}"
                        )));
                    }
                }
            }
            Ok(RestorePlan { writes, deletes })
        })
    }
}

fn expand_rename(raw: &str) -> (String, String) {
    // `R {old => new}` or `R sub/{a => b}.txt`
    if let Some(open) = raw.find('{') {
        if let Some(close) = raw.find('}') {
            let prefix = &raw[..open];
            let suffix = &raw[close + 1..];
            let mid = &raw[open + 1..close];
            if let Some((from, to)) = mid.split_once(" => ") {
                return (
                    format!("{prefix}{from}{suffix}"),
                    format!("{prefix}{to}{suffix}"),
                );
            }
        }
    }
    (raw.to_string(), raw.to_string())
}

async fn write_repo_pointer(jj_repo: &Path) -> Result<(), TimelineError> {
    if let Some(parent) = jj_repo.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(jj_repo, REPO_POINTER.as_bytes()).await?;
    Ok(())
}

fn sanitize(value: &str) -> String {
    value.replace('"', "").chars().take(200).collect()
}

fn stderr_string(out: &std::process::Output) -> String {
    let s = String::from_utf8_lossy(&out.stderr);
    if s.trim().is_empty() {
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    } else {
        s.trim().to_string()
    }
}
