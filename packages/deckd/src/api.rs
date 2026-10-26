//! HTTP surface — historyd-compatible History routes (+ optional build plane).

use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tower_http::trace::TraceLayer;

use crate::history::commit::{
    Author, Change, CommitError, CommitOutcome, CommitRequest, CommitService, CommitTrailer,
    OperationOutcome, RevisionTree,
};
use crate::history::{Actor, HistoryBackend, HistoryBackendError, HistoryEntry, RestorePlan};
use crate::watch::WatchPlane;

#[cfg(feature = "build")]
use crate::build::{
    ArtifactAtRequest, ArtifactAtResponse, BuildPlane, EnsureBuildRequest, EnsureBuildResponse,
};

#[derive(Clone)]
pub struct AppState {
    pub history: Arc<dyn HistoryBackend>,
    /// Explicit-content commits for repos addressed by path.
    pub commits: Arc<CommitService>,
    /// Present only with `--features build`.
    #[cfg(feature = "build")]
    pub build: Option<Arc<BuildPlane>>,
    /// Watchexec-shaped FS seals; `None` only if notify failed to start.
    pub watch: Option<Arc<WatchPlane>>,
}

pub fn router(state: AppState) -> Router {
    #[cfg(feature = "build")]
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ensure", post(ensure))
        .route("/note", post(note))
        .route("/flush", post(flush))
        .route("/seal", post(seal))
        .route("/list", post(list))
        .route("/file-at", post(file_at))
        .route("/file-list-at", post(file_list_at))
        .route("/restore-plan", post(restore_plan))
        .route(
            "/commit",
            post(commit).layer(DefaultBodyLimit::max(COMMIT_BODY_LIMIT)),
        )
        .route("/outcome", post(outcome))
        .route("/head", post(head))
        .route("/tree-hash", post(tree_hash))
        .route("/ensure-build", post(ensure_build))
        .route("/artifact-at", post(artifact_at))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    #[cfg(not(feature = "build"))]
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ensure", post(ensure))
        .route("/note", post(note))
        .route("/flush", post(flush))
        .route("/seal", post(seal))
        .route("/list", post(list))
        .route("/file-at", post(file_at))
        .route("/file-list-at", post(file_list_at))
        .route("/restore-plan", post(restore_plan))
        .route(
            "/commit",
            post(commit).layer(DefaultBodyLimit::max(COMMIT_BODY_LIMIT)),
        )
        .route("/outcome", post(outcome))
        .route("/head", post(head))
        .route("/tree-hash", post(tree_hash))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    app
}

/// A commit carries every staged file base64-encoded in one JSON body, so it
/// needs far more than axum's 2 MB default. Batch limits are the caller's.
const COMMIT_BODY_LIMIT: usize = 512 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct DirBody {
    dir: String,
}

#[derive(Debug, Deserialize)]
struct NoteBody {
    dir: String,
    path: String,
}

#[derive(Debug, Deserialize)]
struct SealBody {
    dir: String,
    message: String,
    #[serde(default)]
    actor: Option<Actor>,
}

