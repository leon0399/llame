//! Drives the built `llame-machine` binary through `attach --stdio`, the way
//! the installation does, with an isolated config and state directory.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use hyper_util::rt::TokioIo;
use tempfile::TempDir;
use tokio::process::{Child, Command};
use tonic::transport::{Channel, Endpoint, Uri};

pub struct Machine {
    pub home: TempDir,
    pub roots: Vec<PathBuf>,
}

impl Machine {
    /// A Machine with one registered root, `<home>/root`.
    pub fn new() -> Self {
        let home = TempDir::new().unwrap();
        let root = home.path().canonicalize().unwrap().join("root");
        std::fs::create_dir_all(&root).unwrap();
        let machine = Self {
            home,
            roots: vec![root],
        };
        machine.cli(&["roots", "add", machine.roots[0].to_str().unwrap()]);
        machine
    }

    pub fn root(&self) -> &Path {
        &self.roots[0]
    }

    pub fn config_dir(&self) -> PathBuf {
        self.home.path().join("config")
    }

    pub fn state_dir(&self) -> PathBuf {
        self.home.path().join("state")
    }

    fn command(&self) -> std::process::Command {
        self.command_with_binary(env!("CARGO_BIN_EXE_llame-machine"))
    }

    fn command_with_binary(&self, binary: &str) -> std::process::Command {
        let mut command = std::process::Command::new(binary);
        command
            .env("LLAME_MACHINE_CONFIG_DIR", self.config_dir())
            .env("LLAME_MACHINE_STATE_DIR", self.state_dir());
        command
    }

    /// Spawns `attach --stdio`. A binary a test just wrote can briefly be busy
    /// ("Text file busy") while a sibling test's fork still holds the write
    /// descriptor before its exec, so that error is retried for a short while.
    async fn spawn_attach(&self, binary: &str) -> Child {
        for _ in 0..100 {
            match Command::from(self.command_with_binary(binary))
                .args(["attach", "--stdio"])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .kill_on_drop(true)
                .spawn()
            {
                Err(error) if error.kind() == std::io::ErrorKind::ExecutableFileBusy => {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
                result => return result.unwrap(),
            }
        }
        panic!("{binary} stayed busy for two seconds");
    }

    pub async fn attach_with_binary(&self, binary: &str) -> (Child, Channel) {
        let mut child = self.spawn_attach(binary).await;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let io = std::sync::Mutex::new(Some(tokio::io::join(stdout, stdin)));
        let channel = Endpoint::from_static("http://machine")
            .connect_with_connector(tower::service_fn(move |_: Uri| {
                let io = io.lock().unwrap().take();
                async move {
                    io.map(TokioIo::new)
                        .ok_or_else(|| std::io::Error::other("one connection per attach"))
                }
            }))
            .await
            .unwrap();
        (child, channel)
    }

    /// One `attach --stdio` child and a gRPC channel over its stdio.
    pub async fn attach(&self) -> (Child, Channel) {
        self.attach_with_binary(env!("CARGO_BIN_EXE_llame-machine"))
            .await
    }

    /// Runs a CLI command and returns its standard output.
    pub fn cli(&self, args: &[&str]) -> String {
        let output = self.command().args(args).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    }

    pub fn daemon_pid(&self) -> Option<i32> {
        std::fs::read_to_string(self.state_dir().join("daemon.lock"))
            .ok()?
            .trim()
            .parse()
            .ok()
    }
}

impl Drop for Machine {
    fn drop(&mut self) {
        if let Some(pid) = self.daemon_pid() {
            let _ = std::process::Command::new("kill")
                .arg(pid.to_string())
                .status();
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}
