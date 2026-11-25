//! `attach --stdio`: connect to this account's daemon, starting it when none
//! runs, and relay gRPC bytes between stdio and the daemon's socket. Every
//! connection, over SSH or as a local child, runs this command.

use std::{
    fs::{self, OpenOptions},
    path::Path,
    process::{Command, ExitCode, Stdio},
    time::Duration,
};

use anyhow::{Context as _, bail};
use hyper_util::rt::TokioIo;
use machine_core::paths;
use machine_protocol::{
    bootstrap::v1::{GetInfoRequest, bootstrap_service_client::BootstrapServiceClient},
    v1::{ListJobsRequest, job_service_client::JobServiceClient},
};
use rustix::fs::{FlockOperation, flock};
use tokio::{io::AsyncWriteExt, net::UnixStream, time::sleep};
use tonic::transport::{Channel, Endpoint, Uri};

use crate::daemon::{lock_path, prepare_state_dir, socket_path, try_lock};

const START_WAIT: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(50);

#[derive(Clone, Copy)]
pub enum Mode {
    /// Relay gRPC bytes between stdio and the socket.
    Stdio,
    /// Ensure the daemon runs, print the socket path, and exit.
    PrintSocket,
}

pub fn run(mode: Mode) -> anyhow::Result<ExitCode> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let result = runtime.block_on(attach(mode));
    runtime.shutdown_background();
    result
}

async fn attach(mode: Mode) -> anyhow::Result<ExitCode> {
    let state_dir = paths::state_dir();
    prepare_state_dir(&state_dir)?;
    let socket = socket_path(&state_dir);
    if UnixStream::connect(&socket).await.is_err() {
        start_daemon(&state_dir).await?;
    }
    if !replace_outdated_daemon(&state_dir).await? {
        return Ok(ExitCode::from(78));
    }
    match mode {
        Mode::PrintSocket => {
            let mut stdout = tokio::io::stdout();
            stdout
                .write_all(format!("{}\n", socket.display()).as_bytes())
                .await?;
            stdout.flush().await?;
            Ok(ExitCode::SUCCESS)
        }
        Mode::Stdio => {
            let stream = UnixStream::connect(&socket)
                .await
                .context("the Machine daemon is not reachable")?;
            relay(stream).await?;
            Ok(ExitCode::SUCCESS)
        }
    }
}

/// Starts the daemon unless one holds the lock, then waits for its socket.
async fn start_daemon(state_dir: &Path) -> anyhow::Result<()> {
    if let Some(lock) = try_lock(state_dir)? {
        drop(lock);
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(state_dir.join("daemon.log"))?;
        Command::new(std::env::current_exe()?)
            .arg("daemon")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(log)
            .spawn()
            .context("cannot start the Machine daemon")?;
    }
    wait_for_socket(&socket_path(state_dir)).await
}

async fn wait_for_socket(socket: &Path) -> anyhow::Result<()> {
    let mut waited = Duration::ZERO;
    while waited < START_WAIT {
        if UnixStream::connect(socket).await.is_ok() {
            return Ok(());
        }
        sleep(POLL).await;
        waited += POLL;
    }
    bail!(
        "the Machine daemon did not start; see {}",
        socket.with_file_name("daemon.log").display()
    )
}

async fn channel(socket: &Path) -> anyhow::Result<Channel> {
    let socket = socket.to_path_buf();
    Ok(Endpoint::from_static("http://daemon")
        .connect_with_connector(tower::service_fn(move |_: Uri| {
            let socket = socket.clone();
            async move { UnixStream::connect(socket).await.map(TokioIo::new) }
        }))
        .await?)
}

/// A daemon built from another binary is replaced when it runs no job, so a
/// rebuilt or upgraded binary applies on the next attach. A different
/// configured instance is refused rather than attaching to another machine.
async fn replace_outdated_daemon(state_dir: &Path) -> anyhow::Result<bool> {
    let replacement = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(state_dir.join("daemon-replacement.lock"))?;
    flock(&replacement, FlockOperation::LockExclusive)?;
    let own = crate::identity::Identity::load()?;
    let build_id = own.build_id;
    let socket = socket_path(state_dir);
    let channel = channel(&socket).await?;
    let info = BootstrapServiceClient::new(channel.clone())
        .get_info(GetInfoRequest {})
        .await?
        .into_inner();
    if info.instance_id != own.instance_id {
        return Ok(false);
    }
    if info.build_id == build_id || build_id == "unknown" {
        return Ok(true);
    }
    let running = match JobServiceClient::new(channel)
        .list_jobs(ListJobsRequest {})
        .await
    {
        Ok(response) => response.into_inner().running,
        Err(status) if status.code() == tonic::Code::Unimplemented => 0,
        Err(status) => return Err(status.into()),
    };
    if running > 0 {
        tracing_warn(&format!(
            "the running Machine daemon is build {}, this binary is {build_id}; it keeps serving while {running} jobs run",
            info.build_id
        ));
        return Ok(true);
    }
    stop_daemon(state_dir).await?;
    start_daemon(state_dir).await?;
    Ok(true)
}

fn tracing_warn(message: &str) {
    let _ = std::io::Write::write_all(
        &mut std::io::stderr(),
        format!("llame-machine: {message}\n").as_bytes(),
    );
}

async fn stop_daemon(state_dir: &Path) -> anyhow::Result<()> {
    let pid = fs::read_to_string(lock_path(state_dir))?
        .trim()
        .parse::<i32>()
        .context("the daemon lock holds no pid")?;
    if let Some(pid) = rustix::process::Pid::from_raw(pid) {
        let _ = rustix::process::kill_process(pid, rustix::process::Signal::TERM);
    }
    let mut waited = Duration::ZERO;
    while waited < START_WAIT {
        if let Some(lock) = try_lock(state_dir)? {
            drop(lock);
            return Ok(());
        }
        sleep(POLL).await;
        waited += POLL;
    }
    bail!("the outdated Machine daemon did not stop")
}

/// Copies stdin to the socket and the socket to stdout. Stdin's end half-closes
/// the socket; the socket's end ends the relay.
async fn relay(stream: UnixStream) -> anyhow::Result<()> {
    let (mut from_daemon, mut to_daemon) = stream.into_split();
    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let upstream = async {
        let _ = tokio::io::copy(&mut stdin, &mut to_daemon).await;
        let _ = to_daemon.shutdown().await;
        std::future::pending::<()>().await;
    };
    let downstream = async {
        let _ = tokio::io::copy(&mut from_daemon, &mut stdout).await;
        let _ = stdout.flush().await;
    };
    tokio::select! {
        () = upstream => {},
        () = downstream => {},
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        sync::mpsc,
        time::{Duration, Instant},
    };

    #[test]
    fn runtime_shutdown_does_not_wait_for_blocking_stdin_read() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        runtime.spawn_blocking(move || {
            started_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        });
        runtime.block_on(async { tokio::task::yield_now().await });
        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();

        let started = Instant::now();
        runtime.shutdown_background();
        assert!(started.elapsed() < Duration::from_secs(1));
        release_tx.send(()).unwrap();
    }
}
