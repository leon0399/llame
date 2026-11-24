//! The command line: `attach --stdio`, the daemon itself, and local settings.

use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::ExitCode,
};

use anyhow::{Context as _, bail};
use clap::{Parser, Subcommand};
use machine_core::{Config, config::config_file, paths};

#[derive(Parser)]
#[command(name = "llame-machine", version = crate::identity::RELEASE_VERSION, about = "The llame Machine daemon")]
pub struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Relay gRPC on stdin and stdout to the running daemon, starting one first
    /// when none runs.
    Attach {
        #[arg(long, required = true)]
        stdio: bool,
    },
    /// Run the daemon in the foreground (normally started by `attach`).
    Daemon,
    /// Manage the directories this Machine serves.
    Roots {
        #[command(subcommand)]
        action: RootsAction,
    },
    /// Manage this Machine's capacity limits.
    Limits {
        #[command(subcommand)]
        action: LimitsAction,
    },
    /// Print identity: instance id, release, build id, protocol version.
    Info,
}

#[derive(Subcommand)]
enum RootsAction {
    Add { directory: PathBuf },
    Remove { directory: PathBuf },
    List,
}

#[derive(Subcommand)]
enum LimitsAction {
    Show,
    Set {
        #[arg(long)]
        max_running_jobs: Option<u32>,
        #[arg(long)]
        job_output_bytes: Option<u64>,
    },
}

fn out(text: &str) -> anyhow::Result<()> {
    std::io::stdout().write_all(text.as_bytes())?;
    Ok(())
}

pub fn run(cli: Cli) -> anyhow::Result<ExitCode> {
    match cli.command {
        Command::Attach { .. } => crate::attach::run(),
        Command::Daemon => Ok(crate::daemon::run()),
        Command::Roots { action } => roots(action),
        Command::Limits { action } => limits(action),
        Command::Info => {
            let identity = crate::identity::Identity::load()?;
            out(&format!(
                "release {}\nbuild {}\nprotocol {}\ninstance {}\n",
                identity.release_version, identity.build_id, identity.protocol_version, identity.instance_id
            ))?;
            Ok(ExitCode::SUCCESS)
        }
    }
}

fn config_path() -> PathBuf {
    config_file(&paths::config_dir())
}

fn canonical_directory(directory: &Path) -> anyhow::Result<String> {
    let canonical = fs::canonicalize(directory).with_context(|| format!("{} does not exist", directory.display()))?;
    if !canonical.is_dir() {
        bail!("{} is not a directory", canonical.display());
    }
    Ok(canonical.to_string_lossy().into_owned())
}

fn roots(action: RootsAction) -> anyhow::Result<ExitCode> {
    let file = config_path();
    let mut config = Config::load(&file)?;
    match action {
        RootsAction::List => {
            for root in &config.roots {
                out(&format!("{root}\n"))?;
            }
            return Ok(ExitCode::SUCCESS);
        }
        RootsAction::Add { directory } => {
            let root = canonical_directory(&directory)?;
            if !config.roots.contains(&root) {
                config.roots.push(root.clone());
            }
            config.save(&file)?;
            out(&format!("{root}\n"))?;
        }
        RootsAction::Remove { directory } => {
            let text = fs::canonicalize(&directory).map_or_else(
                |_| directory.to_string_lossy().into_owned(),
                |path| path.to_string_lossy().into_owned(),
            );
            let before = config.roots.len();
            config.roots.retain(|root| root != &text);
            if config.roots.len() == before {
                bail!("{text} is not a registered root");
            }
            config.save(&file)?;
            out(&format!("{text}\n"))?;
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn limits(action: LimitsAction) -> anyhow::Result<ExitCode> {
    let file = config_path();
    let mut config = Config::load(&file)?;
    if let LimitsAction::Set { max_running_jobs, job_output_bytes } = action {
        if let Some(value) = max_running_jobs {
            config.limits.max_running_jobs = value;
        }
        if let Some(value) = job_output_bytes {
            config.limits.job_output_bytes = value;
        }
        config.save(&file)?;
    }
    out(&format!(
        "max_running_jobs {}\njob_output_bytes {}\n",
        config.limits.max_running_jobs, config.limits.job_output_bytes
    ))?;
    Ok(ExitCode::SUCCESS)
}
