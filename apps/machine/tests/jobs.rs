#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod common;

use std::{collections::HashMap, time::Duration};

use machine_protocol::v1::{
    CreateJobRequest, JobState, ListJobsRequest, LostCause, OutputStream, ReadOutputRequest,
    create_job_response, job_service_client::JobServiceClient, watch_jobs_response,
};
use tokio::time::timeout;

fn request(id: &str, command: &str) -> CreateJobRequest {
    CreateJobRequest {
        job_id: id.into(),
        owner: "owner-a".into(),
        command: command.into(),
        cwd: None,
        env: HashMap::new(),
        timeout: None,
    }
}

async fn create(
    client: &mut JobServiceClient<tonic::transport::Channel>,
    id: &str,
    command: &str,
) -> machine_protocol::v1::Job {
    match client
        .create_job(request(id, command))
        .await
        .unwrap()
        .into_inner()
        .result
        .unwrap()
    {
        create_job_response::Result::Job(job) => job,
        create_job_response::Result::Failure(failure) => panic!("unexpected failure: {failure:?}"),
    }
}

async fn wait_settled(
    client: &mut JobServiceClient<tonic::transport::Channel>,
    id: &str,
) -> machine_protocol::v1::Job {
    timeout(Duration::from_secs(5), async {
        loop {
            let jobs = client
                .list_jobs(ListJobsRequest {})
                .await
                .unwrap()
                .into_inner()
                .jobs;
            if let Some(job) = jobs
                .into_iter()
                .find(|job| job.id == id && job.state != JobState::Running as i32)
            {
                return job;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn creates_watches_reads_duplicate_and_deletes_jobs() {
    let machine = common::Machine::new();
    let (_daemon, channel) = machine.attach().await;
    let mut client = JobServiceClient::new(channel);
    let mut watch = client
        .watch_jobs(machine_protocol::v1::WatchJobsRequest {})
        .await
        .unwrap()
        .into_inner();
    let snapshot_end = timeout(Duration::from_secs(2), watch.message())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(matches!(
        snapshot_end.event,
        Some(watch_jobs_response::Event::SnapshotEnd(_))
    ));
    let id = "0123456789abcdef0123456789abcdef";
    let first = create(&mut client, id, "printf 'hello world\\n'; sleep 0.2").await;
    let second = create(&mut client, id, "printf 'should-not-run'").await;
    assert_eq!(first.created_at, second.created_at);
    let settled = timeout(Duration::from_secs(3), async {
        loop {
            let event = watch.message().await.unwrap().unwrap();
            if let Some(watch_jobs_response::Event::Job(job)) = event.event
                && job.id == id
                && job.state == JobState::Succeeded as i32
            {
                return job;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(settled.stdout.unwrap().bytes, 12);
    let mut output = client
        .read_output(ReadOutputRequest {
            job_id: id.into(),
            owner: "owner-a".into(),
            stream: OutputStream::Stdout as i32,
            offset: 6,
            limit: 0,
        })
        .await
        .unwrap()
        .into_inner();
    let chunk = output.message().await.unwrap().unwrap();
    assert_eq!(chunk.offset, 6);
    assert_eq!(chunk.data, b"world\n");
    client
        .delete_job(machine_protocol::v1::DeleteJobRequest {
            request_id: "delete-a".into(),
            job_id: id.into(),
            owner: "owner-a".into(),
        })
        .await
        .unwrap();
    assert!(!machine.state_dir().join("jobs").join(id).exists());
}

#[tokio::test]
async fn reports_failed_exit_and_hides_jobs_from_wrong_owner() {
    let machine = common::Machine::new();
    let (_daemon, channel) = machine.attach().await;
    let mut client = JobServiceClient::new(channel);
    let id = "1123456789abcdef0123456789abcdef";
    create(&mut client, id, "printf failure >&2; exit 7").await;
    let job = wait_settled(&mut client, id).await;
    assert_eq!(job.state, JobState::Failed as i32);
    assert_eq!(job.exit_code, Some(7));
    assert_eq!(job.stderr.unwrap().bytes, 7);
    let error = client
        .get_job(machine_protocol::v1::GetJobRequest {
            job_id: id.into(),
            owner: "owner-b".into(),
        })
        .await
        .unwrap_err();
    assert_eq!(error.code(), tonic::Code::NotFound);
}

#[tokio::test]
async fn cancel_kills_process_group_and_timeout_expires() {
    let machine = common::Machine::new();
    let (_daemon, channel) = machine.attach().await;
    let mut client = JobServiceClient::new(channel);
    let id = "2123456789abcdef0123456789abcdef";
    create(&mut client, id, "sleep 30 & wait").await;
    let cancelled = client
        .cancel_job(machine_protocol::v1::CancelJobRequest {
            request_id: "cancel-a".into(),
            job_id: id.into(),
            owner: "owner-a".into(),
        })
        .await
        .unwrap()
        .into_inner()
        .job
        .unwrap();
    assert_eq!(cancelled.state, JobState::Cancelled as i32);
    let timeout_id = "3123456789abcdef0123456789abcdef";
    let mut timed = request(timeout_id, "sleep 30");
    timed.timeout = Some(Default::default());
    if let Some(duration) = timed.timeout.as_mut() {
        duration.nanos = 100_000_000;
    }
    client.create_job(timed).await.unwrap();
    let timed = wait_settled(&mut client, timeout_id).await;
    let stored: serde_json::Value = serde_json::from_slice(
        &std::fs::read(
            machine
                .state_dir()
                .join("jobs")
                .join(timeout_id)
                .join("job.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let pid = stored["pid"].as_u64().unwrap() as u32;
    let pid = rustix::process::Pid::from_raw(pid.cast_signed()).unwrap();
    let group_empty = rustix::process::test_kill_process_group(pid)
        .is_err_and(|error| error == rustix::io::Errno::SRCH);
    match timed.state {
        state if state == JobState::TimedOut as i32 => {
            assert!(group_empty, "timed-out job still has a process group");
            assert_eq!(timed.lost_cause, LostCause::Unspecified as i32);
        }
        state if state == JobState::Lost as i32 => {
            assert_eq!(timed.lost_cause, LostCause::CancelUnproved as i32);
        }
        state => panic!("expected a timed-out or unproved job, got {state}"),
    }
    #[cfg(target_os = "linux")]
    assert_eq!(timed.state, JobState::TimedOut as i32);
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn timeout_is_lost_when_a_live_parent_keeps_a_group_member_unreaped() {
    let machine = common::Machine::new();
    let (_daemon, channel) = machine.attach().await;
    let mut client = JobServiceClient::new(channel);
    let id = "4123456789abcdef0123456789abcdef";
    let command = r#"python3 -c 'import os,time
child=os.fork()
if child == 0:
    while True: time.sleep(1)
os.setsid()
open("timeout-helper.pid", "w").write(str(os.getpid()))
os.close(1)
os.close(2)
time.sleep(30)
os.waitpid(child, 0)' & wait"#;
    let mut timed = request(id, command);
    timed.timeout = Some(Default::default());
    timed.timeout.as_mut().unwrap().seconds = 1;
    client.create_job(timed).await.unwrap();

    let timed = wait_settled(&mut client, id).await;
    let helper_pid = std::fs::read_to_string(machine.root().join("timeout-helper.pid"))
        .unwrap()
        .trim()
        .parse::<u32>()
        .unwrap();
    let helper_pid = rustix::process::Pid::from_raw(helper_pid.cast_signed()).unwrap();
    let job: serde_json::Value = serde_json::from_slice(
        &std::fs::read(machine.state_dir().join("jobs").join(id).join("job.json")).unwrap(),
    )
    .unwrap();
    let pid = job["pid"].as_u64().unwrap() as u32;
    let pid = rustix::process::Pid::from_raw(pid.cast_signed()).unwrap();
    let group_empty = rustix::process::test_kill_process_group(pid)
        .is_err_and(|error| error == rustix::io::Errno::SRCH);
    let _ = rustix::process::kill_process(helper_pid, rustix::process::Signal::KILL);

    assert!(
        !group_empty,
        "fixture did not retain a process-group member"
    );
    assert_eq!(timed.state, JobState::Lost as i32);
    assert_eq!(timed.lost_cause, LostCause::CancelUnproved as i32);
}

#[tokio::test]
async fn enforces_limit_and_truncates_each_output_stream_independently() {
    let machine = common::Machine::new();
    machine.cli(&[
        "limits",
        "set",
        "--max-running-jobs",
        "1",
        "--job-output-bytes",
        "8",
    ]);
    let (_daemon, channel) = machine.attach().await;
    let mut client = JobServiceClient::new(channel);
    let id = "4123456789abcdef0123456789abcdef";
    create(
        &mut client,
        id,
        "printf 1234567890; printf abcdefghij >&2; sleep 0.4",
    )
    .await;
    let refused = client
        .create_job(request("5123456789abcdef0123456789abcdef", "true"))
        .await
        .unwrap_err();
    assert_eq!(refused.code(), tonic::Code::ResourceExhausted);
    tokio::time::sleep(Duration::from_millis(100)).await;
    let listed = client
        .list_jobs(ListJobsRequest {})
        .await
        .unwrap()
        .into_inner();
    assert_eq!(listed.running, 1);
    let running = listed.jobs.iter().find(|job| job.id == id).unwrap();
    assert!(running.stdout.as_ref().unwrap().truncated);
    assert!(running.stderr.as_ref().unwrap().truncated);
    let finished = wait_settled(&mut client, id).await;
    assert_eq!(finished.state, JobState::Succeeded as i32);
    assert_eq!(finished.stdout.unwrap().bytes, 8);
    assert_eq!(finished.stderr.unwrap().bytes, 8);
}

#[tokio::test]
async fn jobs_outlive_a_dropped_client_connection() {
    let machine = common::Machine::new();
    let (_daemon, channel) = machine.attach().await;
    let mut client = JobServiceClient::new(channel);
    let id = "6123456789abcdef0123456789abcdef";
    create(&mut client, id, "sleep 0.2; printf survived").await;
    drop(client);
    let (_reattached, channel) = machine.attach().await;
    let mut client = JobServiceClient::new(channel);
    let mut watch = client
        .watch_jobs(machine_protocol::v1::WatchJobsRequest {})
        .await
        .unwrap()
        .into_inner();
    let watched = timeout(Duration::from_secs(3), async {
        loop {
            let event = watch.message().await.unwrap().unwrap();
            if let Some(watch_jobs_response::Event::Job(job)) = event.event
                && job.id == id
                && job.state != JobState::Running as i32
            {
                return job;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(watched.state, JobState::Succeeded as i32);
    assert_eq!(watched.stdout.unwrap().bytes, 8);
}

#[tokio::test]
async fn daemon_restart_marks_unfinished_jobs_lost() {
    let machine = common::Machine::new();
    let (_daemon, channel) = machine.attach().await;
    let mut client = JobServiceClient::new(channel);
    let id = "7123456789abcdef0123456789abcdef";
    create(&mut client, id, "sleep 30").await;
    let daemon_pid = machine.daemon_pid().unwrap();
    std::process::Command::new("kill")
        .arg(daemon_pid.to_string())
        .status()
        .unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;
    drop(client);
    let (_restarted, channel) = machine.attach().await;
    let mut client = JobServiceClient::new(channel);
    let lost = client
        .list_jobs(ListJobsRequest {})
        .await
        .unwrap()
        .into_inner()
        .jobs
        .into_iter()
        .find(|job| job.id == id)
        .unwrap();
    assert_eq!(lost.state, JobState::Lost as i32);
    assert_eq!(lost.lost_cause, LostCause::DaemonRestarted as i32);
}
