#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::wildcard_enum_match_arm,
    clippy::too_many_lines
)]

mod common;

use machine_protocol::{
    bootstrap::v1::{GetInfoRequest, bootstrap_service_client::BootstrapServiceClient},
    v1::{GetLimitsRequest, ListRootsRequest, machine_service_client::MachineServiceClient},
};
use std::{io::Write, os::unix::fs::MetadataExt};

#[tokio::test]
async fn attach_starts_one_daemon_and_reports_identity() {
    let machine = common::Machine::new();
    let (_first, channel) = machine.attach().await;
    let info = BootstrapServiceClient::new(channel)
        .get_info(GetInfoRequest {})
        .await
        .unwrap()
        .into_inner();
    assert_eq!(info.protocol_version, machine_protocol::PROTOCOL_VERSION);
    assert_eq!(info.instance_id.len(), 36);
    assert_eq!(info.build_id.len(), 12);
    assert!(info.facts.is_some());
    let pid = machine.daemon_pid().unwrap();

    // A second attach reaches the same daemon and the same identity.
    let (_second, channel) = machine.attach().await;
    let again = BootstrapServiceClient::new(channel.clone())
        .get_info(GetInfoRequest {})
        .await
        .unwrap()
        .into_inner();
    assert_eq!(again.instance_id, info.instance_id);
    assert_eq!(machine.daemon_pid(), Some(pid));

    let mut client = MachineServiceClient::new(channel);
    let roots = client
        .list_roots(ListRootsRequest::default())
        .await
        .unwrap()
        .into_inner();
    assert_eq!(
        roots
            .roots
            .iter()
            .map(|root| root.path.as_str())
            .collect::<Vec<_>>(),
        vec![machine.root().to_string_lossy().as_ref()]
    );
    let limits = client
        .get_limits(GetLimitsRequest::default())
        .await
        .unwrap()
        .into_inner()
        .limits
        .unwrap();
    assert_eq!(limits.max_running_jobs, 32);
}

#[tokio::test]
async fn attach_refuses_a_different_config_directory_for_the_same_state() {
    let machine = common::Machine::new();
    let (_child, channel) = machine.attach().await;
    BootstrapServiceClient::new(channel)
        .get_info(GetInfoRequest {})
        .await
        .unwrap();
    let alternate_config = machine.home.path().join("alternate-config");
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_llame-machine"))
        .env("LLAME_MACHINE_CONFIG_DIR", &alternate_config)
        .env("LLAME_MACHINE_STATE_DIR", machine.state_dir())
        .args(["attach", "--print-socket"])
        .output()
        .unwrap();

    assert_eq!(
        output.status.code(),
        Some(78),
        "stdout: {:?}, stderr: {:?}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.is_empty());
}

#[tokio::test]
async fn roots_added_while_running_apply_to_the_next_call() {
    let machine = common::Machine::new();
    let (_child, channel) = machine.attach().await;
    let extra = machine.home.path().canonicalize().unwrap().join("extra");
    std::fs::create_dir(&extra).unwrap();
    machine.cli(&["roots", "add", extra.to_str().unwrap()]);
    let roots = MachineServiceClient::new(channel)
        .list_roots(ListRootsRequest::default())
        .await
        .unwrap()
        .into_inner();
    assert_eq!(roots.roots.len(), 2);
}

#[tokio::test]
async fn a_stale_socket_is_replaced() {
    let machine = common::Machine::new();
    std::fs::create_dir_all(machine.state_dir()).unwrap();
    std::fs::write(machine.state_dir().join("daemon.sock"), "").unwrap();
    let (_child, channel) = machine.attach().await;
    BootstrapServiceClient::new(channel)
        .get_info(GetInfoRequest {})
        .await
        .unwrap();
}

#[tokio::test]
async fn the_state_directory_is_private() {
    let machine = common::Machine::new();
    let (_child, channel) = machine.attach().await;
    BootstrapServiceClient::new(channel)
        .get_info(GetInfoRequest {})
        .await
        .unwrap();
    let state_dir = machine.state_dir();
    let state_mode = std::fs::metadata(&state_dir).unwrap().mode() & 0o777;
    let socket_mode = std::fs::metadata(state_dir.join("daemon.sock"))
        .unwrap()
        .mode()
        & 0o777;
    assert_eq!(state_mode, 0o700);
    assert_eq!(socket_mode, 0o600);
}

#[tokio::test]
async fn a_rebuilt_binary_applies_on_the_next_attach() {
    let machine = common::Machine::new();
    let (_old_child, old_channel) = machine.attach().await;
    let old_info = BootstrapServiceClient::new(old_channel)
        .get_info(GetInfoRequest {})
        .await
        .unwrap()
        .into_inner();
    let old_pid = machine.daemon_pid().unwrap();

    let rebuilt = machine.home.path().join("llame-machine-rebuilt");
    std::fs::copy(env!("CARGO_BIN_EXE_llame-machine"), &rebuilt).unwrap();
    std::fs::OpenOptions::new()
        .append(true)
        .open(&rebuilt)
        .unwrap()
        .write_all(b"rebuilt")
        .unwrap();

    let (_new_child, new_channel) = machine.attach_with_binary(rebuilt.to_str().unwrap()).await;
    let new_info = BootstrapServiceClient::new(new_channel)
        .get_info(GetInfoRequest {})
        .await
        .unwrap()
        .into_inner();
    assert_ne!(new_info.build_id, old_info.build_id);
    assert_ne!(machine.daemon_pid(), Some(old_pid));
}
