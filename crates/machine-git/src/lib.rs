//! `GitService`: repository facts, status, and worktree management.

use machine_core::{Context, IdempotencyCache};
use machine_protocol::v1::{
    Change, ChangeCounts, Commit, CreateWorktreeRequest, CreateWorktreeResponse,
    DeleteWorktreeRequest, DeleteWorktreeResponse, GetRepositoryRequest, GetRepositoryResponse,
    GetStatusRequest, GetStatusResponse, GitFailure, GitFailureReason, ListWorktreesRequest,
    ListWorktreesResponse, LocateRepositoryRequest, LocateRepositoryResponse, Operation,
    OperationKind, Remote, Repository, Status, SubmoduleMode, Upstream, Worktree, Worktrees,
    create_worktree_response::Result as CreateResult,
    delete_worktree_response::Result as DeleteResult,
    get_repository_response::Result as RepoResult,
    get_status_response::Result as StatusResult,
    git_service_server::{GitService, GitServiceServer},
    list_worktrees_response::Result as ListResult,
    locate_repository_response::Result as LocateResult,
};
use prost_types::Timestamp;
use std::{
    fs,
    io::Read as _,
    os::unix::{ffi::OsStrExt, fs::OpenOptionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};

use rustix::process::{Pid, Signal, kill_process_group};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    time::timeout,
};
use tonic::{Request, Response, Status as RpcStatus};

#[cfg(test)]
static GIT_PATH_OVERRIDE: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

const OUTPUT_MAX: usize = 1024 * 1024;
const STDERR_MAX: usize = 4096;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);

