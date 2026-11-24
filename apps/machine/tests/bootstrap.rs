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
