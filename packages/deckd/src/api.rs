//! HTTP surface — historyd Timeline routes (+ optional build plane).

use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use serde::{Deserialize, Serialize};
use tower_http::trace::TraceLayer;

use crate::timeline::{Actor, HistoryEntry, RestorePlan, Timeline, TimelineError};
use crate::watch::WatchPlane;

#[cfg(feature = "build")]
use crate::build::{
    ArtifactAtRequest, ArtifactAtResponse, BuildPlane, EnsureBuildRequest, EnsureBuildResponse,
};

#[derive(Clone)]
pub struct AppState {
    pub timeline: Arc<dyn Timeline>,
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
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    app
}

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
    st.timeline.ensure(&body.dir).await?;
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
    st.timeline.note(&body.dir, &body.path).await?;
    Ok(Json(serde_json::json!({})))
}

async fn flush(
    State(st): State<AppState>,
    Json(body): Json<DirBody>,
) -> Result<Json<SealResponse>, ApiError> {
    let change_id = st.timeline.flush_notes(&body.dir).await?;
    Ok(Json(SealResponse { change_id }))
}

async fn seal(
    State(st): State<AppState>,
    Json(body): Json<SealBody>,
) -> Result<Json<SealResponse>, ApiError> {
    let change_id = st
        .timeline
        .seal(&body.dir, &body.message, body.actor.as_ref())
        .await?;
    Ok(Json(SealResponse { change_id }))
}

async fn list(
    State(st): State<AppState>,
    Json(body): Json<DirBody>,
) -> Result<Json<Vec<HistoryEntry>>, ApiError> {
    Ok(Json(st.timeline.list(&body.dir).await?))
}

async fn file_at(
    State(st): State<AppState>,
    Json(body): Json<FileAtBody>,
) -> Result<Json<FileAtResponse>, ApiError> {
    let bytes = st
        .timeline
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
            .timeline
            .file_list_at(&body.dir, &body.revision_id)
            .await?,
    }))
}

async fn restore_plan(
    State(st): State<AppState>,
    Json(body): Json<RestorePlanBody>,
) -> Result<Json<RestorePlan>, ApiError> {
    Ok(Json(
        st.timeline
            .restore_plan(&body.dir, &body.revision_id)
            .await?,
    ))
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
    message: String,
}

impl From<TimelineError> for ApiError {
    fn from(err: TimelineError) -> Self {
        let status = match &err {
            TimelineError::NotFound(_) => StatusCode::NOT_FOUND,
            TimelineError::Invalid(_) => StatusCode::BAD_REQUEST,
            TimelineError::Io(_) | TimelineError::Jj(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            message: err.to_string(),
        }
    }
}

impl From<String> for ApiError {
    fn from(message: String) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message,
        }
    }
}

impl axum::response::IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body = Json(serde_json::json!({ "error": self.message }));
        (self.status, body).into_response()
    }
}
