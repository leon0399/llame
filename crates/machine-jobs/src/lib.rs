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
    sync::{Mutex, broadcast, mpsc},
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
    truncated: bool,
    wall_time_ms: u64,
    #[serde(default)]
    stdout_truncated: bool,
    #[serde(default)]
    stderr_truncated: bool,
    lost_cause: Option<i32>,
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
pub async fn service(context: Context) -> anyhow::Result<JobServiceServer<Jobs>> {
    let root = context.state_dir.join("jobs");
    fs::create_dir_all(&root)?;
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
    let current_boot = boot_id();
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
        let status_path = directory.join("status.json");
        let mut status = fs::read(&status_path)
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
                    truncated: false,
                    wall_time_ms: 0,
                    stdout_truncated: false,
                    stderr_truncated: false,
                    lost_cause: Some(if start.boot_id == current_boot {
                        LostCause::DaemonRestarted as i32
                    } else {
                        LostCause::MachineRebooted as i32
                    }),
                };
                write_json_atomic(&status_path, &lost).ok()?;
                Some(lost)
            });
        if let Some(status) = &mut status
            && status.truncated
            && !status.stdout_truncated
            && !status.stderr_truncated
        {
            status.stdout_truncated = true;
            status.stderr_truncated = true;
        }
        let Some(status) = status else { continue };
        entries.insert(
            start.job_id.clone(),
            Entry {
                start,
                stdout_truncated: status.stdout_truncated,
                stderr_truncated: status.stderr_truncated,
                status: Some(status),
                directory,
                stop_requested: false,
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
        let state = Arc::clone(&self.state);
        let mut changes = self.state.lock().await.changes.subscribe();
        tokio::spawn(async move {
            let snapshot = {
                state
                    .lock()
                    .await
                    .entries
                    .values()
                    .map(job_record)
                    .collect::<Vec<_>>()
            };
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
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
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
        let job = self
            .cancels
            .run(&request.request_id, || async move {
                cancel_job(state, request.job_id, request.owner).await
            })
            .await?;
        Ok(Response::new(CancelJobResponse { job: Some(job) }))
    }

    async fn delete_job(
        &self,
        request: Request<DeleteJobRequest>,
    ) -> Result<Response<DeleteJobResponse>, Status> {
        let request = request.into_inner();
        let state = Arc::clone(&self.state);
        self.deletes
            .run(&request.request_id, || async move {
                delete_job(state, request.job_id, request.owner).await
            })
            .await?;
        Ok(Response::new(DeleteJobResponse {}))
    }
}

impl Jobs {
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
        let (cwd, guarded) = match request.cwd.as_deref() {
            Some(path) => {
                let guarded = self.context.guard().resolve(path)?;
                (
                    guarded.canonical.to_string_lossy().into_owned(),
                    Some(guarded),
                )
            }
            None => {
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
            }
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
        fs::create_dir(&directory).map_err(internal_io)?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).map_err(internal_io)?;
        create_empty(&directory.join("stdout"))?;
        create_empty(&directory.join("stderr"))?;
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
        let mut child = command.spawn().map_err(|error| {
            Status::unavailable(format!("Unable to start managed bash: {error}"))
        })?;
        let pid = child
            .id()
            .ok_or_else(|| Status::internal("The started job has no process id."))?;
        let start = StoredJob {
            job_id: request.job_id,
            owner: request.owner,
            command: request.command,
            cwd,
            pid,
            started_at_ms: now_ms(),
            boot_id: boot_id(),
            lifetime_ms,
        };
        write_json_atomic(&directory.join("job.json"), &start).map_err(internal_io)?;
        let entry = Entry {
            start: start.clone(),
            status: None,
            directory: directory.clone(),
            stdout_truncated: false,
            stderr_truncated: false,
            stop_requested: false,
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
        let out_task = tokio::spawn(copy_output(
            stdout,
            directory.join("stdout"),
            cap,
            Arc::clone(&state),
            start.job_id.clone(),
            true,
        ));
        let err_task = tokio::spawn(copy_output(
            stderr,
            directory.join("stderr"),
            cap,
            Arc::clone(&state),
            start.job_id.clone(),
            false,
        ));
        tokio::spawn(async move {
            let wait = child.wait();
            let status = if start.lifetime_ms == 0 {
                wait.await.ok()
            } else {
                match time::timeout(Duration::from_millis(start.lifetime_ms), wait).await {
                    Ok(result) => result.ok(),
                    Err(_) => {
                        signal_group(start.pid, rustix::process::Signal::KILL);
                        let _ = time::timeout(STOP_BUDGET, wait_group_empty(start.pid)).await;
                        let _ = out_task.await;
                        let _ = err_task.await;
                        settle(
                            state,
                            &start.job_id,
                            Settlement {
                                state: JobState::TimedOut,
                                exit_code: None,
                                signal: Some("SIGKILL".into()),
                                lost_cause: None,
                            },
                        )
                        .await;
                        return;
                    }
                }
            };
            let (state_value, exit_code, signal) = match status {
                Some(status) if status.success() => (JobState::Succeeded, status.code(), None),
                Some(status) => (
                    JobState::Failed,
                    status.code(),
                    status.signal().map(signal_name),
                ),
                None => (JobState::Lost, None, Some("wait_failed".into())),
            };
            let _ = out_task.await;
            let _ = err_task.await;
            if state
                .lock()
                .await
                .entries
                .get(&start.job_id)
                .is_some_and(|entry| entry.stop_requested)
            {
                return;
            }
            settle(
                state,
                &start.job_id,
                Settlement {
                    state: state_value,
                    exit_code,
                    signal,
                    lost_cause: None,
                },
            )
            .await;
        });
        Ok(job)
    }
}

#[allow(clippy::too_many_arguments)]
async fn copy_output<R: AsyncRead + Unpin>(
    mut source: R,
    path: PathBuf,
    cap: u64,
    state: Arc<Mutex<State>>,
    id: String,
    stdout: bool,
) {
    let Ok(mut file) = tokio::fs::OpenOptions::new().append(true).open(path).await else {
        return;
    };
    let mut count = 0u64;
    let mut buffer = [0u8; 16 * 1024];
    loop {
        let Ok(read) = source.read(&mut buffer).await else {
            return;
        };
        if read == 0 {
            break;
        }
        let keep = read.min(usize::try_from(cap.saturating_sub(count)).unwrap_or(usize::MAX));
        if keep > 0 {
            if file.write_all(&buffer[..keep]).await.is_err() {
                return;
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
            }
        }
    }
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
        truncated: entry.stdout_truncated || entry.stderr_truncated,
        wall_time_ms: now_ms().saturating_sub(entry.start.started_at_ms),
        stdout_truncated: entry.stdout_truncated,
        stderr_truncated: entry.stderr_truncated,
        lost_cause: outcome.lost_cause,
    };
    if write_json_atomic(&entry.directory.join("status.json"), &status).is_err() {
        return;
    }
    entry.status = Some(status);
    let job = job_record(entry);
    let _ = state.changes.send(job);
}

async fn cancel_job(state: Arc<Mutex<State>>, id: String, owner: String) -> Result<Job, Status> {
    let pid = {
        let mut state = state.lock().await;
        let entry = state
            .entries
            .get_mut(&id)
            .filter(|entry| entry.start.owner == owner)
            .ok_or_else(refusal::job_not_found)?;
        if entry.status.is_some() {
            return Ok(job_record(entry));
        }
        entry.stop_requested = true;
        entry.start.pid
    };
    signal_group(pid, rustix::process::Signal::KILL);
    let proved = time::timeout(STOP_BUDGET, wait_group_empty(pid))
        .await
        .is_ok_and(|empty| empty);
    let outcome = if proved {
        Settlement {
            state: JobState::Cancelled,
            exit_code: None,
            signal: Some("SIGKILL".into()),
            lost_cause: None,
        }
    } else {
        Settlement {
            state: JobState::Lost,
            exit_code: None,
            signal: Some("SIGKILL".into()),
            lost_cause: Some(LostCause::CancelUnproved as i32),
        }
    };
    settle(Arc::clone(&state), &id, outcome).await;
    state
        .lock()
        .await
        .entries
        .get(&id)
        .map(job_record)
        .ok_or_else(refusal::job_not_found)
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
    fs::remove_dir_all(&entry.directory).map_err(internal_io)?;
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
    let millis = u64::try_from(duration.seconds)
        .unwrap_or(u64::MAX)
        .saturating_mul(1000)
        .saturating_add(u64::try_from(duration.nanos / 1_000_000).unwrap_or(0));
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
    File::create(path).map(|_| ()).map_err(internal_io)
}
fn file_len(path: &Path) -> u64 {
    fs::metadata(path).map_or(0, |metadata| metadata.len())
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}
fn boot_id() -> String {
    fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .unwrap_or_default()
        .trim()
        .to_owned()
}
fn internal_io(error: std::io::Error) -> Status {
    Status::internal(error.to_string())
}
fn timestamp(milliseconds: u64) -> Timestamp {
    Timestamp {
        seconds: i64::try_from(milliseconds / 1_000).unwrap_or(i64::MAX),
        nanos: i32::try_from((milliseconds % 1_000) * 1_000_000).unwrap_or(i32::MAX),
    }
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