pub fn service(context: Context) -> GitServiceServer<Git> {
    GitServiceServer::new(Git {
        context,
        create_cache: IdempotencyCache::default(),
        delete_cache: IdempotencyCache::default(),
    })
}
pub struct Git {
    context: Context,
    create_cache: IdempotencyCache<Result<Worktree, GitFailure>>,
    delete_cache: IdempotencyCache<Result<(), GitFailure>>,
}
#[derive(Debug)]
struct Output {
    status: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    timed_out: bool,
    bounded: bool,
}
fn failure(reason: GitFailureReason, stderr: impl Into<String>) -> GitFailure {
    GitFailure {
        reason: reason as i32,
        message: String::new(),
        stderr: stderr.into(),
    }
}
fn invalid(message: &str) -> GitFailure {
    GitFailure {
        reason: GitFailureReason::InvalidInput as i32,
        message: message.into(),
        stderr: String::new(),
    }
}
fn process_failure(out: &Output) -> GitFailure {
    let reason = if out.bounded {
        GitFailureReason::OutputTooLarge
    } else if out.timed_out {
        GitFailureReason::TimedOut
    } else {
        GitFailureReason::GitFailed
    };
    failure(reason, String::from_utf8_lossy(&out.stderr).into_owned())
}
fn succeed(out: &Output) -> bool {
    out.status == Some(0) && !out.bounded && !out.timed_out
}
fn text(bytes: &[u8]) -> std::borrow::Cow<'_, str> {
    String::from_utf8_lossy(bytes)
}
fn line(out: &Output) -> String {
    text(&out.stdout).trim_end_matches(['\r', '\n']).to_owned()
}
async fn read_capped<R: AsyncRead + Unpin>(mut input: R, limit: usize) -> (Vec<u8>, bool) {
    let mut output = Vec::with_capacity(limit.min(8192));
    let mut buffer = [0; 8192];
    let mut bounded = false;
    loop {
        match input.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let retained = limit.saturating_sub(output.len()).min(n);
                output.extend_from_slice(&buffer[..retained]);
                bounded |= retained < n;
            }
        }
    }
    (output, bounded)
}
struct ProcessGroup(Option<i32>);
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        if let Some(pid) = self.0.and_then(Pid::from_raw) {
            let _ = kill_process_group(pid, Signal::KILL);
        }
    }
}
async fn run(directory: &Path, args: &[&str], deadline: Instant) -> Output {
    run_mode(directory, args, deadline, false).await
}
async fn run_pinned(directory: &Path, args: &[&str], deadline: Instant) -> Output {
    run_mode(directory, args, deadline, true).await
}
#[allow(clippy::too_many_lines)]
async fn run_mode(directory: &Path, args: &[&str], deadline: Instant, pinned: bool) -> Output {
    let ceiling = directory.parent();
    if pinned && ceiling.is_some_and(|path| path.to_string_lossy().contains(':')) {
        return Output {
            status: None,
            stdout: vec![],
            stderr: b"git ceiling path contains ':'".to_vec(),
            timed_out: false,
            bounded: false,
        };
    }
    let mut command = Command::new("git");
    if pinned {
        command
            .arg(format!("--work-tree={}", directory.display()))
            .args([
                "-c",
                "log.showSignature=false",
                "-c",
                "safe.bareRepository=explicit",
            ]);
    }
    if let Some(ceiling) = ceiling.filter(|_| pinned) {
        command.env("GIT_CEILING_DIRECTORIES", ceiling);
        command.env("GIT_NO_LAZY_FETCH", "1");
    }
    let hooks = match tempfile::tempdir() {
        Ok(value) => value,
        Err(e) => {
            return Output {
                status: None,
                stdout: vec![],
                stderr: e.to_string().into_bytes(),
                timed_out: false,
                bounded: false,
            };
        }
    };
    command
        .args([
            "-c",
            &format!("core.hooksPath={}", hooks.path().display()),
            "-c",
            "core.fsmonitor=false",
            "-C",
        ])
        .arg(directory)
        .args(args)
        .env_clear()
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(ceiling) = ceiling.filter(|_| pinned) {
        command.env("GIT_CEILING_DIRECTORIES", ceiling);
        command.env("GIT_NO_LAZY_FETCH", "1");
    }
    for name in ["PATH", "HOME", "TMPDIR"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    #[cfg(test)]
    if let Some(path) = GIT_PATH_OVERRIDE
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
    {
        command.env("PATH", path);
    }
    command.as_std_mut().process_group(0);
    let mut child = match command.spawn() {
        Ok(v) => v,
        Err(e) => {
            return Output {
                status: None,
                stdout: vec![],
                stderr: e.to_string().into_bytes(),
                timed_out: false,
                bounded: false,
            };
        }
    };
    let mut group = ProcessGroup(child.id().and_then(|id| i32::try_from(id).ok()));
    let Some(stdout) = child.stdout.take() else {
        return Output {
            status: None,
            stdout: vec![],
            stderr: b"git stdout unavailable".to_vec(),
            timed_out: false,
            bounded: false,
        };
    };
    let Some(stderr) = child.stderr.take() else {
        return Output {
            status: None,
            stdout: vec![],
            stderr: b"git stderr unavailable".to_vec(),
            timed_out: false,
            bounded: false,
        };
    };
    let mut stdout_task = tokio::spawn(read_capped(stdout, OUTPUT_MAX));
    let mut stderr_task = tokio::spawn(read_capped(stderr, STDERR_MAX));
    let (timed_out, status) = if let Ok(Ok(status)) = timeout(
        deadline.saturating_duration_since(Instant::now()),
        child.wait(),
    )
    .await
    {
        (false, status.code())
    } else {
        if let Some(pid) = group.0.and_then(Pid::from_raw) {
            let _ = kill_process_group(pid, Signal::KILL);
        }
        let _ = child.wait().await;
        (true, None)
    };
    let readers = timeout(deadline.saturating_duration_since(Instant::now()), async {
        tokio::join!(&mut stdout_task, &mut stderr_task)
    })
    .await;
    let (stdout, stderr, reader_timed_out, bounded) = if let Ok((stdout, stderr)) = readers {
        let (stdout, a) = stdout.unwrap_or_default();
        let (stderr, b) = stderr.unwrap_or_default();
        (stdout, stderr, false, a || b)
    } else {
        if let Some(pid) = group.0.and_then(Pid::from_raw) {
            let _ = kill_process_group(pid, Signal::KILL);
        }
        stdout_task.abort();
        stderr_task.abort();
        (Vec::new(), Vec::new(), true, false)
    };
    group.0 = None;
    Output {
        status,
        stdout,
        stderr,
        timed_out: timed_out || reader_timed_out,
        bounded,
    }
}
fn redact_remote_url(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_owned();
    };
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if let Some((_, host)) = authority.rsplit_once('@') {
        format!("{scheme}://{host}{}", &rest[authority_end..])
    } else {
        url.to_owned()
    }
}
fn parse_remotes(value: &str) -> Vec<Remote> {
    value
        .split('\0')
        .filter(|s| !s.is_empty())
        .filter_map(|r| {
            let (key, url) = r.split_once('\n').or_else(|| r.split_once(' '))?;
            Some(Remote {
                name: key
                    .strip_prefix("remote.")?
                    .strip_suffix(".url")?
                    .to_owned(),
                url: redact_remote_url(url),
            })
        })
        .collect()
}
fn validate_branch(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with(['-', '/'])
        && !value.ends_with(['/', '.'])
        && !value.contains("..")
        && !value.contains("@{")
        && !value
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || "~^:?*[\\".contains(c))
        && value.split('/').all(|part| {
            !part.is_empty()
                && !part.starts_with('.')
                && Path::new(part)
                    .extension()
                    .is_none_or(|extension| extension != "lock")
        })
}
fn root_result(guard: &machine_core::RootGuard, path: String) -> Result<String, RpcStatus> {
    let p = PathBuf::from(&path);
    if machine_core::guard::is_inside(guard.roots(), &p) {
        Ok(path)
    } else {
        Err(machine_core::refusal::path_not_registered())
    }
}
fn nearest_git(path: &Path, roots: &[PathBuf]) -> Option<PathBuf> {
    let mut current = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()?.to_path_buf()
    };
    let ceiling = roots
        .iter()
        .filter(|r| current.starts_with(r))
        .min_by_key(|r| r.as_os_str().len())?
        .clone();
    loop {
        let entry = current.join(".git");
        if fs::metadata(&entry).is_ok() {
            return Some(entry);
        }
        if current == ceiling || !current.pop() {
            return None;
        }
    }
}
fn git_directory(entry: &Path) -> Option<PathBuf> {
    if entry.is_dir() {
        return Some(fs::canonicalize(entry).unwrap_or_else(|_| entry.to_path_buf()));
    }
    let content = String::from_utf8(read_regular_bytes(entry).ok()??).ok()?;
    let target = content.trim().strip_prefix("gitdir: ")?;
    let target = PathBuf::from(target);
    let target = if target.is_absolute() {
        target
    } else {
        entry.parent()?.join(target)
    };
    Some(fs::canonicalize(&target).unwrap_or(target))
}

fn alternate_paths(alternates: &[u8]) -> impl Iterator<Item = &[u8]> {
    alternates
        .split(|byte| *byte == b'\n')
        .map(|entry| entry.split(|byte| *byte == 0).next().unwrap_or_default())
        .filter(|entry| !entry.is_empty())
}

fn read_regular_bytes(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    let file = match fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Git metadata is not a regular file",
        ));
    }
    let mut value = Vec::new();

    file.take(1024 * 1024 + 1).read_to_end(&mut value)?;
    if value.len() > 1024 * 1024 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Git metadata exceeds the size limit",
        ));
    }
    Ok(Some(value))
}

fn read_git_metadata_bytes(path: &Path, roots: &[PathBuf]) -> Result<Option<Vec<u8>>, GitFailure> {
    let resolved = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if !machine_core::guard::is_inside(roots, &resolved) {
        return Err(failure(GitFailureReason::OutsideRoots, ""));
    }
    read_regular_bytes(path).map_err(|_| failure(GitFailureReason::GitFailed, ""))
}

