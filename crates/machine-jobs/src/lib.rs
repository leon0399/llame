//! `JobService`: every command runs as a job with output files on disk.

use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::{fs::PermissionsExt, process::ExitStatusExt},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use machine_core::{Context, IdempotencyCache, refusal};
use machine_protocol::v1::{
    CancelJobRequest, CancelJobResponse, CreateJobFailure, CreateJobFailureReason,
    CreateJobRequest, CreateJobResponse, DeleteJobRequest, DeleteJobResponse, GetJobRequest,
    GetJobResponse, Job, JobState, ListJobsRequest, ListJobsResponse, LostCause, Output,
    OutputStream, ReadOutputRequest, ReadOutputResponse, WatchJobsRequest, WatchJobsResponse,
    job_service_server::{JobService, JobServiceServer},
};
use prost_types::{Duration as ProtoDuration, Timestamp};
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{Mutex, broadcast, mpsc, watch},
    time,
};
use tonic::{Code, Request, Response, Status};

const OUTPUT_CHUNK: usize = 512 * 1024;
const STOP_BUDGET: Duration = Duration::from_millis(250);

#[derive(Clone, Serialize, Deserialize)]
struct StoredJob {
    job_id: String,
    owner: String,
    command: String,
    cwd: String,
    pid: u32,
    started_at_ms: u64,
    boot_id: String,
    lifetime_ms: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredStatus {
    state: i32,
    ended_at_ms: u64,
    exit_code: Option<i32>,
    signal: Option<String>,
    stdout_bytes: u64,
    stderr_bytes: u64,
    wall_time_ms: u64,
    stdout_truncated: bool,
    stderr_truncated: bool,
    lost_cause: Option<i32>,
}
#[derive(Serialize, Deserialize)]
struct OutputTruncation {
    stdout: bool,
    stderr: bool,
}

struct Settlement {
    state: JobState,
    exit_code: Option<i32>,
    signal: Option<String>,
    lost_cause: Option<i32>,
}

struct Entry {
    start: StoredJob,
    status: Option<StoredStatus>,
    directory: PathBuf,
    stdout_truncated: bool,
    stderr_truncated: bool,
    stop_requested: bool,
    cancel: watch::Sender<bool>,
}

struct State {
    entries: HashMap<String, Entry>,
    changes: broadcast::Sender<Job>,
}

pub struct Jobs {
    context: Context,
    state: Arc<Mutex<State>>,
    cancels: IdempotencyCache<Result<Job, Status>>,
    deletes: IdempotencyCache<Result<(), Status>>,
}

type Stream<T> = tokio_stream::wrappers::ReceiverStream<Result<T, Status>>;

/// Opens the job store and reconciles unfinished records from an earlier daemon.
#[allow(clippy::unused_async)]
pub async fn service(context: Context) -> anyhow::Result<JobServiceServer<Jobs>> {
    let root = context.state_dir.join("jobs");
    fs::create_dir_all(&root)?;
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
    let current_boot = machine_core::facts::boot_id();
    let (changes, _) = broadcast::channel(1024);
    let mut entries = HashMap::new();
    for item in fs::read_dir(&root)? {
        let item = item?;
        if !item.file_type()?.is_dir() {
            continue;
        }
        let directory = item.path();
        let Ok(bytes) = fs::read(directory.join("job.json")) else {
            continue;
        };
        let Ok(start) = serde_json::from_slice::<StoredJob>(&bytes) else {
            continue;
        };
        let truncation = fs::read(directory.join("truncated.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<OutputTruncation>(&bytes).ok())
            .unwrap_or(OutputTruncation {
                stdout: false,
                stderr: false,
            });
        let status_path = directory.join("status.json");
        let status = fs::read(&status_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<StoredStatus>(&bytes).ok())
            .or_else(|| {
                let lost = StoredStatus {
                    state: JobState::Lost as i32,
                    ended_at_ms: now_ms(),
                    exit_code: None,
                    signal: None,
                    stdout_bytes: file_len(&directory.join("stdout")),
                    stderr_bytes: file_len(&directory.join("stderr")),
                    wall_time_ms: 0,
                    stdout_truncated: truncation.stdout,
                    stderr_truncated: truncation.stderr,
                    lost_cause: Some(if start.boot_id == current_boot {
                        LostCause::DaemonRestarted as i32
                    } else {
                        LostCause::MachineRebooted as i32
                    }),
                };
                write_json_atomic(&status_path, &lost).ok()?;
                Some(lost)
            });
        let Some(status) = status else { continue };
        let (cancel, _) = watch::channel(false);
        entries.insert(
            start.job_id.clone(),
            Entry {
                start,
                stdout_truncated: status.stdout_truncated,
                stderr_truncated: status.stderr_truncated,
                status: Some(status),
                directory,
                stop_requested: false,
                cancel,
            },
        );
    }
    Ok(JobServiceServer::new(Jobs {
        context,
        state: Arc::new(Mutex::new(State { entries, changes })),
        cancels: IdempotencyCache::default(),
        deletes: IdempotencyCache::default(),
    }))
}

#[tonic::async_trait]
impl JobService for Jobs {
    async fn create_job(
        &self,
        request: Request<CreateJobRequest>,
    ) -> Result<Response<CreateJobResponse>, Status> {
        let metadata = request
            .metadata()
            .get("x-llame-tool-call-id")
            .and_then(|value| value.to_str().ok());
        tracing::info!(tool_call_id = ?metadata, "Creating machine job");
        let result = match self.create(request.into_inner()).await {
            Ok(job) => machine_protocol::v1::create_job_response::Result::Job(job),
            Err(error) if error.code() == Code::Unavailable => {
                machine_protocol::v1::create_job_response::Result::Failure(CreateJobFailure {
                    reason: CreateJobFailureReason::Unavailable as i32,
                    message: error.message().to_owned(),
                })
            }
            Err(error) => return Err(error),
        };
        Ok(Response::new(CreateJobResponse {
            result: Some(result),
        }))
    }

    async fn get_job(
        &self,
        request: Request<GetJobRequest>,
    ) -> Result<Response<GetJobResponse>, Status> {
        let request = request.into_inner();
        let state = self.state.lock().await;
        let job = state
            .entries
            .get(&request.job_id)
            .filter(|entry| entry.start.owner == request.owner)
            .map(job_record)
            .ok_or_else(refusal::job_not_found)?;
        Ok(Response::new(GetJobResponse { job: Some(job) }))
    }

    async fn list_jobs(
        &self,
        _: Request<ListJobsRequest>,
    ) -> Result<Response<ListJobsResponse>, Status> {
        let state = self.state.lock().await;
        let jobs = state.entries.values().map(job_record).collect::<Vec<_>>();
        let running = jobs
            .iter()
            .filter(|job| job.state == JobState::Running as i32)
            .count();
        Ok(Response::new(ListJobsResponse {
            jobs,
            running: u32::try_from(running).unwrap_or(u32::MAX),
        }))
    }

    type WatchJobsStream = Stream<WatchJobsResponse>;
    async fn watch_jobs(
        &self,
        _: Request<WatchJobsRequest>,
    ) -> Result<Response<Self::WatchJobsStream>, Status> {
        let (sender, receiver) = mpsc::channel(32);
        let (snapshot, mut changes) = {
            let state = self.state.lock().await;
            let changes = state.changes.subscribe();
            let snapshot = state.entries.values().map(job_record).collect::<Vec<_>>();
            (snapshot, changes)
        };
        tokio::spawn(async move {
            for job in snapshot {
                if sender
                    .send(Ok(WatchJobsResponse {
                        event: Some(machine_protocol::v1::watch_jobs_response::Event::Job(job)),
                    }))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            if sender
                .send(Ok(WatchJobsResponse {
                    event: Some(
                        machine_protocol::v1::watch_jobs_response::Event::SnapshotEnd(
                            machine_protocol::v1::SnapshotEnd {},
                        ),
                    ),
                }))
                .await
                .is_err()
            {
                return;
            }
            loop {
                match changes.recv().await {
                    Ok(job) => {
                        if sender
                            .send(Ok(WatchJobsResponse {
                                event: Some(machine_protocol::v1::watch_jobs_response::Event::Job(
                                    job,
                                )),
                            }))
                            .await
                            .is_err()
                        {
                            return;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let _ = sender
                            .send(Err(Status::data_loss(
                                "Job updates were lost; reconnect for a fresh snapshot.",
                            )))
                            .await;
                        return;
                    }
                    Err(broadcast::error::RecvError::Closed) => return,
                }
            }
        });
        Ok(Response::new(tokio_stream::wrappers::ReceiverStream::new(
            receiver,
        )))
    }

    type ReadOutputStream = Stream<ReadOutputResponse>;
    async fn read_output(
        &self,
        request: Request<ReadOutputRequest>,
    ) -> Result<Response<Self::ReadOutputStream>, Status> {
        let request = request.into_inner();
        let (directory, stream) = {
            let state = self.state.lock().await;
            let entry = state
                .entries
                .get(&request.job_id)
                .filter(|entry| entry.start.owner == request.owner)
                .ok_or_else(refusal::job_not_found)?;
            let stream = match OutputStream::try_from(request.stream) {
                Ok(OutputStream::Stdout) => "stdout",
                Ok(OutputStream::Stderr) => "stderr",
                _ => return Err(refusal::invalid_argument("Unknown job output stream.")),
            };
            (entry.directory.clone(), stream)
        };
        let (sender, receiver) = mpsc::channel(4);
        tokio::spawn(async move {
            let mut file = match tokio::fs::File::open(directory.join(stream)).await {
                Ok(file) => file,
                Err(error) => {
                    let _ = sender.send(Err(Status::not_found(error.to_string()))).await;
                    return;
                }
            };
            if let Err(error) =
                tokio::io::AsyncSeekExt::seek(&mut file, std::io::SeekFrom::Start(request.offset))
                    .await
            {
                let _ = sender.send(Err(Status::internal(error.to_string()))).await;
                return;
            }
            let mut offset = request.offset;
            let mut remaining = request.limit;
            let mut buffer = vec![0; OUTPUT_CHUNK];
            loop {
                let size = if request.limit == 0 {
                    buffer.len()
                } else {
                    buffer
                        .len()
                        .min(usize::try_from(remaining).unwrap_or(usize::MAX))
                };
                if size == 0 {
                    break;
                }
                let count = match file.read(&mut buffer[..size]).await {
                    Ok(count) => count,
                    Err(error) => {
                        let _ = sender.send(Err(Status::internal(error.to_string()))).await;
                        return;
                    }
                };
                if count == 0 {
                    break;
                }
                if sender
                    .send(Ok(ReadOutputResponse {
                        offset,
                        data: buffer[..count].to_vec(),
                    }))
                    .await
                    .is_err()
                {
                    return;
                }
                offset = offset.saturating_add(count as u64);
                remaining = remaining.saturating_sub(count as u64);
            }
        });
        Ok(Response::new(tokio_stream::wrappers::ReceiverStream::new(
            receiver,
        )))
    }

    async fn cancel_job(
        &self,
        request: Request<CancelJobRequest>,
    ) -> Result<Response<CancelJobResponse>, Status> {
        let request = request.into_inner();
        let state = Arc::clone(&self.state);
        let job_id = request.job_id;
        let owner = request.owner;
        let request_id = owner_scoped_request_id(&owner, &request.request_id);
        let job = self
            .cancels
            .run(&request_id, || async move {
                tokio::spawn(cancel_job(state, job_id, owner))
                    .await
                    .map_err(|error| {
                        Status::internal(format!("Job cancellation task failed: {error}"))
                    })?
            })
            .await
            .map_err(|_| Status::internal("idempotent work panicked"))??;
        Ok(Response::new(CancelJobResponse { job: Some(job) }))
    }

    async fn delete_job(
        &self,
        request: Request<DeleteJobRequest>,
    ) -> Result<Response<DeleteJobResponse>, Status> {
        let request = request.into_inner();
        let state = Arc::clone(&self.state);
        let owner = request.owner;
        let request_id = owner_scoped_request_id(&owner, &request.request_id);
        self.deletes
            .run(&request_id, || async move {
                delete_job(state, request.job_id, owner).await
            })
            .await
            .map_err(|_| Status::internal("idempotent work panicked"))??;
        Ok(Response::new(DeleteJobResponse {}))
    }
}

impl Jobs {
    #[allow(clippy::too_many_lines)]
    async fn create(&self, request: CreateJobRequest) -> Result<Job, Status> {
        if request.job_id.len() != 32
            || !request
                .job_id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(refusal::invalid_argument(
                "Job id must be 32 lowercase hexadecimal characters.",
            ));
        }
        let existing = {
            let state = self.state.lock().await;
            state.entries.get(&request.job_id).map(job_record)
        };
        if let Some(existing) = existing {
            return Ok(existing);
        }
        let (cwd, guarded) = if let Some(path) = request.cwd.as_deref() {
            let guarded = self.context.guard().resolve(path)?;
            (
                guarded.canonical.to_string_lossy().into_owned(),
                Some(guarded),
            )
        } else {
            let root = self
                .context
                .guard()
                .roots()
                .first()
                .ok_or_else(|| {
                    refusal::invalid_argument(
                        "No registered root is available as the job working directory.",
                    )
                })?
                .to_string_lossy()
                .into_owned();
            let guarded = self.context.guard().resolve(&root)?;
            (
                guarded.canonical.to_string_lossy().into_owned(),
                Some(guarded),
            )
        };
        if let Some(guarded) = &guarded {
            self.context.guard().verify_unchanged(guarded)?;
        }
        let lifetime_ms = request
            .timeout
            .as_ref()
            .map(duration_ms)
            .transpose()?
            .unwrap_or(0);
        let mut state = self.state.lock().await;
        if let Some(entry) = state.entries.get(&request.job_id) {
            return Ok(job_record(entry));
        }
        let running = state
            .entries
            .values()
            .filter(|entry| entry.status.is_none())
            .count();
        let limit = self.context.limits().max_running_jobs;
        if running >= limit as usize {
            return Err(refusal::job_limit(limit));
        }
        for name in request.env.keys() {
            if ["PATH", "LANG", "HOME", "TMPDIR", "USER", "LOGNAME", "TERM"]
                .contains(&name.as_str())
            {
                return Err(refusal::invalid_argument(format!(
                    "Environment variable {name} is managed by the Machine."
                )));
            }
        }
        let directory = self.context.state_dir.join("jobs").join(&request.job_id);
        fs::create_dir(&directory).map_err(|error| internal_io(&error))?;
        if let Err(error) = fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)) {
            let _ = fs::remove_dir_all(&directory);
            return Err(internal_io(&error));
        }
        for stream in ["stdout", "stderr"] {
            if let Err(error) = create_empty(&directory.join(stream)) {
                let _ = fs::remove_dir_all(&directory);
                return Err(error);
            }
        }
        let mut command = Command::new("setsid");
        command
            .args(["bash", "-c", &request.command])
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_clear();
        command
            .env(
                "PATH",
                std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".into()),
            )
            .env("LANG", "C.UTF-8")
            .env("TERM", "dumb");
        for name in ["HOME", "TMPDIR", "USER", "LOGNAME"] {
            if let Ok(value) = std::env::var(name) {
                command.env(name, value);
            }
        }
        for (name, value) in &request.env {
            command.env(name, value);
        }
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let _ = fs::remove_dir_all(&directory);
                return Err(Status::unavailable(format!(
                    "Unable to start managed bash: {error}"
                )));
            }
        };
        let Some(pid) = child.id() else {
            let _ = child.start_kill();
            let _ = child.wait().await;
            let _ = fs::remove_dir_all(&directory);
            return Err(Status::internal("The started job has no process id."));
        };
        let start = StoredJob {
            job_id: request.job_id,
            owner: request.owner,
            command: request.command,
            cwd,
            pid,
            started_at_ms: now_ms(),
            boot_id: machine_core::facts::boot_id(),
            lifetime_ms,
        };
        if let Err(error) = write_json_atomic(&directory.join("job.json"), &start) {
            signal_group(start.pid, rustix::process::Signal::KILL);
            let _ = child.wait().await;
            let _ = fs::remove_dir_all(&directory);
            return Err(internal_io(&error));
        }
        let (cancel, mut cancel_rx) = watch::channel(false);
        let entry = Entry {
            start: start.clone(),
            status: None,
            directory: directory.clone(),
            stdout_truncated: false,
            stderr_truncated: false,
            stop_requested: false,
            cancel,
        };
        state.entries.insert(start.job_id.clone(), entry);
        let job = job_record(
            state
                .entries
                .get(&start.job_id)
                .ok_or_else(|| Status::internal("Started job record disappeared."))?,
        );
        let _ = state.changes.send(job.clone());
        drop(state);
        let state = Arc::clone(&self.state);
        let cap = self.context.limits().job_output_bytes;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| Status::internal("Job stdout was not captured."))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| Status::internal("Job stderr was not captured."))?;
        let (out_stop, out_stop_rx) = watch::channel(false);
        let (err_stop, err_stop_rx) = watch::channel(false);
        let out_task = tokio::spawn(copy_output(
            stdout,
            directory.join("stdout"),
            cap,
            Arc::clone(&state),
            start.job_id.clone(),
            out_stop_rx,
            true,
        ));
        let err_task = tokio::spawn(copy_output(
            stderr,
            directory.join("stderr"),
            cap,
            Arc::clone(&state),
            start.job_id.clone(),
            err_stop_rx,
            false,
        ));
        tokio::spawn(async move {
            let (status, timed_out, cancelled) = if start.lifetime_ms == 0 {
                tokio::select! {
                    result = child.wait() => (result.ok(), false, false),
                    _ = cancel_rx.changed() => (None, false, true),
                }
            } else {
                tokio::select! {
                    result = time::timeout(
                        Duration::from_millis(start.lifetime_ms),
                        child.wait(),
                    ) => match result {
                        Ok(result) => (result.ok(), false, false),
                        Err(_) => (None, true, false),
                    },
                    _ = cancel_rx.changed() => (None, false, true),
                }
            };
            if timed_out || cancelled || status.is_none() {
                signal_group(start.pid, rustix::process::Signal::KILL);
                let stopped = time::timeout(STOP_BUDGET, async {
                    if child.wait().await.is_err() {
                        return false;
                    }
                    wait_group_empty(start.pid).await
                })
                .await
                .is_ok_and(|empty| empty);
                let stdout_drained = finish_output(out_task, out_stop).await;
                let stderr_drained = finish_output(err_task, err_stop).await;
                if !stdout_drained {
                    mark_truncated(&state, &start.job_id, true).await;
                }
                if !stderr_drained {
                    mark_truncated(&state, &start.job_id, false).await;
                }
                settle(
                    state,
                    &start.job_id,
                    Settlement {
                        state: if stopped {
                            if cancelled {
                                JobState::Cancelled
                            } else {
                                JobState::TimedOut
                            }
                        } else {
                            JobState::Lost
                        },
                        exit_code: None,
                        signal: Some("SIGKILL".into()),
                        lost_cause: (!stopped).then_some(LostCause::CancelUnproved as i32),
                    },
                )
                .await;
                return;
            }
            let Some(status) = status else { return };
            let (state_value, exit_code, signal, lost_cause) = {
                let proved = if is_group_empty(start.pid) {
                    true
                } else {
                    signal_group(start.pid, rustix::process::Signal::KILL);
                    time::timeout(STOP_BUDGET, wait_group_empty(start.pid))
                        .await
                        .is_ok_and(|empty| empty)
                };
                if proved {
                    if status.success() {
                        (JobState::Succeeded, status.code(), None, None)
                    } else {
                        (
                            JobState::Failed,
                            status.code(),
                            status.signal().map(signal_name),
                            None,
                        )
                    }
                } else {
                    (
                        JobState::Lost,
                        None,
                        None,
                        Some(LostCause::CancelUnproved as i32),
                    )
                }
            };
            let stdout_drained = finish_output(out_task, out_stop).await;
            let stderr_drained = finish_output(err_task, err_stop).await;
            if !stdout_drained {
                mark_truncated(&state, &start.job_id, true).await;
            }
            if !stderr_drained {
                mark_truncated(&state, &start.job_id, false).await;
            }
            let cancelled = state
                .lock()
                .await
                .entries
                .get(&start.job_id)
                .is_some_and(|entry| entry.stop_requested);
            settle(
                state,
                &start.job_id,
                Settlement {
                    state: if cancelled {
                        if lost_cause.is_some() {
                            JobState::Lost
                        } else {
                            JobState::Cancelled
                        }
                    } else {
                        state_value
                    },
                    exit_code: if cancelled { None } else { exit_code },
                    signal: if cancelled {
                        Some("SIGKILL".into())
                    } else {
                        signal
                    },
                    lost_cause,
                },
            )
            .await;
        });
        Ok(job)
    }
}

