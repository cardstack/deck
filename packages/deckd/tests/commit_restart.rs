//! The commit API against a real deckd process that is killed and restarted
//! between calls: operation outcomes and fences live in the repo, so a new
//! process gives the same answers.

use std::path::Path;

use serde_json::{json, Value};

mod common;

use common::{realm, Deckd};

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
