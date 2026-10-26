//! The commit API against a real deckd process that is killed and restarted
//! between calls: operation outcomes and fences live in the repo, so a new
//! process gives the same answers.

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

struct Deckd {
    child: Child,
    base: String,
}

impl Deckd {
    /// Start deckd on a fresh port. A restart needs no particular port: all
    /// state is in the repo.
    fn start() -> Self {
        let port = free_port();
        let child = Command::new(env!("CARGO_BIN_EXE_deckd"))
            .env("DECKD_BIND", format!("127.0.0.1:{port}"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("start deckd");
        let base = format!("http://127.0.0.1:{port}");
        let started = Instant::now();
        while ureq::get(&format!("{base}/health")).call().is_err() {
            assert!(
                started.elapsed() < Duration::from_secs(20),
                "deckd did not start"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
        Self { child, base }
    }

    /// POST `body` and return the status and JSON response, error or not.
    fn post(&self, route: &str, body: Value) -> (u16, Value) {
        match ureq::post(&format!("{}{route}", self.base)).send_json(body) {
            Ok(response) => (response.status(), response.into_json().unwrap()),
            Err(ureq::Error::Status(status, response)) => (status, response.into_json().unwrap()),
            Err(error) => panic!("{route}: {error}"),
        }
    }

    fn kill(mut self) {
        self.child.kill().unwrap();
        self.child.wait().unwrap();
    }
}

impl Drop for Deckd {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn realm(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "deckd-restart-{name}-{}-{nanos}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn commit_body(repo: &Path, parent: &str, operation_id: &str) -> Value {
    json!({
        "repo": repo,
        "parent": parent,
        "operationId": operation_id,
        "author": { "name": "Jane", "email": "jane@example.com" },
        "message": "Update Author/jane.json",
        "trailers": [{ "key": "Boxel-Channel", "value": "host" }],
        "changes": [
            { "path": "Author/jane.json", "contentBase64": "eyJuYW1lIjoiSmFuZSJ9" },
            { "path": "Author/old.json", "delete": true }
        ]
    })
}

#[test]
fn committed_outcome_survives_a_restart() {
    let realm = realm("committed");
    let repo = realm.join(".history");
    let deckd = Deckd::start();
    let (_, head) = deckd.post("/head", json!({ "repo": repo }));
    let root = head["revision"].as_str().unwrap().to_owned();

    let (status, committed) = deckd.post("/commit", commit_body(&repo, &root, "op-1"));
    assert_eq!(status, 200, "{committed}");
    deckd.kill();

    let deckd = Deckd::start();
    let (status, outcome) = deckd.post("/outcome", json!({ "repo": repo, "operationId": "op-1" }));
    assert_eq!(status, 200);
    assert_eq!(
        outcome,
        json!({ "state": "committed", "revision": committed["revision"] })
    );
    let (_, retried) = deckd.post("/commit", commit_body(&repo, &root, "op-1"));
    assert_eq!(retried["revision"], committed["revision"]);
    assert_eq!(retried["replayed"], json!(true));
    let (_, tree) = deckd.post(
        "/tree-hash",
        json!({ "repo": repo, "revision": committed["revision"] }),
    );
    assert_eq!(tree["tree"], committed["tree"]);
    std::fs::remove_dir_all(realm).unwrap();
}

#[test]
fn fence_survives_a_restart() {
    let realm = realm("fence");
    let repo = realm.join(".history");
    let deckd = Deckd::start();
    let (status, outcome) = deckd.post("/outcome", json!({ "repo": repo, "operationId": "op-1" }));
    assert_eq!(status, 200);
    assert_eq!(outcome, json!({ "state": "absent" }));
    let (_, head) = deckd.post("/head", json!({ "repo": repo }));
    let root = head["revision"].as_str().unwrap().to_owned();
    deckd.kill();

    let deckd = Deckd::start();
    let (status, refused) = deckd.post("/commit", commit_body(&repo, &root, "op-1"));
    assert_eq!(status, 409);
    assert_eq!(refused["code"], json!("operation-fenced"));

    // The fence is per operation: other operations still commit, under CAS.
    let (status, first) = deckd.post("/commit", commit_body(&repo, &root, "op-2"));
    assert_eq!(status, 200, "{first}");
    let (status, conflict) = deckd.post("/commit", commit_body(&repo, &root, "op-3"));
    assert_eq!(status, 409);
    assert_eq!(conflict["code"], json!("parent-mismatch"));
    assert_eq!(conflict["head"], first["revision"]);
    std::fs::remove_dir_all(realm).unwrap();
}
