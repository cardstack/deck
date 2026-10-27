//! Every error deckd returns, including a request it can't parse, is a JSON
//! body with a stable `code`.

use std::io::{Read as _, Write as _};
use std::net::TcpStream;
use std::time::Duration;

use serde_json::{json, Value};

mod common;

use common::{post_raw, realm, Deckd};

#[test]
fn unparseable_requests_get_typed_errors() {
    let deckd = Deckd::start();
    let repo = realm("parse").join(".history");

    let (status, body) = post_raw(&deckd, "/commit", "application/json", "{\"repo\":");
    assert_eq!(
        (status, &body["code"]),
        (400, &json!("invalid-request")),
        "{body}"
    );

    let missing = json!({ "repo": repo }).to_string();
    let (status, body) = post_raw(&deckd, "/commit", "application/json", &missing);
    assert_eq!(
        (status, &body["code"]),
        (422, &json!("invalid-request")),
        "{body}"
    );
    assert!(body["error"].as_str().unwrap().contains("parent"), "{body}");

    let (status, body) = post_raw(&deckd, "/outcome", "text/plain", "{}");
    assert_eq!(
        (status, &body["code"]),
        (415, &json!("invalid-request")),
        "{body}"
    );

    // Routes that predate the commit API answer the same way.
    let (status, body) = post_raw(&deckd, "/list", "application/json", "[]");
    assert_eq!(
        (status, &body["code"]),
        (422, &json!("invalid-request")),
        "{body}"
    );
}

#[test]
fn oversized_commit_is_refused_as_too_large() {
    let deckd = Deckd::start();
    let length = 65 * 1024 * 1024;
    let mut stream = TcpStream::connect(deckd.base.trim_start_matches("http://")).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .unwrap();
    write!(
        stream,
        "POST /commit HTTP/1.1\r\nHost: deckd\r\nContent-Type: application/json\r\n\
         Content-Length: {length}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    // deckd answers once the body passes the limit and stops reading, so the
    // upload runs on its own thread and its write errors are expected.
    let mut writer = stream.try_clone().unwrap();
    let upload = std::thread::spawn(move || {
        let chunk = vec![b' '; 1024 * 1024];
        for _ in 0..length / chunk.len() {
            if writer.write_all(&chunk).is_err() {
                return;
            }
        }
    });
    let mut response = Vec::new();
    let _ = stream.read_to_end(&mut response);
    let _ = upload.join();

    let response = String::from_utf8_lossy(&response);
    let (head, body) = response.split_once("\r\n\r\n").expect("a response");
    assert!(head.starts_with("HTTP/1.1 413"), "{head}");
    let body: Value = serde_json::from_str(body).unwrap();
    assert_eq!(body["code"], json!("payload-too-large"), "{body}");
}
