//! The long-lived daemon: one per OS account, serving gRPC on a socket in a
//! directory only that account can open. A `flock` on `daemon.lock` marks it
//! running, so `attach` tells a live socket from a stale one.

use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::ExitCode,
    sync::Arc,
    time::Duration,
};

use anyhow::{Context as _, bail};
use machine_core::{ConfigHandle, Context, config::config_file, paths};
use rustix::fs::{FlockOperation, flock};
use tokio::net::UnixListener;
use tokio_stream::wrappers::UnixListenerStream;

use crate::identity::Identity;

/// When this daemon process started, for the bootstrap service.
static STARTED_AT: std::sync::OnceLock<std::time::SystemTime> = std::sync::OnceLock::new();

pub fn started_at() -> std::time::SystemTime {
    *STARTED_AT.get_or_init(std::time::SystemTime::now)
}

/// `sun_path` holds 108 bytes including the terminating zero.
const MAX_SOCKET_PATH: usize = 107;

pub fn socket_path(state_dir: &Path) -> PathBuf {
    state_dir.join("daemon.sock")
}

pub fn lock_path(state_dir: &Path) -> PathBuf {
    state_dir.join("daemon.lock")
}

/// Creates the state directory with mode 0700.
pub fn prepare_state_dir(state_dir: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(state_dir)
        .with_context(|| format!("cannot create {}", state_dir.display()))?;
    fs::set_permissions(state_dir, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

/// Takes the daemon lock without waiting, or returns `None` when another
/// daemon holds it. The holder's pid is written into the file.
pub fn try_lock(state_dir: &Path) -> anyhow::Result<Option<File>> {
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path(state_dir))?;
    if flock(&file, FlockOperation::NonBlockingLockExclusive).is_err() {
        return Ok(None);
    }
    file.set_len(0)?;
    file.write_all(format!("{}\n", std::process::id()).as_bytes())?;
    Ok(Some(file))
}

pub fn run() -> ExitCode {
    let _ = started_at();
    // Detach from the attaching session so its hangup does not end the daemon.
    let _ = rustix::process::setsid();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("LLAME_MACHINE_LOG")
                .unwrap_or_else(|_| "info".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    match serve() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("daemon stopped: {error:#}");
            ExitCode::from(1)
        }
    }
}

fn serve() -> anyhow::Result<()> {
    let state_dir = paths::state_dir();
    prepare_state_dir(&state_dir)?;
    let socket = socket_path(&state_dir);
    if socket.as_os_str().len() > MAX_SOCKET_PATH {
        bail!(
            "socket path {} is longer than {MAX_SOCKET_PATH} bytes",
            socket.display()
        );
    }
    let Some(_lock) = try_lock(&state_dir)? else {
        bail!("another daemon already runs for {}", state_dir.display());
    };
    let identity = Identity::load()?;
    let config = ConfigHandle::open(config_file(&paths::config_dir()))?;
    let context = Context {
        config: Arc::new(config),
        state_dir,
    };
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async move {
        let _ = fs::remove_file(&socket);
        let listener = UnixListener::bind(&socket)
            .with_context(|| format!("cannot bind {}", socket.display()))?;
        fs::set_permissions(&socket, fs::Permissions::from_mode(0o600))?;
        tracing::info!(socket = %socket.display(), build = %identity.build_id, "daemon listening");
        let routes = crate::services::routes(&context, identity).await?;
        tonic::transport::Server::builder()
            .http2_keepalive_interval(Some(Duration::from_secs(15)))
            .http2_keepalive_timeout(Some(Duration::from_secs(45)))
            .add_routes(routes)
            .serve_with_incoming_shutdown(UnixListenerStream::new(listener), shutdown_signal())
            .await?;
        let _ = fs::remove_file(&socket);
        tracing::info!("daemon stopped");
        anyhow::Ok(())
    })
}

async fn shutdown_signal() {
    use tokio::signal::unix::{SignalKind, signal};
    let (Ok(mut term), Ok(mut int)) = (
        signal(SignalKind::terminate()),
        signal(SignalKind::interrupt()),
    ) else {
        return std::future::pending().await;
    };
    tokio::select! {
        _ = term.recv() => {},
        _ = int.recv() => {},
    }
}
