//! Compiles `packages/machine-protocol/proto` with `protox`, so no `protoc`
//! binary is needed, and exports the protocol version.

use std::{env, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let proto_root = manifest.join("../../packages/machine-protocol/proto");
    let files = [
        "stead/machine/bootstrap/v1/bootstrap.proto",
        "stead/machine/v1/errors.proto",
        "stead/machine/v1/machine.proto",
        "stead/machine/v1/file.proto",
        "stead/machine/v1/git.proto",
        "stead/machine/v1/job.proto",
        "stead/machine/v1/mcp.proto",
    ];
    let fds = protox::compile(files, [&proto_root])?;
    tonic_prost_build::configure()
        .build_server(true)
        .build_client(true)
        .compile_fds(fds)?;

    let protocol: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(proto_root.join("protocol.json"))?)?;
    let version = protocol["version"].as_u64().ok_or("protocol.json has no version")?;
    let out = PathBuf::from(env::var("OUT_DIR")?);
    fs::write(
        out.join("protocol_version.rs"),
        format!("pub const PROTOCOL_VERSION: u32 = {version};\n"),
    )?;
    println!("cargo:rerun-if-changed={}", proto_root.display());
    Ok(())
}
