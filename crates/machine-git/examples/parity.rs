use std::{path::PathBuf, sync::Arc};

use machine_core::{ConfigHandle, Context};
use machine_git::service;
use tokio::net::TcpListener;
use tokio_stream::wrappers::TcpListenerStream;
use tonic::transport::Server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os().skip(1);
    let root = PathBuf::from(args.next().ok_or("expected registered root path")?);
    let config_file = PathBuf::from(args.next().ok_or("expected config file path")?);
    let port = args
        .next()
        .ok_or("expected listening port")?
        .to_string_lossy()
        .parse::<u16>()?;
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    let context = Context {
        config: Arc::new(ConfigHandle::open(config_file)?),
        state_dir: root.join(".machine-state"),
    };
    Server::builder()
        .add_service(service(context))
        .serve_with_incoming(TcpListenerStream::new(listener))
        .await?;
    Ok(())
}
