//! Helpers for tests that drive a real deckd process over HTTP.

#![allow(dead_code)]

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;

pub struct Deckd {
    child: Child,
    pub base: String,
}

impl Deckd {
    /// Start deckd on a fresh port. A restart needs no particular port: all
    /// state is in the repo.
    pub fn start() -> Self {
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
    pub fn post(&self, route: &str, body: Value) -> (u16, Value) {
        match ureq::post(&format!("{}{route}", self.base)).send_json(body) {
            Ok(response) => (response.status(), response.into_json().unwrap()),
            Err(ureq::Error::Status(status, response)) => (status, response.into_json().unwrap()),
            Err(error) => panic!("{route}: {error}"),
        }
    }

    pub fn kill(mut self) {
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

pub fn realm(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir =
        std::env::temp_dir().join(format!("deckd-http-{name}-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// POST raw bytes and return the status and JSON response, error or not.
pub fn post_raw(deckd: &Deckd, route: &str, content_type: &str, body: &str) -> (u16, Value) {
    let request = ureq::post(&format!("{}{route}", deckd.base)).set("content-type", content_type);
    match request.send_string(body) {
        Ok(response) => (response.status(), response.into_json().unwrap()),
        Err(ureq::Error::Status(status, response)) => (status, response.into_json().unwrap()),
        Err(error) => panic!("{route}: {error}"),
    }
}
