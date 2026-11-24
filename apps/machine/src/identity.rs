//! Who this daemon is: release, build id, protocol version, instance id.

use std::fs;

use machine_core::{instance, paths};
use sha2::{Digest, Sha256};

pub const RELEASE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug)]
pub struct Identity {
    pub instance_id: String,
    pub release_version: String,
    pub build_id: String,
    pub protocol_version: u32,
}

impl Identity {
    pub fn load() -> anyhow::Result<Self> {
        Ok(Self {
            instance_id: instance::read_or_create(&paths::config_dir())?,
            release_version: RELEASE_VERSION.to_owned(),
            build_id: build_id(),
            protocol_version: machine_protocol::PROTOCOL_VERSION,
        })
    }
}

/// The first 12 hex characters of the running binary's sha256, or "unknown".
pub fn build_id() -> String {
    fs::read("/proc/self/exe").map_or_else(
        |_| "unknown".to_owned(),
        |bytes| hex::encode(Sha256::digest(bytes))[..12].to_owned(),
    )
}
