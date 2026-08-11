//! Timeline trait — opaque change ids, same contract as Deck's HistoryBackend.

use std::future::Future;
use std::path::Path;
use std::pin::Pin;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(feature = "jj-cli")]
pub mod jj_cli;
pub mod jj_lib;
pub mod jj_lib_notes;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Actor {
    pub name: String,
    #[serde(default)]
    pub email: Option<String>,
}

/// Wire shape matching Deck `HistoryEntry` / historyd stub tests.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub change_id: String,
    pub commit_id: String,
    pub timestamp: String,
    pub description: String,
    pub files_summary: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
}

/// Wire shape matching Deck `RestorePlan`: path lists only (bytes via file-at).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestorePlan {
    pub writes: Vec<String>,
    pub deletes: Vec<String>,
}

#[derive(Debug, Error)]
pub enum TimelineError {
    #[error("not found: {0}")]
    #[allow(dead_code)]
    NotFound(String),
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error("jj: {0}")]
    Jj(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub trait Timeline: Send + Sync {
    fn ensure<'a>(&'a self, dir: &'a str) -> BoxFuture<'a, Result<(), TimelineError>>;

    /// Fire-and-forget remember: schedule an async collapsed seal. Returns
    /// immediately; many notes across many depots must not block the caller.
    fn note<'a>(
        &'a self,
        dir: &'a str,
        path: &'a str,
    ) -> BoxFuture<'a, Result<(), TimelineError>> {
        let _ = (dir, path);
        Box::pin(async { Err(TimelineError::Invalid("note not supported".into())) })
    }

    /// Seal any pending async notes for `dir` now. No-op when nothing pending.
    fn flush_notes<'a>(
        &'a self,
        dir: &'a str,
    ) -> BoxFuture<'a, Result<Option<String>, TimelineError>> {
        let _ = dir;
        Box::pin(async { Ok(None) })
    }

    fn seal<'a>(
        &'a self,
        dir: &'a str,
        message: &'a str,
        actor: Option<&'a Actor>,
    ) -> BoxFuture<'a, Result<Option<String>, TimelineError>>;

    fn list<'a>(&'a self, dir: &'a str) -> BoxFuture<'a, Result<Vec<HistoryEntry>, TimelineError>>;

    fn file_at<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
        path: &'a str,
    ) -> BoxFuture<'a, Result<Option<Vec<u8>>, TimelineError>>;

    fn file_list_at<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, TimelineError>>;

    fn restore_plan<'a>(
        &'a self,
        dir: &'a str,
        revision_id: &'a str,
    ) -> BoxFuture<'a, Result<RestorePlan, TimelineError>>;
}

pub fn timeline_dir(depot: &Path) -> std::path::PathBuf {
    depot.join(".deck").join("timeline")
}

pub fn auto_track_fileset() -> &'static str {
    r#"'all() ~ glob:".deck/**" ~ glob:".deck" ~ glob:".git/**" ~ glob:".git" ~ glob:".gitignore" ~ glob:"node_modules/**" ~ glob:"node_modules" ~ glob:".DS_Store" ~ glob:".boxel-history/**" ~ glob:".boxel-history"'"#
}

/// Machinery / VCS paths that must never appear in Timeline tree listings or
/// restore plans — even if an older seal accidentally tracked them.
pub fn is_machinery_path(path: &str) -> bool {
    path == ".deck"
        || path.starts_with(".deck/")
        || path == ".jj"
        || path.starts_with(".jj/")
        || path == ".git"
        || path.starts_with(".git/")
        || path == ".gitignore"
        || path == "node_modules"
        || path.starts_with("node_modules/")
        || path == ".DS_Store"
        || path == ".boxel-history"
        || path.starts_with(".boxel-history/")
}
