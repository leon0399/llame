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

/// `LLAME_MACHINE_STATE_DIR`, then `$XDG_STATE_HOME/llame-machine`, then the home default.
///
/// Relative XDG values are ignored. A relative machine override is made absolute against cwd.
/// Holds the socket, the lock, and `jobs/`.
pub fn state_dir() -> PathBuf {
    let home = home();
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    state_dir_from(
        non_empty("LLAME_MACHINE_STATE_DIR"),
        non_empty("XDG_STATE_HOME"),
        &home,
        &cwd,
    )
}

fn state_dir_from(
    machine_state: Option<PathBuf>,
    xdg_state_home: Option<PathBuf>,
    home: &std::path::Path,
    cwd: &std::path::Path,
) -> PathBuf {
    if let Some(state) = machine_state {
        return if state.is_absolute() {
            state
        } else {
            cwd.join(state)
        };
    }

    if let Some(xdg) = xdg_state_home.filter(|dir| dir.is_absolute()) {
        return xdg.join("llame-machine");
    }

    home.join(".local").join("state").join("llame-machine")
}

#[cfg(test)]
mod tests {
    use super::state_dir_from;
    use std::path::PathBuf;

    #[test]
    fn relative_machine_state_override_is_made_absolute() {
        assert_eq!(
            state_dir_from(
                Some(PathBuf::from("machine-state")),
                None,
                &PathBuf::from("/home/user"),
                &PathBuf::from("/work/project"),
            ),
            PathBuf::from("/work/project/machine-state")
        );
    }

    #[test]
    fn relative_xdg_state_home_is_ignored() {
        assert_eq!(
            state_dir_from(
                None,
                Some(PathBuf::from("relative-state")),
                &PathBuf::from("/home/user"),
                &PathBuf::from("/work/project"),
            ),
            PathBuf::from("/home/user/.local/state/llame-machine")
        );
    }
}