#[derive(Debug, Serialize)]
struct SealResponse {
    #[serde(rename = "changeId")]
    change_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileAtBody {
    dir: String,
    #[serde(rename = "revisionId")]
    revision_id: String,
    path: String,
}

#[derive(Debug, Serialize)]
struct FileAtResponse {
    found: bool,
    #[serde(rename = "contentBase64", skip_serializing_if = "Option::is_none")]
    content_base64: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileListAtBody {
    dir: String,
    #[serde(rename = "revisionId")]
    revision_id: String,
}

#[derive(Debug, Serialize)]
struct FileListAtResponse {
    paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RestorePlanBody {
    dir: String,
    #[serde(rename = "revisionId")]
    revision_id: String,
}

async fn ensure(
    State(st): State<AppState>,
    Json(body): Json<DirBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    st.history.ensure(&body.dir).await?;
    if let Some(watch) = &st.watch {
        if let Err(error) = watch.watch_depot(std::path::Path::new(&body.dir)) {
            tracing::warn!(dir = %body.dir, %error, "watch register failed");
        }
    }
    Ok(Json(serde_json::json!({})))
}

async fn note(
    State(st): State<AppState>,
    Json(body): Json<NoteBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    st.history.note(&body.dir, &body.path).await?;
    Ok(Json(serde_json::json!({})))
}

async fn flush(
    State(st): State<AppState>,
    Json(body): Json<DirBody>,
) -> Result<Json<SealResponse>, ApiError> {
    let change_id = st.history.flush_notes(&body.dir).await?;
    Ok(Json(SealResponse { change_id }))
}

async fn seal(
    State(st): State<AppState>,
    Json(body): Json<SealBody>,
) -> Result<Json<SealResponse>, ApiError> {
    let change_id = st
        .history
        .seal(&body.dir, &body.message, body.actor.as_ref())
        .await?;
    Ok(Json(SealResponse { change_id }))
}

async fn list(
    State(st): State<AppState>,
    Json(body): Json<DirBody>,
) -> Result<Json<Vec<HistoryEntry>>, ApiError> {
    Ok(Json(st.history.list(&body.dir).await?))
}

async fn file_at(
    State(st): State<AppState>,
    Json(body): Json<FileAtBody>,
) -> Result<Json<FileAtResponse>, ApiError> {
    let bytes = st
        .history
        .file_at(&body.dir, &body.revision_id, &body.path)
        .await?;
    Ok(Json(match bytes {
        Some(b) => FileAtResponse {
            found: true,
            content_base64: Some(base64::engine::general_purpose::STANDARD.encode(b)),
        },
        None => FileAtResponse {
            found: false,
            content_base64: None,
        },
    }))
}

async fn file_list_at(
    State(st): State<AppState>,
    Json(body): Json<FileListAtBody>,
) -> Result<Json<FileListAtResponse>, ApiError> {
    Ok(Json(FileListAtResponse {
        paths: st
            .history
            .file_list_at(&body.dir, &body.revision_id)
            .await?,
    }))
}

async fn restore_plan(
    State(st): State<AppState>,
    Json(body): Json<RestorePlanBody>,
) -> Result<Json<RestorePlan>, ApiError> {
    Ok(Json(
        st.history
            .restore_plan(&body.dir, &body.revision_id)
            .await?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitBody {
    repo: String,
    parent: String,
    operation_id: String,
    author: Author,
    message: String,
    #[serde(default)]
    trailers: Vec<CommitTrailer>,
    changes: Vec<ChangeBody>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangeBody {
    path: String,
    #[serde(default)]
    content_base64: Option<String>,
    #[serde(default)]
    delete: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutcomeBody {
    repo: String,
    operation_id: String,
}

#[derive(Debug, Deserialize)]
struct RepoBody {
    repo: String,
}

#[derive(Debug, Deserialize)]
struct TreeHashBody {
    repo: String,
    revision: String,
}

#[derive(Debug, Serialize)]
struct TreeHashResponse {
    tree: String,
}

async fn commit(
    State(st): State<AppState>,
    Json(body): Json<CommitBody>,
) -> Result<Json<CommitOutcome>, ApiError> {
    let mut changes = Vec::with_capacity(body.changes.len());
    for change in body.changes {
        let content = match (change.content_base64, change.delete) {
            (Some(encoded), false) => Some(
                base64::engine::general_purpose::STANDARD
                    .decode(encoded)
                    .map_err(|e| {
                        CommitError::Invalid(format!("contentBase64 for {:?}: {e}", change.path))
                    })?,
            ),
            (None, true) => None,
            _ => {
                return Err(CommitError::Invalid(format!(
                    "change {:?} needs exactly one of contentBase64 or delete: true",
                    change.path
                ))
                .into())
            }
        };
        changes.push(Change {
            path: change.path,
            content,
        });
    }
    let request = CommitRequest {
        parent: body.parent,
        operation_id: body.operation_id,
        author: body.author,
        message: body.message,
        trailers: body.trailers,
        changes,
    };
    let repo = std::path::PathBuf::from(body.repo);
    Ok(Json(
        run_commits(&st, move |c| c.commit(&repo, request)).await?,
    ))
}

async fn outcome(
    State(st): State<AppState>,
    Json(body): Json<OutcomeBody>,
) -> Result<Json<OperationOutcome>, ApiError> {
    let repo = std::path::PathBuf::from(body.repo);
    let operation_id = body.operation_id;
    Ok(Json(
        run_commits(&st, move |c| c.outcome(&repo, &operation_id)).await?,
    ))
}

async fn head(
    State(st): State<AppState>,
    Json(body): Json<RepoBody>,
) -> Result<Json<RevisionTree>, ApiError> {
    let repo = std::path::PathBuf::from(body.repo);
    Ok(Json(run_commits(&st, move |c| c.head(&repo)).await?))
}

async fn tree_hash(
    State(st): State<AppState>,
    Json(body): Json<TreeHashBody>,
) -> Result<Json<TreeHashResponse>, ApiError> {
    let repo = std::path::PathBuf::from(body.repo);
    let revision = body.revision;
    let found = run_commits(&st, move |c| c.tree_hash(&repo, &revision)).await?;
    Ok(Json(TreeHashResponse { tree: found.tree }))
}

/// Commit work waits on repo locks and drives jj-lib's `!Send` futures, so it
/// runs on a blocking thread.
async fn run_commits<T, F>(st: &AppState, f: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(Arc<CommitService>) -> Result<T, CommitError> + Send + 'static,
{
    let commits = st.commits.clone();
    tokio::task::spawn_blocking(move || f(commits))
        .await
        .map_err(|e| ApiError::from(format!("join error: {e}")))?
        .map_err(ApiError::from)
}

#[cfg(feature = "build")]
async fn ensure_build(
    State(st): State<AppState>,
    Json(body): Json<EnsureBuildRequest>,
) -> Result<Json<EnsureBuildResponse>, ApiError> {
    let Some(build) = &st.build else {
        return Err("build plane unavailable".to_string().into());
    };
    Ok(Json(build.ensure_build(body).await?))
}

#[cfg(feature = "build")]
async fn artifact_at(
    State(st): State<AppState>,
    Json(body): Json<ArtifactAtRequest>,
) -> Result<Json<ArtifactAtResponse>, ApiError> {
    let Some(build) = &st.build else {
        return Err("build plane unavailable".to_string().into());
    };
    Ok(Json(build.artifact_at(body).await?))
}

struct ApiError {
    status: StatusCode,
    /// Stable, machine-readable error kind.
    code: &'static str,
    message: String,
    /// Extra fields merged into the error body, e.g. `head` on a conflict.
    details: serde_json::Map<String, serde_json::Value>,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: String) -> Self {
        Self {
            status,
            code,
            message,
            details: serde_json::Map::new(),
        }
    }
}

impl From<CommitError> for ApiError {
    fn from(err: CommitError) -> Self {
        let message = err.to_string();
        match err {
            CommitError::Invalid(_) => {
                Self::new(StatusCode::BAD_REQUEST, "invalid-request", message)
            }
            CommitError::ParentMismatch { head, .. } => {
                let mut error = Self::new(StatusCode::CONFLICT, "parent-mismatch", message);
                error.details.insert("head".into(), head.into());
                error
            }
            CommitError::OperationFenced(_) => {
                Self::new(StatusCode::CONFLICT, "operation-fenced", message)
            }
            CommitError::RevisionNotFound(_) => {
                Self::new(StatusCode::NOT_FOUND, "revision-not-found", message)
            }
            CommitError::LockTimeout(_) => {
                Self::new(StatusCode::SERVICE_UNAVAILABLE, "lock-timeout", message)
            }
            CommitError::Internal(_) => {
                Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", message)
            }
        }
    }
}

impl From<HistoryBackendError> for ApiError {
    fn from(err: HistoryBackendError) -> Self {
        let (status, code) = match &err {
            HistoryBackendError::NotFound(_) => (StatusCode::NOT_FOUND, "not-found"),
            HistoryBackendError::Invalid(_) => (StatusCode::BAD_REQUEST, "invalid-request"),
            HistoryBackendError::Io(_) | HistoryBackendError::Jj(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal")
            }
        };
        Self::new(status, code, err.to_string())
    }
}

impl From<String> for ApiError {
    fn from(message: String) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", message)
    }
}

impl axum::response::IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let mut body = self.details;
        body.insert("code".into(), self.code.into());
        body.insert("error".into(), self.message.into());
        (self.status, Json(serde_json::Value::Object(body))).into_response()
    }
}
