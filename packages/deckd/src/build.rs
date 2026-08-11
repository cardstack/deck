//! Derived build plane (deck-daemon D2).
//!
//! Transform: `esbuild-amd` — discover package entries on the live depot
//! disk, `esbuild --bundle --format=cjs`, wrap as `define([], …)`, write
//! under `<depot>/.deck/build/<toolchain>/<tip>/`. Identity trees stay
//! untouched.
//!
//! Modern esbuild (0.18+) dropped `--format=amd`; the graph work is still
//! esbuild, the AMD factory is a thin post-wrap. esbuild is Go — we shell
//! out (`ESBUILD_BIN` or PATH), same as jj CLI for Timeline.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::timeline::is_machinery_path;

const DEFAULT_TOOLCHAIN: &str = "poc-esbuild-amd-v1";
const MAX_ENTRIES: usize = 32;

#[derive(Debug)]
pub struct BuildPlane {
    jj_bin: String,
    esbuild_bin: String,
}

impl BuildPlane {
    pub fn new(jj_bin: impl Into<String>) -> Self {
        Self {
            jj_bin: jj_bin.into(),
            esbuild_bin: std::env::var("ESBUILD_BIN").unwrap_or_else(|_| "esbuild".into()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct EnsureBuildRequest {
    pub dir: String,
    #[serde(default)]
    pub tip: Option<String>,
    #[serde(default)]
    pub transforms: Vec<String>,
    #[serde(default)]
    pub toolchain_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct EnsureBuildResponse {
    pub ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(rename = "artifactRoot", skip_serializing_if = "Option::is_none")]
    pub artifact_root: Option<String>,
    #[serde(rename = "artifactCount", skip_serializing_if = "Option::is_none")]
    pub artifact_count: Option<usize>,
    #[serde(rename = "toolchainId", skip_serializing_if = "Option::is_none")]
    pub toolchain_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tip: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ArtifactAtRequest {
    pub dir: String,
    pub tip: String,
    pub path: String,
    #[serde(default)]
    pub toolchain_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ArtifactAtResponse {
    pub found: bool,
    #[serde(rename = "contentBase64", skip_serializing_if = "Option::is_none")]
    pub content_base64: Option<String>,
}

impl BuildPlane {
    pub fn artifact_root(depot: &Path, toolchain: &str, tip: &str) -> PathBuf {
        depot
            .join(".deck")
            .join("build")
            .join(toolchain)
            .join(&tip[..tip.len().min(12)])
    }

    pub async fn ensure_build(&self, req: EnsureBuildRequest) -> Result<EnsureBuildResponse, String> {
        let depot = PathBuf::from(&req.dir);
        let toolchain = req
            .toolchain_id
            .as_deref()
            .unwrap_or(DEFAULT_TOOLCHAIN)
            .to_string();

        let wants = req.transforms.is_empty()
            || req.transforms.iter().any(|t| {
                matches!(
                    t.as_str(),
                    "amd" | "amd-wrap" | "esbuild" | "esbuild-amd"
                )
            });
        if !wants {
            return Ok(EnsureBuildResponse {
                ready: false,
                reason: Some(format!(
                    "no supported transform in {:?} (poc: esbuild-amd)",
                    req.transforms
                )),
                artifact_root: None,
                artifact_count: None,
                toolchain_id: Some(toolchain),
                tip: req.tip,
            });
        }

        let esbuild_version = match self.esbuild_version().await {
            Ok(v) => v,
            Err(err) => {
                return Ok(EnsureBuildResponse {
                    ready: false,
                    reason: Some(format!(
                        "esbuild not available ({err}); set ESBUILD_BIN or install esbuild on PATH"
                    )),
                    artifact_root: None,
                    artifact_count: None,
                    toolchain_id: Some(toolchain),
                    tip: req.tip,
                });
            }
        };

        let tip = match req.tip.as_deref().filter(|t| !t.is_empty()) {
            Some(t) => t.to_string(),
            None => self.jj_tip(&depot).await?,
        };

        let root = Self::artifact_root(&depot, &toolchain, &tip);
        tokio::fs::create_dir_all(&root)
            .await
            .map_err(|e| e.to_string())?;

        let entries = discover_entries(&depot).await?;
        let entries: Vec<_> = entries.into_iter().take(MAX_ENTRIES).collect();

        let mut built = Vec::new();
        for rel in &entries {
            let src = depot.join(rel);
            let out = root.join(rel);
            if let Some(parent) = out.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            self.run_esbuild(&src, &out).await?;
            built.push(rel.clone());
        }

        let meta = serde_json::json!({
            "tip": tip,
            "toolchainId": toolchain,
            "transforms": ["esbuild-amd"],
            "esbuildVersion": esbuild_version,
            "entries": built,
            "artifactCount": built.len(),
        });
        tokio::fs::write(
            root.join("meta.json"),
            serde_json::to_vec_pretty(&meta).unwrap(),
        )
        .await
        .map_err(|e| e.to_string())?;

        Ok(EnsureBuildResponse {
            ready: true,
            reason: None,
            artifact_root: Some(root.display().to_string()),
            artifact_count: Some(built.len()),
            toolchain_id: Some(toolchain),
            tip: Some(tip),
        })
    }

    pub async fn artifact_at(&self, req: ArtifactAtRequest) -> Result<ArtifactAtResponse, String> {
        if req.path.is_empty()
            || req.path.starts_with('/')
            || req.path.contains('\0')
            || req.path.split('/').any(|s| s == ".." || s.is_empty())
        {
            return Ok(ArtifactAtResponse {
                found: false,
                content_base64: None,
            });
        }
        let toolchain = req
            .toolchain_id
            .as_deref()
            .unwrap_or(DEFAULT_TOOLCHAIN);
        let root = Self::artifact_root(Path::new(&req.dir), toolchain, &req.tip);
        let file = root.join(&req.path);
        match tokio::fs::read(&file).await {
            Ok(bytes) => Ok(ArtifactAtResponse {
                found: true,
                content_base64: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
            }),
            Err(_) => Ok(ArtifactAtResponse {
                found: false,
                content_base64: None,
            }),
        }
    }

    async fn esbuild_version(&self) -> Result<String, String> {
        let out = Command::new(&self.esbuild_bin)
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    async fn run_esbuild(&self, entry: &Path, outfile: &Path) -> Result<(), String> {
        let tmp = outfile.with_extension("cjs.tmp");
        let out = Command::new(&self.esbuild_bin)
            .args([
                entry.to_str().ok_or("entry path not utf-8")?,
                "--bundle",
                "--format=cjs",
                "--platform=neutral",
                &format!("--outfile={}", tmp.display()),
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            let _ = tokio::fs::remove_file(&tmp).await;
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(if err.trim().is_empty() {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            } else {
                err.trim().to_string()
            });
        }
        let cjs = tokio::fs::read(&tmp).await.map_err(|e| e.to_string())?;
        let _ = tokio::fs::remove_file(&tmp).await;
        let amd = wrap_cjs_as_amd(entry, &cjs);
        tokio::fs::write(outfile, amd)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn jj_tip(&self, depot: &Path) -> Result<String, String> {
        let out = self
            .jj(depot, &["log", "--no-graph", "-r", "@-", "-T", "change_id"])
            .await?;
        let tip = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if tip.is_empty() {
            return Err("no sealed tip yet".into());
        }
        Ok(tip)
    }

    async fn jj(&self, depot: &Path, args: &[&str]) -> Result<std::process::Output, String> {
        let out = Command::new(&self.jj_bin)
            .args(["--no-pager", "--color=never"])
            .args(args)
            .current_dir(depot)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(if err.trim().is_empty() {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            } else {
                err.trim().to_string()
            });
        }
        Ok(out)
    }
}

/// `publisher/package` entries → relative entry paths for esbuild.
async fn discover_entries(depot: &Path) -> Result<Vec<String>, String> {
    let mut entries = Vec::new();
    let mut pubs = tokio::fs::read_dir(depot)
        .await
        .map_err(|e| e.to_string())?;
    while let Some(pub_ent) = pubs.next_entry().await.map_err(|e| e.to_string())? {
        let pub_name = pub_ent.file_name().to_string_lossy().to_string();
        if pub_name.starts_with('.') || is_machinery_path(&pub_name) {
            continue;
        }
        if !pub_ent
            .file_type()
            .await
            .map_err(|e| e.to_string())?
            .is_dir()
        {
            continue;
        }
        let mut pkgs = tokio::fs::read_dir(pub_ent.path())
            .await
            .map_err(|e| e.to_string())?;
        while let Some(pkg_ent) = pkgs.next_entry().await.map_err(|e| e.to_string())? {
            let pkg_name = pkg_ent.file_name().to_string_lossy().to_string();
            if pkg_name.starts_with('.') {
                continue;
            }
            if !pkg_ent
                .file_type()
                .await
                .map_err(|e| e.to_string())?
                .is_dir()
            {
                continue;
            }
            if let Some(rel) = resolve_package_entry(depot, &pub_name, &pkg_name, &pkg_ent.path())
                .await?
            {
                entries.push(rel);
            }
        }
    }
    entries.sort();
    Ok(entries)
}

async fn resolve_package_entry(
    depot: &Path,
    publisher: &str,
    package: &str,
    pkg_dir: &Path,
) -> Result<Option<String>, String> {
    let pkg_json = pkg_dir.join("package.json");
    if pkg_json.is_file() {
        let raw = tokio::fs::read_to_string(&pkg_json)
            .await
            .map_err(|e| e.to_string())?;
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            for key in ["module", "main"] {
                if let Some(p) = v.get(key).and_then(|x| x.as_str()) {
                    let cleaned = p.trim_start_matches("./");
                    let candidate = pkg_dir.join(cleaned);
                    if candidate.is_file() {
                        return Ok(Some(rel_under(depot, &candidate)?));
                    }
                }
            }
            if let Some(exports) = v.get("exports") {
                if let Some(p) = exports.as_str() {
                    let cleaned = p.trim_start_matches("./");
                    let candidate = pkg_dir.join(cleaned);
                    if candidate.is_file() {
                        return Ok(Some(rel_under(depot, &candidate)?));
                    }
                } else if let Some(dot) = exports.get(".") {
                    let p = dot.as_str().or_else(|| {
                        dot.get("default")
                            .and_then(|x| x.as_str())
                            .or_else(|| dot.get("import").and_then(|x| x.as_str()))
                    });
                    if let Some(p) = p {
                        let cleaned = p.trim_start_matches("./");
                        let candidate = pkg_dir.join(cleaned);
                        if candidate.is_file() {
                            return Ok(Some(rel_under(depot, &candidate)?));
                        }
                    }
                }
            }
        }
    }
    for name in ["index.js", &format!("{package}.js")] {
        let candidate = pkg_dir.join(name);
        if candidate.is_file() {
            return Ok(Some(format!("{publisher}/{package}/{name}")));
        }
    }
    Ok(None)
}

fn rel_under(depot: &Path, file: &Path) -> Result<String, String> {
    file.strip_prefix(depot)
        .map_err(|_| format!("{} not under depot", file.display()))
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

/// esbuild no longer emits AMD; wrap its CJS bundle in a define() factory.
fn wrap_cjs_as_amd(entry: &Path, cjs: &[u8]) -> Vec<u8> {
    let body = String::from_utf8_lossy(cjs);
    let mut out = String::new();
    out.push_str("/* derived: deckd esbuild-amd — not identity */\n");
    out.push_str(&format!("/* source: {} */\n", entry.display()));
    out.push_str("define([], function () {\n");
    out.push_str("  \"use strict\";\n");
    out.push_str("  var exports = {};\n");
    out.push_str("  var module = { exports: exports };\n");
    out.push_str("  (function (exports, module, require) {\n");
    for line in body.lines() {
        out.push_str("    ");
        out.push_str(line);
        out.push('\n');
    }
    out.push_str("  })(exports, module, function () {\n");
    out.push_str("    throw new Error('deckd amd bundle: require() not available');\n");
    out.push_str("  });\n");
    out.push_str("  return module.exports;\n");
    out.push_str("});\n");
    out.into_bytes()
}
