//! State and rules shared by every Machine daemon service.

pub mod config;
pub mod facts;
pub mod guard;
pub mod idempotency;
pub mod instance;
pub mod paths;
pub mod refusal;
pub mod time;

use std::sync::Arc;

pub use config::{Config, ConfigHandle, Limits};
pub use guard::{GuardedPath, PathKind, RootGuard};
pub use idempotency::IdempotencyCache;

/// What every service holds: the live configuration and the state directory.
#[derive(Clone, Debug)]
pub struct Context {
    pub config: Arc<ConfigHandle>,
    pub state_dir: std::path::PathBuf,
}

impl Context {
    /// The guard over the roots configured right now. The configuration is
    /// re-read when its file changed, so `roots add` applies to the next call.
    pub fn guard(&self) -> RootGuard {
        RootGuard::new(&self.config.current().roots)
    }

    pub fn limits(&self) -> Limits {
        self.config.current().limits
    }
}
