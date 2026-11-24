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
use tokio::{io::AsyncWriteExt, net::UnixStream, time::sleep};
use tonic::transport::{Channel, Endpoint, Uri};

use crate::daemon::{lock_path, prepare_state_dir, socket_path, try_lock};

const START_WAIT: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(50);

pub fn run() -> anyhow::Result<ExitCode> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(attach())?;
    Ok(ExitCode::SUCCESS)
}

async fn attach() -> anyhow::Result<()> {
    let state_dir = paths::state_dir();
    prepare_state_dir(&state_dir)?;
    let socket = socket_path(&state_dir);
    if UnixStream::connect(&socket).await.is_err() {
        start_daemon(&state_dir).await?;
    }
    replace_outdated_daemon(&state_dir).await?;
    let stream = UnixStream::connect(&socket).await.context("the Machine daemon is not reachable")?;
    relay(stream).await
}

/// Starts the daemon unless one holds the lock, then waits for its socket.
async fn start_daemon(state_dir: &Path) -> anyhow::Result<()> {
    if let Some(lock) = try_lock(state_dir)? {
        drop(lock);
        let log = OpenOptions::new().create(true).append(true).open(state_dir.join("daemon.log"))?;
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
    bail!("the Machine daemon did not start; see {}", socket.with_file_name("daemon.log").display())
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
/// rebuilt or upgraded binary applies on the next attach. With jobs running it
/// keeps serving, and the mismatch stays visible in its build id.
async fn replace_outdated_daemon(state_dir: &Path) -> anyhow::Result<()> {
    let own = crate::identity::build_id();
    let socket = socket_path(state_dir);
    let channel = channel(&socket).await?;
    let info = BootstrapServiceClient::new(channel.clone()).get_info(GetInfoRequest {}).await?.into_inner();
    if info.build_id == own || own == "unknown" {
        return Ok(());
    }
    let running = match JobServiceClient::new(channel).list_jobs(ListJobsRequest {}).await {
        Ok(response) => response.into_inner().running,
        Err(status) if status.code() == tonic::Code::Unimplemented => 0,
        Err(status) => return Err(status.into()),
    };
    if running > 0 {
        tracing_warn(&format!(
            "the running Machine daemon is build {}, this binary is {own}; it keeps serving while {running} jobs run",
            info.build_id
        ));
        return Ok(());
    }
    stop_daemon(state_dir).await?;
    start_daemon(state_dir).await
}

fn tracing_warn(message: &str) {
    let _ = std::io::Write::write_all(&mut std::io::stderr(), format!("llame-machine: {message}\n").as_bytes());
}

async fn stop_daemon(state_dir: &Path) -> anyhow::Result<()> {
    let pid = fs::read_to_string(lock_path(state_dir))?.trim().parse::<i32>().context("the daemon lock holds no pid")?;
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