fn read_git_metadata(path: &Path, roots: &[PathBuf]) -> Result<Option<String>, GitFailure> {
    read_git_metadata_bytes(path, roots)?
        .map(|value| String::from_utf8(value).map_err(|_| failure(GitFailureReason::GitFailed, "")))
        .transpose()
}

fn read_optional_git_text(path: &Path) -> Result<Option<String>, GitFailure> {
    read_regular_bytes(path)
        .map_err(|_| failure(GitFailureReason::GitFailed, ""))?
        .map(|value| String::from_utf8(value).map_err(|_| failure(GitFailureReason::GitFailed, "")))
        .transpose()
}

fn checked_git_data(entry: &Path, roots: &[PathBuf]) -> Result<(PathBuf, PathBuf), GitFailure> {
    let entry = fs::canonicalize(entry).unwrap_or_else(|_| entry.to_path_buf());
    if !machine_core::guard::is_inside(roots, &entry) {
        return Err(failure(GitFailureReason::OutsideRoots, ""));
    }
    let Some(git_dir) = git_directory(&entry) else {
        return Err(failure(GitFailureReason::GitFailed, ""));
    };
    let inside = |path: &Path| machine_core::guard::is_inside(roots, path);
    if !inside(&git_dir) {
        return Err(failure(GitFailureReason::OutsideRoots, ""));
    }
    let common_dir = read_git_metadata(&git_dir.join("commondir"), roots)?
        .map(|value| {
            let value = PathBuf::from(value.trim());
            if value.is_absolute() {
                value
            } else {
                git_dir.join(value)
            }
        })
        .map_or_else(
            || git_dir.clone(),
            |path| fs::canonicalize(&path).unwrap_or(path),
        );
    if !inside(&common_dir) {
        return Err(failure(GitFailureReason::OutsideRoots, ""));
    }
    let mut pending = vec![git_dir.join("objects"), common_dir.join("objects")];
    let mut checked = Vec::new();
    while let Some(objects) = pending.pop() {
        let objects = fs::canonicalize(&objects).unwrap_or(objects);
        if checked.contains(&objects) {
            continue;
        }
        if !inside(&objects) {
            return Err(failure(GitFailureReason::OutsideRoots, ""));
        }
        checked.push(objects.clone());
        if let Some(alternates) = read_git_metadata_bytes(&objects.join("info/alternates"), roots)?
        {
            for alternate in alternate_paths(&alternates) {
                if alternate.starts_with(b"\"") {
                    return Err(failure(GitFailureReason::OutsideRoots, ""));
                }
                let path = PathBuf::from(std::ffi::OsStr::from_bytes(alternate));
                pending.push(if path.is_absolute() {
                    path
                } else {
                    objects.join(path)
                });
            }
        }
    }
    Ok((git_dir, common_dir))
}

fn option_like(values: &[&str]) -> bool {
    values.iter().any(|value| value.starts_with('-'))
}
#[allow(clippy::too_many_lines)]
async fn repository(
    directory: &Path,
    guard: &machine_core::RootGuard,
    pinned: bool,
    deadline: Instant,
) -> Result<Repository, GitFailure> {
    let get = |args: &'static [&'static str]| async move {
        if pinned {
            run_pinned(directory, args, deadline).await
        } else {
            run(directory, args, deadline).await
        }
    };
    let top = get(&["rev-parse", "--show-toplevel"]).await;
    if !succeed(&top) {
        return Err(process_failure(&top));
    }
    let gd = get(&["rev-parse", "--path-format=absolute", "--git-dir"]).await;
    if !succeed(&gd) {
        return Err(process_failure(&gd));
    }
    let cd = get(&["rev-parse", "--path-format=absolute", "--git-common-dir"]).await;
    if !succeed(&cd) {
        return Err(process_failure(&cd));
    }
    let worktree = line(&top);
    let git_dir = line(&gd);
    let common_dir = line(&cd);
    let obj = get(&[
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "objects",
    ])
    .await;
    if !succeed(&obj) {
        return Err(process_failure(&obj));
    }
    let objects = PathBuf::from(line(&obj));
    for value in [&git_dir, &common_dir] {
        let p = fs::canonicalize(value).unwrap_or_else(|_| PathBuf::from(value));
        if !machine_core::guard::is_inside(guard.roots(), &p) {
            return Err(failure(GitFailureReason::OutsideRoots, ""));
        }
    }
    let objects = fs::canonicalize(&objects).unwrap_or(objects);
    if !machine_core::guard::is_inside(guard.roots(), &objects) {
        return Err(failure(GitFailureReason::OutsideRoots, ""));
    }
    if let Some(alternates) =
        read_git_metadata_bytes(&objects.join("info/alternates"), guard.roots())?
    {
        for alternate in alternate_paths(&alternates) {
            if alternate.starts_with(b"\"") {
                return Err(failure(GitFailureReason::OutsideRoots, ""));
            }
            let alternate = PathBuf::from(std::ffi::OsStr::from_bytes(alternate));
            let path = if alternate.is_absolute() {
                alternate
            } else {
                objects.join(alternate)
            };
            let path = fs::canonicalize(&path).unwrap_or(path);
            if !machine_core::guard::is_inside(guard.roots(), &path) {
                return Err(failure(GitFailureReason::OutsideRoots, ""));
            }
        }
    }
    let rem = get(&["config", "--null", "--get-regexp", r"^remote\..*\.url$"]).await;
    if rem.timed_out || rem.bounded || rem.status.is_some_and(|c| c != 0 && c != 1) {
        return Err(process_failure(&rem));
    }
    let (branch, head) = if pinned {
        (None, None)
    } else {
        let br = get(&["symbolic-ref", "--short", "--quiet", "HEAD"]).await;
        let hd = get(&["rev-parse", "--verify", "HEAD"]).await;
        if br.timed_out || hd.timed_out || br.bounded || hd.bounded {
            return Err(process_failure(if br.timed_out || br.bounded {
                &br
            } else {
                &hd
            }));
        }
        (
            (br.status == Some(0)).then(|| line(&br)),
            (hd.status == Some(0)).then(|| line(&hd)),
        )
    };
    let main_worktree = if git_dir == common_dir {
        None
    } else {
        let wt = get(&["worktree", "list", "--porcelain", "-z"]).await;
        if !succeed(&wt) {
            return Err(process_failure(&wt));
        }
        let main = text(&wt.stdout)
            .split('\0')
            .find_map(|s| s.strip_prefix("worktree ").map(str::to_owned));
        if main
            .as_ref()
            .is_some_and(|p| !machine_core::guard::is_inside(guard.roots(), Path::new(p)))
        {
            return Err(failure(GitFailureReason::OutsideRoots, ""));
        }
        main
    };
    let worktree = fs::canonicalize(&worktree).unwrap_or_else(|_| PathBuf::from(&worktree));
    if !machine_core::guard::is_inside(guard.roots(), &worktree) {
        return Err(failure(GitFailureReason::OutsideRoots, ""));
    }
    Ok(Repository {
        worktree: worktree.to_string_lossy().into_owned(),
        git_dir,
        common_dir,
        main_worktree,
        remotes: parse_remotes(&text(&rem.stdout)),
        branch,
        head,
    })
}
fn status_fields(value: &str, fields: usize) -> Option<(String, String)> {
    let mut pos = 0;
    for _ in 0..fields {
        pos = value[pos..].find(' ')? + pos + 1;
    }
    Some((value[..2].to_owned(), value[pos..].to_owned()))
}
fn relative(root: &Path, path: &str) -> String {
    let p = Path::new(path);
    p.strip_prefix(root)
        .unwrap_or(p)
        .to_string_lossy()
        .into_owned()
}