async fn finish_output(mut task: tokio::task::JoinHandle<()>, stop: watch::Sender<bool>) -> bool {
    if time::timeout(STOP_BUDGET, &mut task).await.is_ok() {
        return true;
    }
    stop.send_replace(true);
    let drained = time::timeout(STOP_BUDGET, &mut task).await.is_ok();
    if !drained {
        task.abort();
        let _ = task.await;
    }
    false
}

async fn mark_truncated(state: &Arc<Mutex<State>>, id: &str, stdout: bool) {
    let mut state = state.lock().await;
    if let Some(entry) = state.entries.get_mut(id) {
        if stdout {
            entry.stdout_truncated = true;
        } else {
            entry.stderr_truncated = true;
        }
        let truncation = OutputTruncation {
            stdout: entry.stdout_truncated,
            stderr: entry.stderr_truncated,
        };
        if let Err(error) = write_json_atomic(&entry.directory.join("truncated.json"), &truncation)
        {
            tracing::error!(job_id = id, %error, "Unable to persist output truncation");
        }
    }
}
#[allow(clippy::too_many_arguments)]
async fn copy_output<R: AsyncRead + Unpin>(
    mut source: R,
    path: PathBuf,
    cap: u64,
    state: Arc<Mutex<State>>,
    id: String,
    mut stop: watch::Receiver<bool>,
    stdout: bool,
) {
    let Ok(mut file) = tokio::fs::OpenOptions::new().append(true).open(path).await else {
        return;
    };
    let mut count = 0u64;
    let mut buffer = [0u8; 16 * 1024];
    loop {
        let read = tokio::select! {
            _ = stop.changed() => break,
            result = source.read(&mut buffer) => match result {
                Ok(read) => read,
                Err(_) => break,
            },
        };
        if read == 0 {
            break;
        }
        let keep = read.min(usize::try_from(cap.saturating_sub(count)).unwrap_or(usize::MAX));
        if keep > 0 {
            if file.write_all(&buffer[..keep]).await.is_err() {
                break;
            }
            count = count.saturating_add(keep as u64);
        }
        if read > keep {
            let mut state = state.lock().await;
            if let Some(entry) = state.entries.get_mut(&id) {
                if stdout {
                    entry.stdout_truncated = true;
                } else {
                    entry.stderr_truncated = true;
                }
                let truncation = OutputTruncation {
                    stdout: entry.stdout_truncated,
                    stderr: entry.stderr_truncated,
                };
                if let Err(error) =
                    write_json_atomic(&entry.directory.join("truncated.json"), &truncation)
                {
                    tracing::error!(job_id = id, %error, "Unable to persist output truncation");
                }
            }
        }
    }
    let _ = file.flush().await;
}
async fn settle(state: Arc<Mutex<State>>, id: &str, outcome: Settlement) {
    time::sleep(Duration::from_millis(15)).await;
    let mut state = state.lock().await;
    let Some(entry) = state.entries.get_mut(id) else {
        return;
    };
    if entry.status.is_some() {
        return;
    }
    let status = StoredStatus {
        state: outcome.state as i32,
        ended_at_ms: now_ms(),
        exit_code: outcome.exit_code,
        signal: outcome.signal,
        stdout_bytes: file_len(&entry.directory.join("stdout")),
        stderr_bytes: file_len(&entry.directory.join("stderr")),
        wall_time_ms: now_ms().saturating_sub(entry.start.started_at_ms),
        stdout_truncated: entry.stdout_truncated,
        stderr_truncated: entry.stderr_truncated,
        lost_cause: outcome.lost_cause,
    };
    if let Err(error) = write_json_atomic(&entry.directory.join("status.json"), &status) {
        tracing::error!(job_id = id, %error, "Unable to persist Machine job settlement");
    }
    entry.status = Some(status);
    let job = job_record(entry);
    let _ = state.changes.send(job);
}

