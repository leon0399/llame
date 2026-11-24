//! Where the daemon keeps its configuration and its state.

use std::{env, path::PathBuf};

fn home() -> PathBuf {
    env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from)
}

fn non_empty(name: &str) -> Option<PathBuf> {
    env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// `LLAME_MACHINE_CONFIG_DIR`, then `$XDG_CONFIG_HOME/llame-machine`, then
/// `~/.config/llame-machine`. Holds `config.toml` and `instance.json`.
pub fn config_dir() -> PathBuf {
    non_empty("LLAME_MACHINE_CONFIG_DIR")
        .or_else(|| non_empty("XDG_CONFIG_HOME").map(|dir| dir.join("llame-machine")))
        .unwrap_or_else(|| home().join(".config").join("llame-machine"))
}

/// `LLAME_MACHINE_STATE_DIR`, then `$XDG_STATE_HOME/llame-machine`, then
/// `~/.local/state/llame-machine`. Holds the socket, the lock, and `jobs/`.
pub fn state_dir() -> PathBuf {
    non_empty("LLAME_MACHINE_STATE_DIR")
        .or_else(|| non_empty("XDG_STATE_HOME").map(|dir| dir.join("llame-machine")))
        .unwrap_or_else(|| home().join(".local").join("state").join("llame-machine"))
}