struct ParsedStatus {
    counts: ChangeCounts,
    changes: Vec<Change>,
    omitted: u32,
    relative_path: String,
    upstream: Option<String>,
    head: Option<String>,
    branch_ab: Option<String>,
    branch: Option<String>,
}
#[allow(clippy::too_many_lines)]
fn parse_status(data: &str, max: usize, root: &Path, requested: &Path) -> ParsedStatus {
    let mut staged = 0;
    let mut unstaged = 0;
    let mut untracked: u32 = 0;
    let mut conflicted: u32 = 0;
    let mut changes = Vec::new();
    let mut omitted = 0;
    let mut head = None;
    let mut up = None;
    let mut branch = None;
    let mut branch_ab = None;
    let mut records = data.split('\0');
    while let Some(rec) = records.next() {
        if let Some(v) = rec.strip_prefix("# branch.oid ") {
            if v != "(initial)" {
                head = Some(v.to_owned());
            }
        } else if let Some(v) = rec.strip_prefix("# branch.head ") {
            branch = (v != "(detached)").then(|| v.to_owned());
        } else if let Some(v) = rec.strip_prefix("# branch.upstream ") {
            up = Some(v.to_owned());
        } else if let Some(v) = rec.strip_prefix("# branch.ab ") {
            branch_ab = Some(v.to_owned());
        } else if let Some(path) = rec.strip_prefix("? ") {
            untracked += 1;
            push_change(
                &mut changes,
                &mut omitted,
                max,
                Change {
                    status: "??".into(),
                    path: relative(root, path),
                    from: None,
                },
            );
        } else if let Some(v) = rec.strip_prefix("1 ") {
            if let Some((xy, p)) = status_fields(v, 7) {
                staged += usize::from(xy.as_bytes()[0] != b'.');
                unstaged += usize::from(xy.as_bytes()[1] != b'.');
                push_change(
                    &mut changes,
                    &mut omitted,
                    max,
                    Change {
                        status: xy.replace('.', " "),
                        path: relative(root, &p),
                        from: None,
                    },
                );
            }
        } else if let Some(v) = rec.strip_prefix("2 ") {
            if let Some((xy, p)) = status_fields(v, 8) {
                let from = records.next().unwrap_or("");
                staged += usize::from(xy.as_bytes()[0] != b'.');
                unstaged += usize::from(xy.as_bytes()[1] != b'.');
                push_change(
                    &mut changes,
                    &mut omitted,
                    max,
                    Change {
                        status: xy.replace('.', " "),
                        path: relative(root, &p),
                        from: Some(relative(root, from)),
                    },
                );
            }
        } else if let Some(v) = rec.strip_prefix("u ")
            && let Some((xy, p)) = status_fields(v, 9)
        {
            conflicted += 1;
            push_change(
                &mut changes,
                &mut omitted,
                max,
                Change {
                    status: xy,
                    path: relative(root, &p),
                    from: None,
                },
            );
        }
    }
    let rel = requested
        .strip_prefix(root)
        .unwrap_or_else(|_| Path::new(""));
    let rel = rel.to_string_lossy().into_owned();
    ParsedStatus {
        counts: ChangeCounts {
            staged: staged as u32,
            unstaged: unstaged as u32,
            untracked,
            conflicted,
        },
        changes,
        omitted,
        relative_path: rel,
        upstream: up,
        head,
        branch_ab,
        branch,
    }
}
fn push_change(out: &mut Vec<Change>, omitted: &mut u32, max: usize, change: Change) {
    if out.len() < max {
        out.push(change);
    } else {
        *omitted += 1;
    }
}
fn parse_worktrees(value: &str) -> Vec<Worktree> {
    let mut out = Vec::new();
    let (mut path, mut branch, mut head) = (None, None, None);
    let (mut locked, mut prunable) = (false, false);
    for field in value.split('\0') {
        if field.is_empty() {
            if let Some(path) = path.take() {
                out.push(Worktree {
                    path,
                    branch: branch.take(),
                    head: head.take(),
                    locked,
                    prunable,
                });
            }
            locked = false;
            prunable = false;
        } else if let Some(v) = field.strip_prefix("worktree ") {
            path = Some(v.to_owned());
        } else if let Some(v) = field.strip_prefix("branch ") {
            branch = Some(v.strip_prefix("refs/heads/").unwrap_or(v).to_owned());
        } else if let Some(v) = field.strip_prefix("HEAD ") {
            head = Some(v.to_owned());
        } else if field == "locked" || field.starts_with("locked ") {
            locked = true;
        } else if field == "prunable" || field.starts_with("prunable ") {
            prunable = true;
        }
    }
    if let Some(path) = path {
        out.push(Worktree {
            path,
            branch,
            head,
            locked,
            prunable,
        });
    }
    out
}
fn status_failure(error: GitFailure) -> Response<GetStatusResponse> {
    Response::new(GetStatusResponse {
        result: Some(StatusResult::Failure(error)),
    })
}
async fn detect_operation(dir: &Path, deadline: Instant) -> Result<Option<Operation>, GitFailure> {
    for name in [
        "MERGE_HEAD",
        "rebase-merge",
        "rebase-apply",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "BISECT_LOG",
    ] {
        let path = run_pinned(
            dir,
            &["rev-parse", "--path-format=absolute", "--git-path", name],
            deadline,
        )
        .await;
        if !succeed(&path) {
            return Err(process_failure(&path));
        }
        let state_dir = PathBuf::from(line(&path));
        if !state_dir.exists() {
            continue;
        }
        let kind = match name {
            "MERGE_HEAD" => OperationKind::Merge,
            "rebase-apply" if state_dir.join("applying").exists() => OperationKind::Am,
            "rebase-merge" | "rebase-apply" => OperationKind::Rebase,
            "CHERRY_PICK_HEAD" => OperationKind::CherryPick,
            "REVERT_HEAD" => OperationKind::Revert,
            _ => OperationKind::Bisect,
        };
        let (step, total) = match name {
            "rebase-merge" => (
                read_optional_git_text(&state_dir.join("msgnum"))?,
                read_optional_git_text(&state_dir.join("end"))?,
            ),
            "rebase-apply" if kind == OperationKind::Rebase => (
                read_optional_git_text(&state_dir.join("next"))?,
                read_optional_git_text(&state_dir.join("last"))?,
            ),
            _ => (None, None),
        };
        return Ok(Some(Operation {
            kind: kind as i32,
            step: step.and_then(|value| value.trim().parse().ok()),
            total: total.and_then(|value| value.trim().parse().ok()),
        }));
    }
    Ok(None)
}