async fn cancel_job(state: Arc<Mutex<State>>, id: String, owner: String) -> Result<Job, Status> {
    let (pid, cancel) = {
        let mut state = state.lock().await;
        let entry = state
            .entries
            .get_mut(&id)
            .filter(|entry| entry.start.owner == owner)
            .ok_or_else(refusal::job_not_found)?;
        if entry.status.is_some() {
            return Ok(job_record(entry));
        }
        let pid = entry.start.pid;
        if is_group_empty(pid) {
            (pid, None)
        } else {
            entry.stop_requested = true;
            (pid, Some(entry.cancel.clone()))
        }
    };
    if let Some(cancel) = cancel {
        cancel.send_replace(true);
        signal_group(pid, rustix::process::Signal::KILL);
    }
    wait_for_cancel_settlement(state, id, owner, Duration::from_secs(1)).await
}

async fn wait_for_cancel_settlement(
    state: Arc<Mutex<State>>,
    id: String,
    owner: String,
    budget: Duration,
) -> Result<Job, Status> {
    let result = time::timeout(budget, async {
        loop {
            let state = state.lock().await;
            let entry = state
                .entries
                .get(&id)
                .filter(|entry| entry.start.owner == owner)
                .ok_or_else(refusal::job_not_found)?;
            if entry.status.is_some() {
                return Ok(job_record(entry));
            }
            drop(state);
            time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await;
    if let Ok(result) = result {
        return result;
    }
    settle(
        Arc::clone(&state),
        &id,
        Settlement {
            state: JobState::Lost,
            exit_code: None,
            signal: Some("SIGKILL".into()),
            lost_cause: Some(LostCause::CancelUnproved as i32),
        },
    )
    .await;
    let state = state.lock().await;
    state
        .entries
        .get(&id)
        .filter(|entry| entry.start.owner == owner)
        .map(job_record)
        .ok_or_else(refusal::job_not_found)
}
fn owner_scoped_request_id(owner: &str, request_id: &str) -> String {
    if request_id.is_empty() {
        String::new()
    } else {
        format!("{}:{owner}{request_id}", owner.len())
    }
}

async fn delete_job(state: Arc<Mutex<State>>, id: String, owner: String) -> Result<(), Status> {
    let mut state = state.lock().await;
    let entry = state
        .entries
        .get(&id)
        .filter(|entry| entry.start.owner == owner)
        .ok_or_else(refusal::job_not_found)?;
    if entry.status.is_none() {
        return Err(refusal::job_running());
    }
    fs::remove_dir_all(&entry.directory).map_err(|error| internal_io(&error))?;
    state.entries.remove(&id);
    Ok(())
}

fn job_record(entry: &Entry) -> Job {
    let status = entry.status.as_ref();
    Job {
        id: entry.start.job_id.clone(),
        owner: entry.start.owner.clone(),
        state: status.map_or(JobState::Running as i32, |s| s.state),
        created_at: Some(timestamp(entry.start.started_at_ms)),
        ended_at: status.map(|s| timestamp(s.ended_at_ms)),
        timeout: (entry.start.lifetime_ms != 0).then(|| ProtoDuration {
            seconds: i64::try_from(entry.start.lifetime_ms / 1000).unwrap_or(i64::MAX),
            nanos: i32::try_from((entry.start.lifetime_ms % 1000) * 1_000_000).unwrap_or(i32::MAX),
        }),
        exit_code: status.and_then(|s| s.exit_code),
        signal: status.and_then(|s| s.signal.clone()),
        stdout: Some(Output {
            bytes: status.map_or_else(
                || file_len(&entry.directory.join("stdout")),
                |s| s.stdout_bytes,
            ),
            truncated: status.map_or(entry.stdout_truncated, |s| s.stdout_truncated),
        }),
        stderr: Some(Output {
            bytes: status.map_or_else(
                || file_len(&entry.directory.join("stderr")),
                |s| s.stderr_bytes,
            ),
            truncated: status.map_or(entry.stderr_truncated, |s| s.stderr_truncated),
        }),
        lost_cause: status
            .and_then(|s| s.lost_cause)
            .unwrap_or(LostCause::Unspecified as i32),
    }
}

fn duration_ms(duration: &ProtoDuration) -> Result<u64, Status> {
    if duration.seconds < 0 || duration.nanos < 0 || duration.nanos >= 1_000_000_000 {
        return Err(refusal::invalid_argument(
            "Job timeout must be a non-negative duration.",
        ));
    }
    let nanos = u64::try_from(duration.nanos).unwrap_or(u64::MAX);
    let nanos_ms = nanos.saturating_add(999_999) / 1_000_000;
    let millis = u64::try_from(duration.seconds)
        .unwrap_or(u64::MAX)
        .saturating_mul(1000)
        .saturating_add(nanos_ms);
    Ok(millis)
}
fn write_json_atomic(path: &Path, value: &impl Serialize) -> std::io::Result<()> {
    let temporary = path.with_file_name(format!(
        "{}.{}.{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos())
    ));
    let bytes = serde_json::to_vec(value).map_err(std::io::Error::other)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    fs::rename(temporary, path)
}
fn create_empty(path: &Path) -> Result<(), Status> {
    File::create(path)
        .map(|_| ())
        .map_err(|error| internal_io(&error))
}
fn file_len(path: &Path) -> u64 {
    fs::metadata(path).map_or(0, |metadata| metadata.len())
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}
fn internal_io(error: &std::io::Error) -> Status {
    Status::internal(error.to_string())
}
fn timestamp(milliseconds: u64) -> Timestamp {
    machine_core::time::timestamp(UNIX_EPOCH + Duration::from_millis(milliseconds))
}
#[cfg(target_os = "linux")]
fn signal_group(pid: u32, signal: rustix::process::Signal) {
    if let Some(pid) = rustix::process::Pid::from_raw(pid.cast_signed()) {
        let _ = rustix::process::kill_process_group(pid, signal);
    }
}
#[cfg(not(target_os = "linux"))]
fn signal_group(_: u32, _: rustix::process::Signal) {}
#[cfg(target_os = "linux")]
fn is_group_empty(pid: u32) -> bool {
    let Some(pid) = rustix::process::Pid::from_raw(pid.cast_signed()) else {
        return false;
    };
    rustix::process::test_kill_process_group(pid)
        .is_err_and(|error| error == rustix::io::Errno::SRCH)
}
#[cfg(not(target_os = "linux"))]
fn is_group_empty(_: u32) -> bool {
    false
}
#[cfg(target_os = "linux")]
async fn wait_group_empty(pid: u32) -> bool {
    let Some(pid) = rustix::process::Pid::from_raw(pid.cast_signed()) else {
        return false;
    };
    let deadline = Instant::now() + STOP_BUDGET;
    loop {
        if rustix::process::test_kill_process_group(pid)
            .is_err_and(|error| error == rustix::io::Errno::SRCH)
        {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        time::sleep(Duration::from_millis(10)).await;
    }
}
#[cfg(not(target_os = "linux"))]
async fn wait_group_empty(_: u32) -> bool {
    false
}
#[cfg(unix)]
fn signal_name(signal: i32) -> String {
    let name = match signal {
        1 => "HUP",
        2 => "INT",
        3 => "QUIT",
        4 => "ILL",
        6 => "ABRT",
        9 => "KILL",
        11 => "SEGV",
        13 => "PIPE",
        14 => "ALRM",
        15 => "TERM",
        _ => return format!("SIG{signal}"),
    };
    format!("SIG{name}")
}
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unresolved_cancellation_settles_lost_instead_of_erroring() {
        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path().join("job");
        fs::create_dir(&directory).unwrap();
        File::create(directory.join("stdout")).unwrap();
        File::create(directory.join("stderr")).unwrap();
        let id = "d223456789abcdef0123456789abcdef";
        let (changes, _) = broadcast::channel(4);
        let (cancel, _) = watch::channel(false);
        let state = Arc::new(Mutex::new(State {
            entries: HashMap::from([(
                id.to_owned(),
                Entry {
                    start: StoredJob {
                        job_id: id.to_owned(),
                        owner: "owner-a".into(),
                        command: "sleep".into(),
                        cwd: directory.to_string_lossy().into_owned(),
                        pid: u32::MAX,
                        started_at_ms: now_ms(),
                        boot_id: String::new(),
                        lifetime_ms: 0,
                    },
                    status: None,
                    directory,
                    stdout_truncated: false,
                    stderr_truncated: false,
                    stop_requested: true,
                    cancel,
                },
            )]),
            changes,
        }));

        let job = wait_for_cancel_settlement(
            state,
            id.to_owned(),
            "owner-a".into(),
            Duration::from_millis(1),
        )
        .await
        .unwrap();

        assert_eq!(job.state, JobState::Lost as i32);
        assert_eq!(job.lost_cause, LostCause::CancelUnproved as i32);
    }
}
