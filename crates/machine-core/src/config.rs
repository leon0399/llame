//! `config.toml`: the Machine's roots and capacity limits.

use std::{
    fs, io,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::SystemTime,
};

use serde::{Deserialize, Serialize};

/// The default number of jobs that may run at once. Fan-out protection only;
/// load control belongs to cgroups.
pub const DEFAULT_MAX_RUNNING_JOBS: u32 = 32;
/// The default bytes one job output stream may write to disk.
pub const DEFAULT_JOB_OUTPUT_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct Limits {
    pub max_running_jobs: u32,
    pub job_output_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_running_jobs: DEFAULT_MAX_RUNNING_JOBS,
            job_output_bytes: DEFAULT_JOB_OUTPUT_BYTES,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub roots: Vec<String>,
    pub limits: Limits,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("cannot read {path}: {source}")]
    Read { path: PathBuf, source: io::Error },
    #[error("{path} is not a valid configuration: {message}")]
    Parse { path: PathBuf, message: String },
    #[error("cannot write {path}: {source}")]
    Write { path: PathBuf, source: io::Error },
    #[error("{0}")]
    Invalid(String),
}

pub fn config_file(config_dir: &Path) -> PathBuf {
    config_dir.join("config.toml")
}

impl Config {
    /// The configuration on disk; a missing file is the empty default.
    pub fn load(file: &Path) -> Result<Self, ConfigError> {
        let text = match fs::read_to_string(file) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(source) => {
                return Err(ConfigError::Read {
                    path: file.to_path_buf(),
                    source,
                });
            }
        };
        let config: Self = toml::from_str(&text).map_err(|error| ConfigError::Parse {
            path: file.to_path_buf(),
            message: error.to_string(),
        })?;
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<(), ConfigError> {
        for root in &self.roots {
            if !root.starts_with('/') || root.contains('\0') {
                return Err(ConfigError::Invalid(format!(
                    "root {root:?} is not an absolute path"
                )));
            }
        }
        if self.limits.max_running_jobs == 0 {
            return Err(ConfigError::Invalid(
                "limits.max_running_jobs must be at least 1".into(),
            ));
        }
        Ok(())
    }

    /// Writes the configuration atomically, mode 0600, in a 0700 directory.
    pub fn save(&self, file: &Path) -> Result<(), ConfigError> {
        self.validate()?;
        let write_error = |source| ConfigError::Write {
            path: file.to_path_buf(),
            source,
        };
        let dir = file.parent().unwrap_or_else(|| Path::new("/"));
        fs::create_dir_all(dir).map_err(write_error)?;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
        let text = toml::to_string_pretty(self)
            .map_err(|error| ConfigError::Invalid(error.to_string()))?;
        let temp = dir.join(format!(".config.{}.tmp", std::process::id()));
        {
            use std::io::Write;
            let mut out = fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&temp)
                .map_err(write_error)?;
            out.write_all(text.as_bytes()).map_err(write_error)?;
            out.sync_all().map_err(write_error)?;
        }
        fs::rename(&temp, file).map_err(write_error)
    }
}

/// The configuration, re-read when the file's modification time changes.
#[derive(Debug)]
pub struct ConfigHandle {
    file: PathBuf,
    cached: Mutex<(Option<SystemTime>, Arc<Config>)>,
}

impl ConfigHandle {
    pub fn open(file: PathBuf) -> Result<Self, ConfigError> {
        let mtime = modified(&file);
        let config = Config::load(&file)?;
        Ok(Self {
            file,
            cached: Mutex::new((mtime, Arc::new(config))),
        })
    }

    /// The current configuration. A file that changed into an invalid one keeps
    /// the last valid configuration.
    pub fn current(&self) -> Arc<Config> {
        let mtime = modified(&self.file);
        let Ok(mut cached) = self.cached.lock() else {
            return Arc::new(Config::default());
        };
        if cached.0 != mtime
            && let Ok(config) = Config::load(&self.file)
        {
            *cached = (mtime, Arc::new(config));
        }
        Arc::clone(&cached.1)
    }

    pub fn file(&self) -> &Path {
        &self.file
    }
}

fn modified(file: &Path) -> Option<SystemTime> {
    fs::metadata(file).and_then(|meta| meta.modified()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_is_default_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let file = config_file(dir.path());
        assert_eq!(Config::load(&file).unwrap(), Config::default());
        let config = Config {
            roots: vec!["/srv".into()],
            limits: Limits::default(),
        };
        config.save(&file).unwrap();
        assert_eq!(Config::load(&file).unwrap(), config);
    }

    #[test]
    fn refuses_relative_root_and_unknown_keys() {
        let dir = tempfile::tempdir().unwrap();
        let file = config_file(dir.path());
        fs::write(&file, "roots = [\"rel\"]\n").unwrap();
        assert!(Config::load(&file).is_err());
        fs::write(&file, "nope = 1\n").unwrap();
        assert!(Config::load(&file).is_err());
    }
}