async fn recent_commits(
    dir: &Path,
    head: Option<&str>,
    max_commits: u32,
    deadline: Instant,
) -> Result<Vec<Commit>, GitFailure> {
    let Some(head) = head.filter(|_| max_commits > 0) else {
        return Ok(Vec::new());
    };
    let count = max_commits.min(100);
    let limit = format!("-{count}");
    let output = run_pinned(
        dir,
        &["log", &limit, "--format=%H%x00%s%x00", head],
        deadline,
    )
    .await;
    if !succeed(&output) {
        return Err(process_failure(&output));
    }
    let mut commits = Vec::new();
    let log_text = text(&output.stdout);
    let mut fields = log_text.split('\0');
    while let Some(id) = fields.next() {
        if id.is_empty() {
            continue;
        }
        if let Some(subject) = fields.next() {
            commits.push(Commit {
                id: id.trim_start_matches('\n').to_owned(),
                subject: subject.trim_start_matches('\n').to_owned(),
            });
        }
    }
    Ok(commits)
}

async fn submodule_paths(
    dir: &Path,
    head: Option<&str>,
    deadline: Instant,
) -> Result<Vec<String>, GitFailure> {
    let Some(head) = head else {
        return Ok(Vec::new());
    };
    let spec = format!("{head}:.gitmodules");
    let exists = run_pinned(dir, &["cat-file", "-e", &spec], deadline).await;
    if !succeed(&exists) {
        if exists.timed_out || exists.bounded || exists.status.is_none() {
            return Err(process_failure(&exists));
        }
        if exists.status == Some(1) || text(&exists.stderr).contains("does not exist") {
            return Ok(Vec::new());
        }
        return Err(process_failure(&exists));
    }
    let paths = run_pinned(
        dir,
        &[
            "config",
            "--null",
            "--blob",
            &spec,
            "--no-includes",
            "--get-regexp",
            r"^submodule\..*\.path$",
        ],
        deadline,
    )
    .await;
    if paths.status == Some(1) && !paths.timed_out && !paths.bounded {
        return Ok(Vec::new());
    }
    if !succeed(&paths) {
        return Err(process_failure(&paths));
    }
    Ok(text(&paths.stdout)
        .split('\0')
        .filter_map(|record| record.split_once('\n').map(|(_, value)| value.to_owned()))
        .collect())
}

