//! `llame-machine`: the Machine daemon and its command line.

mod attach;
mod cli;
mod daemon;
mod identity;
mod metadata;
mod services;

use std::process::ExitCode;

use clap::Parser;

fn main() -> ExitCode {
    let args = cli::Cli::parse();
    match cli::run(args) {
        Ok(code) => code,
        Err(error) => {
            let _ = std::io::Write::write_all(
                &mut std::io::stderr(),
                format!("llame-machine: {error:#}\n").as_bytes(),
            );
            ExitCode::from(1)
        }
    }
}