async fn upstream_status(
    dir: &Path,
    name: String,
    branch_ab: Option<&str>,
    deadline: Instant,
) -> Result<Upstream, GitFailure> {
    let reflog = run_pinned(
        dir,
        &[
            "reflog",
            "show",
            "-1",
            "--date=unix",
            "--format=%gd",
            &name,
            "--",
        ],
        deadline,
    )
    .await;
    if reflog.timed_out || reflog.bounded || reflog.status.is_none() {
        return Err(process_failure(&reflog));
    }
    let updated_at = line(&reflog)
        .rsplit_once("@{")
        .and_then(|(_, t)| t.strip_suffix('}'))
        .and_then(|s| s.parse::<i64>().ok())
        .map(|seconds| Timestamp { seconds, nanos: 0 });
    let Some(branch_ab) = branch_ab else {
        return Ok(Upstream {
            name,
            gone: true,
            ahead: None,
            behind: None,
            updated_at,
        });
    };
    let mut counts = branch_ab.split_whitespace();
    Ok(Upstream {
        name,
        gone: false,
        ahead: counts
            .next()
            .and_then(|value| value.trim_start_matches('+').parse().ok()),
        behind: counts
            .next()
            .and_then(|value| value.trim_start_matches('-').parse().ok()),
        updated_at,
    })
}
#[allow(clippy::too_many_lines)]
#[tonic::async_trait]
impl GitService for Git {
    async fn get_repository(
        &self,
        request: Request<GetRepositoryRequest>,
    ) -> Result<Response<GetRepositoryResponse>, RpcStatus> {
        let guard = self.context.guard();
        if option_like(&[&request.get_ref().path]) {
            return Ok(Response::new(GetRepositoryResponse {
                result: Some(RepoResult::Failure(invalid(
                    "caller values must not start with '-'",
                ))),
            }));
        }
        let path = guard.resolve(&request.get_ref().path)?;
        let entry = nearest_git(&path.canonical, guard.roots());
        let result = if let Some(entry) = entry {
            if let Err(error) = checked_git_data(&entry, guard.roots()) {
                RepoResult::Failure(error)
            } else {
                let dir = entry.parent().unwrap_or(&entry);
                match repository(dir, &guard, false, Instant::now() + DEFAULT_TIMEOUT).await {
                    Ok(repo) => RepoResult::Repository(repo),
                    Err(error) => RepoResult::Failure(error),
                }
            }
        } else {
            RepoResult::Failure(failure(GitFailureReason::NotARepository, ""))
        };
        Ok(Response::new(GetRepositoryResponse {
            result: Some(result),
        }))
    }
    async fn locate_repository(
        &self,
        request: Request<LocateRepositoryRequest>,
    ) -> Result<Response<LocateRepositoryResponse>, RpcStatus> {
        if option_like(&[&request.get_ref().path]) {
            return Ok(Response::new(LocateRepositoryResponse {
                result: Some(LocateResult::Failure(invalid(
                    "caller values must not start with '-'",
                ))),
            }));
        }
        let guard = self.context.guard();
        let path = guard.resolve(&request.get_ref().path)?;
        let result = if !path.canonical.is_dir() {
            LocateResult::Failure(failure(GitFailureReason::RootMissing, ""))
        } else if let Some(entry) = nearest_git(&path.canonical, guard.roots()) {
            LocateResult::GitEntry(entry.to_string_lossy().into_owned())
        } else {
            LocateResult::Failure(failure(GitFailureReason::NoRepositoryInRoot, ""))
        };
        Ok(Response::new(LocateRepositoryResponse {
            result: Some(result),
        }))
    }
    #[allow(clippy::if_not_else)]
    async fn get_status(
        &self,
        request: Request<GetStatusRequest>,
    ) -> Result<Response<GetStatusResponse>, RpcStatus> {
        let input = request.into_inner();
        if option_like(&[&input.path, &input.git_entry]) {
            return Ok(Response::new(GetStatusResponse {
                result: Some(StatusResult::Failure(invalid(
                    "caller values must not start with '-'",
                ))),
            }));
        }
        let guard = self.context.guard();
        let path = guard.resolve(&input.path)?;
        let max = if input.max_entries == 0 {
            100
        } else {
            input.max_entries as usize
        };
        if max > 1000 {
            return Ok(Response::new(GetStatusResponse {
                result: Some(StatusResult::Failure(invalid(
                    "max_entries must be from 0 to 1000",
                ))),
            }));
        }
        if input.submodules != SubmoduleMode::Unspecified as i32
            && input.submodules != SubmoduleMode::Skip as i32
            && input.submodules != SubmoduleMode::Check as i32
        {
            return Ok(Response::new(GetStatusResponse {
                result: Some(StatusResult::Failure(invalid("invalid submodule mode"))),
            }));
        }
        if !path.canonical.is_dir() {
            return Ok(Response::new(GetStatusResponse {
                result: Some(StatusResult::Failure(failure(
                    GitFailureReason::RootMissing,
                    "",
                ))),
            }));
        }
        let entry = nearest_git(&path.canonical, guard.roots());
        if let Some(entry) = entry.as_ref() {
            if input.git_entry.is_empty() || Path::new(&input.git_entry) != entry {
                return Ok(Response::new(GetStatusResponse {
                    result: Some(StatusResult::Failure(failure(
                        GitFailureReason::EntryChanged,
                        "",
                    ))),
                }));
            }
            if let Err(error) = checked_git_data(entry, guard.roots()) {
                return Ok(Response::new(GetStatusResponse {
                    result: Some(StatusResult::Failure(error)),
                }));
            }
        }
        let result = if let Some(entry) = entry {
            let dir = entry.parent().unwrap_or(&entry);
            let deadline = Instant::now() + DEFAULT_TIMEOUT;
            match repository(dir, &guard, true, deadline).await {
                Err(e) => StatusResult::Failure(e),
                Ok(mut repo) => {
                    let ignore = if input.submodules == SubmoduleMode::Check as i32 {
                        "--ignore-submodules=none"
                    } else {
                        "--ignore-submodules=all"
                    };
                    let out = run_pinned(
                        dir,
                        &[
                            "status",
                            "--porcelain=v2",
                            "--branch",
                            "-z",
                            "--untracked-files=normal",
                            ignore,
                        ],
                        deadline,
                    )
                    .await;
                    if !succeed(&out) {
                        StatusResult::Failure(process_failure(&out))
                    } else {
                        let status_text = text(&out.stdout);
                        let ParsedStatus {
                            counts,
                            changes,
                            omitted,
                            relative_path,
                            upstream: up,
                            head,
                            branch_ab,
                            branch,
                        } = parse_status(
                            &status_text,
                            max,
                            Path::new(&repo.worktree),
                            &path.canonical,
                        );
                        repo.head.clone_from(&head);
                        repo.branch = branch;
                        let upstream = if let Some(name) = up.filter(|name| !name.starts_with('-'))
                        {
                            match upstream_status(dir, name, branch_ab.as_deref(), deadline).await {
                                Ok(upstream) => Some(upstream),
                                Err(error) => return Ok(status_failure(error)),
                            }
                        } else {
                            None
                        };
                        let operation = match detect_operation(dir, deadline).await {
                            Ok(operation) => operation,
                            Err(error) => return Ok(status_failure(error)),
                        };
                        let commits =
                            match recent_commits(dir, head.as_deref(), input.max_commits, deadline)
                                .await
                            {
                                Ok(commits) => commits,
                                Err(error) => return Ok(status_failure(error)),
                            };
                        let submodules = match submodule_paths(dir, head.as_deref(), deadline).await
                        {
                            Ok(paths) => paths,
                            Err(error) => return Ok(status_failure(error)),
                        };
                        StatusResult::Status(Status {
                            repository: Some(repo),
                            relative_path,
                            upstream,
                            operation,
                            counts: Some(counts),
                            changes,
                            omitted,
                            submodules,
                            commits,
                        })
                    }
                }
            }
        } else {
            StatusResult::Failure(failure(
                if input.git_entry.is_empty() {
                    GitFailureReason::NotARepository
                } else {
                    GitFailureReason::EntryChanged
                },
                "",
            ))
        };
        Ok(Response::new(GetStatusResponse {
            result: Some(result),
        }))
    }
    async fn create_worktree(
        &self,
        request: Request<CreateWorktreeRequest>,
    ) -> Result<Response<CreateWorktreeResponse>, RpcStatus> {
        let input = request.into_inner();
        if option_like(&[
            &input.repository,
            &input.branch,
            input.base.as_deref().unwrap_or(""),
            &input.path,
        ]) {
            return Ok(Response::new(CreateWorktreeResponse {
                result: Some(CreateResult::Failure(invalid(
                    "caller values must not start with '-'",
                ))),
            }));
        }
        let guard = self.context.guard();
        let source = guard.resolve(&input.repository)?;
        let directory = guard.resolve(&input.path)?;
        if !validate_branch(&input.branch) {
            return Ok(Response::new(CreateWorktreeResponse {
                result: Some(CreateResult::Failure(invalid(
                    "branch must be a valid git branch name",
                ))),
            }));
        }
        let branch = input.branch;
        let base = input.base;
        let src = source.canonical;
        let dst = directory.canonical.clone();
        let cache_guard = guard.clone();
        let cache_branch = branch.clone();
        let result = self
            .create_cache
            .run(&input.request_id, || async move {
                let Some(entry) = nearest_git(&src, cache_guard.roots()) else {
                    return Err(failure(GitFailureReason::NotARepository, ""));
                };
                checked_git_data(&entry, cache_guard.roots())?;
                let deadline = Instant::now() + Duration::from_secs(120);
                let mut args = vec![
                    "worktree",
                    "add",
                    "--no-track",
                    "-b",
                    cache_branch.as_str(),
                    "--end-of-options",
                ];
                let dest = dst.to_string_lossy().into_owned();
                args.push(&dest);
                if let Some(ref b) = base {
                    args.push(b);
                }
                let out = run(&src, &args, deadline).await;
                if !succeed(&out) {
                    return Err(process_failure(&out));
                }
                let hd = run(
                    &src,
                    &["-C", &dest, "rev-parse", "--verify", "HEAD"],
                    deadline,
                )
                .await;
                Ok(Worktree {
                    path: dest,
                    branch: Some(cache_branch),
                    head: succeed(&hd).then(|| line(&hd)),
                    locked: false,
                    prunable: false,
                })
            })
            .await
            .map_err(|_| RpcStatus::internal("idempotent work panicked"))?;
        if result.is_ok() {
            guard.verify_unchanged(&directory)?;
        }
        let result = match result {
            Ok(mut w) => {
                w.path = root_result(&guard, w.path)?;
                CreateResult::Worktree(w)
            }
            Err(e) => CreateResult::Failure(e),
        };
        Ok(Response::new(CreateWorktreeResponse {
            result: Some(result),
        }))
    }
    #[allow(clippy::if_not_else)]
    async fn list_worktrees(
        &self,
        request: Request<ListWorktreesRequest>,
    ) -> Result<Response<ListWorktreesResponse>, RpcStatus> {
        if option_like(&[&request.get_ref().repository]) {
            return Ok(Response::new(ListWorktreesResponse {
                result: Some(ListResult::Failure(invalid(
                    "caller values must not start with '-'",
                ))),
            }));
        }
        let guard = self.context.guard();
        let source = guard.resolve(&request.get_ref().repository)?;
        let Some(entry) = nearest_git(&source.canonical, guard.roots()) else {
            return Ok(Response::new(ListWorktreesResponse {
                result: Some(ListResult::Failure(failure(
                    GitFailureReason::NotARepository,
                    "",
                ))),
            }));
        };
        if let Err(error) = checked_git_data(&entry, guard.roots()) {
            return Ok(Response::new(ListWorktreesResponse {
                result: Some(ListResult::Failure(error)),
            }));
        }
        let out = run(
            &source.canonical,
            &["worktree", "list", "--porcelain", "-z"],
            Instant::now() + DEFAULT_TIMEOUT,
        )
        .await;
        let result = if !succeed(&out) {
            ListResult::Failure(process_failure(&out))
        } else {
            let mut worktrees = Vec::new();
            let mut fail = None;
            let worktree_text = text(&out.stdout);
            for mut w in parse_worktrees(worktree_text.as_ref()) {
                match root_result(&guard, w.path) {
                    Ok(p) => {
                        w.path = p;
                        worktrees.push(w);
                    }
                    Err(e) => {
                        fail = Some(e);
                        break;
                    }
                }
            }
            if let Some(e) = fail {
                return Err(e);
            }
            ListResult::Worktrees(Worktrees { worktrees })
        };
        Ok(Response::new(ListWorktreesResponse {
            result: Some(result),
        }))
    }
    async fn delete_worktree(
        &self,
        request: Request<DeleteWorktreeRequest>,
    ) -> Result<Response<DeleteWorktreeResponse>, RpcStatus> {
        let input = request.into_inner();
        if option_like(&[&input.path]) {
            return Ok(Response::new(DeleteWorktreeResponse {
                result: Some(DeleteResult::Failure(invalid(
                    "caller values must not start with '-'",
                ))),
            }));
        }
        let guard = self.context.guard();
        let path = guard.resolve(&input.path)?;
        let roots = guard.roots().to_vec();
        let p = path.canonical.clone();
        let result = self
            .delete_cache
            .run(&input.request_id, || async move {
                let Some(entry) = nearest_git(&p, &roots) else {
                    return Err(failure(GitFailureReason::NotARepository, ""));
                };
                checked_git_data(&entry, &roots)?;
                let value = p.to_string_lossy().into_owned();
                let out = run(
                    &p,
                    &["worktree", "remove", "--end-of-options", &value],
                    Instant::now() + Duration::from_secs(120),
                )
                .await;
                if succeed(&out) {
                    Ok(())
                } else {
                    Err(process_failure(&out))
                }
            })
            .await
            .map_err(|_| RpcStatus::internal("idempotent work panicked"))?;
        if result.is_ok() {
            guard.verify_unchanged(&path)?;
        }
        Ok(Response::new(DeleteWorktreeResponse {
            result: Some(match result {
                Ok(()) => DeleteResult::Deleted(machine_protocol::v1::Deleted {}),
                Err(e) => DeleteResult::Failure(e),
            }),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        os::unix::{ffi::OsStringExt, fs::PermissionsExt},
        sync::Arc,
    };

    static PATH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    async fn assert_alternate_refused_before_git(alternate: impl FnOnce(&Path) -> Vec<u8> + Send) {
        let _path_lock = PATH_LOCK.lock().await;
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        let repository = root.join("repository");
        let objects = repository.join(".git/objects");
        fs::create_dir_all(objects.join("info")).unwrap();
        fs::write(objects.join("info/alternates"), alternate(&root)).unwrap();

        let config_dir = temp.path().join("config");
        fs::create_dir_all(&config_dir).unwrap();
        let config_file = config_dir.join("config.toml");
        fs::write(&config_file, format!("roots = [\"{}\"]\n", root.display())).unwrap();
        let config = machine_core::ConfigHandle::open(config_file).unwrap();
        let context = Context {
            config: Arc::new(config),
            state_dir: temp.path().join("state"),
        };
        let git = Git {
            context,
            create_cache: IdempotencyCache::default(),
            delete_cache: IdempotencyCache::default(),
        };

        let bin = temp.path().join("bin");
        fs::create_dir_all(&bin).unwrap();
        let marker = temp.path().join("git-started");
        let shim = bin.join("git");
        fs::write(
            &shim,
            format!("#!/bin/sh\n: > '{}'\nexit 99\n", marker.display()),
        )
        .unwrap();
        fs::set_permissions(&shim, fs::Permissions::from_mode(0o755)).unwrap();
        *GIT_PATH_OVERRIDE.lock().unwrap() = Some(bin);
        let response = git
            .get_repository(Request::new(GetRepositoryRequest {
                path: repository.to_string_lossy().into_owned(),
            }))
            .await
            .unwrap()
            .into_inner();
        *GIT_PATH_OVERRIDE.lock().unwrap() = None;

        let Some(RepoResult::Failure(error)) = response.result else {
            panic!("expected repository refusal");
        };
        assert_eq!(error.reason, GitFailureReason::OutsideRoots as i32);
        assert!(!marker.exists(), "git shim must not start");
    }

    #[tokio::test]
    async fn crlf_object_alternate_outside_roots_is_refused_before_git() {
        assert_alternate_refused_before_git(|root| format!("{}\r\n", root.display()).into_bytes())
            .await;
    }

    #[tokio::test]
    async fn nul_truncated_object_alternate_outside_roots_is_refused_before_git() {
        assert_alternate_refused_before_git(|root| {
            let outside = root.parent().unwrap().join("outside");
            fs::create_dir_all(&outside).unwrap();
            format!("{}/../outside\0/ignored\n", root.display()).into_bytes()
        })
        .await;
    }

    #[tokio::test]
    async fn non_utf8_object_alternate_outside_roots_is_refused_before_git() {
        assert_alternate_refused_before_git(|root| {
            let outside = root
                .parent()
                .unwrap()
                .join(std::ffi::OsString::from_vec(b"outside-\xff".to_vec()));
            fs::create_dir_all(&outside).unwrap();
            let mut bytes = outside.as_os_str().as_bytes().to_vec();
            bytes.push(b'\n');
            bytes
        })
        .await;
    }

    #[test]
    fn branch_ab_parser_ignores_rename_source_named_like_header() {
        let root = Path::new("/repo");
        let data = concat!(
            "# branch.oid abc123\0",
            "# branch.head main\0",
            "# branch.upstream origin/main\0",
            "2 R. N... 100644 100644 100644 old new R100 file\0",
            "# branch.ab +4 -2\0",
        );
        let parsed = parse_status(data, 10, root, root);
        let head = parsed.head;
        let branch_ab = parsed.branch_ab;
        let branch = parsed.branch;
        assert_eq!(head.as_deref(), Some("abc123"));
        assert_eq!(branch_ab, None);
        assert_eq!(branch.as_deref(), Some("main"));
    }

    #[test]
    fn metadata_reader_rejects_fifo_without_blocking() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("metadata");
        assert!(
            std::process::Command::new("mkfifo")
                .arg(&path)
                .status()
                .unwrap()
                .success()
        );
        assert!(read_regular_bytes(&path).is_err());
    }
}
