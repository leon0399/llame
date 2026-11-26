#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::wildcard_enum_match_arm,
    clippy::too_many_lines
)]

mod common;

use machine_protocol::v1::{
    CreateWorktreeRequest, DeleteWorktreeRequest, GetRepositoryRequest, GetStatusRequest,
    GitFailureReason, ListWorktreesRequest, LocateRepositoryRequest, OperationKind, SubmoduleMode,
    create_worktree_response, delete_worktree_response, get_repository_response,
    get_status_response, git_service_client::GitServiceClient, list_worktrees_response,
    locate_repository_response,
};
use std::{
    ffi::OsString,
    os::unix::{ffi::OsStringExt, fs::PermissionsExt},
    path::Path,
    process::Command,
};

fn git_shim(machine: &common::Machine) -> (std::path::PathBuf, std::path::PathBuf) {
    let bin = machine.home.path().join("shim");
    std::fs::create_dir_all(&bin).unwrap();
    let marker = machine.home.path().join("git-started");
    let script = format!(
        "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'git version 2.39.0'; exit 0; fi\nprintf 'called: %s\\n' \"$*\" >> '{}'\nexit 1\n",
        marker.display()
    );
    let path = bin.join("git");
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    (bin, marker)
}

fn pipe_leaking_git_shim(machine: &common::Machine) -> std::path::PathBuf {
    let bin = machine.home.path().join("pipe-shim");
    std::fs::create_dir_all(&bin).unwrap();
    let path = bin.join("git");
    let real_path = std::env::var_os("PATH").unwrap();
    let find_executable = |name: &str| {
        std::env::split_paths(&real_path)
            .map(|directory| directory.join(name))
            .find(|path| path.is_file())
            .unwrap()
    };
    let real_git = find_executable("git");
    let sleep = find_executable("sleep");
    std::fs::write(
        &path,
        format!(
            "#!/bin/sh\ncase \" $* \" in *' --show-toplevel '*) '{}' \"$@\"; '{}' 30 & exit 0;; esac\nexec '{}' \"$@\"\n",
            real_git.display(),
            sleep.display(),
            real_git.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

fn failing_git_log_shim(machine: &common::Machine) -> std::path::PathBuf {
    let bin = machine.home.path().join("log-shim");
    std::fs::create_dir_all(&bin).unwrap();
    let real_git = std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|directory| directory.join("git"))
        .find(|path| path.is_file())
        .unwrap();
    let path = bin.join("git");
    std::fs::write(
        &path,
        format!(
            "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'git version 2.39.0'; exit 0; fi\ncase \" $* \" in *' log '*) exit 1;; esac\nexec '{}' \"$@\"\n",
            real_git.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

fn failing_git_head_shim(machine: &common::Machine) -> std::path::PathBuf {
    let bin = machine.home.path().join("head-shim");
    std::fs::create_dir_all(&bin).unwrap();
    let real_git = std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|directory| directory.join("git"))
        .find(|path| path.is_file())
        .unwrap();
    let path = bin.join("git");
    std::fs::write(
        &path,
        format!(
            "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'git version 2.39.0'; exit 0; fi\ncase \" $* \" in *' rev-parse --verify HEAD '*) exit 1;; esac\nexec '{}' \"$@\"\n",
            real_git.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

fn fixture_git() -> Command {
    let mut command = Command::new("git");
    for name in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        command.env_remove(name);
    }
    command
}
fn git(directory: &Path, args: &[&str]) -> String {
    let output = fixture_git()
        .arg("-C")
        .arg(directory)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {:?}: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}
fn repository(path: &Path) {
    std::fs::create_dir_all(path).unwrap();
    let output = fixture_git()
        .args(["init", "-q"])
        .arg(path)
        .output()
        .unwrap();
    assert!(output.status.success());
    git(path, &["config", "user.name", "Test User"]);
    git(path, &["config", "user.email", "test@example.invalid"]);
    std::fs::write(path.join("tracked.txt"), "initial\n").unwrap();
    git(path, &["add", "tracked.txt"]);
    git(path, &["commit", "-m", "initial"]);
}
fn absolute(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[tokio::test]
async fn repository_status_detached_and_not_a_repository() {
    let machine = common::Machine::new();
    let root = machine.root();
    let repo = root.join("repo");
    repository(&repo);
    git(
        &repo,
        &[
            "remote",
            "add",
            "origin",
            "https://token:secret@example.invalid/owner/repo.git",
        ],
    );
    std::fs::write(repo.join("tracked.txt"), "changed\n").unwrap();
    std::fs::write(repo.join("new.txt"), "new\n").unwrap();
    let (mut child, channel) = machine.attach().await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .get_repository(GetRepositoryRequest {
            path: absolute(&repo),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_repository_response::Result::Repository(facts)) = response.result else {
        panic!("repository facts missing")
    };
    assert_eq!(facts.remotes.len(), 1);
    assert_eq!(
        facts.remotes[0].url,
        "https://example.invalid/owner/repo.git"
    );
    assert!(!format!("{facts:?}").contains("secret"));
    assert_eq!(facts.worktree, absolute(&repo));
    assert_eq!(facts.git_dir, absolute(&repo.join(".git")));
    assert_eq!(facts.common_dir, facts.git_dir);
    assert!(facts.branch.is_some());
    assert!(facts.head.is_some());
    let response = client
        .get_status(GetStatusRequest {
            path: absolute(&repo),
            git_entry: absolute(&repo.join(".git")),
            max_entries: 1,
            submodules: SubmoduleMode::Skip as i32,
            max_commits: 2,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_status_response::Result::Status(status)) = response.result else {
        panic!("status missing")
    };
    assert_eq!(
        status.repository.as_ref().unwrap().remotes[0].url,
        "https://example.invalid/owner/repo.git"
    );
    assert!(!format!("{status:?}").contains("secret"));
    assert_eq!(status.counts.as_ref().unwrap().unstaged, 1);
    assert_eq!(status.counts.as_ref().unwrap().untracked, 1);
    assert_eq!(status.changes.len(), 1);
    assert_eq!(status.omitted, 1);
    assert_eq!(status.commits.len(), 1);
    git(&repo, &["checkout", "--detach", "-q", "HEAD"]);
    let response = client
        .get_repository(GetRepositoryRequest {
            path: absolute(&repo),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_repository_response::Result::Repository(detached)) = response.result else {
        panic!("detached facts missing")
    };
    assert!(detached.branch.is_none());
    assert!(detached.head.is_some());
    let empty = root.join("empty");
    std::fs::create_dir(&empty).unwrap();
    let response = client
        .get_repository(GetRepositoryRequest {
            path: absolute(&empty),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_repository_response::Result::Failure(e)) = response.result else {
        panic!("not-a-repository failure missing")
    };
    assert_eq!(e.reason, GitFailureReason::NotARepository as i32);
    child.kill().await.unwrap();
}

#[tokio::test]
async fn status_counts_non_utf8_filenames_as_changes() {
    let machine = common::Machine::new();
    let repo = machine.root().join("repo");
    repository(&repo);
    let filename = OsString::from_vec(b"untracked-\xff".to_vec());
    std::fs::write(repo.join(filename), "contents").unwrap();
    std::fs::write(repo.join("literal\\name"), "contents").unwrap();
    let (mut child, channel) = machine.attach().await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .get_status(GetStatusRequest {
            path: absolute(&repo),
            git_entry: absolute(&repo.join(".git")),
            max_entries: 10,
            submodules: SubmoduleMode::Skip as i32,
            max_commits: 0,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_status_response::Result::Status(status)) = response.result else {
        panic!("status failed for non-UTF-8 filename")
    };
    assert_eq!(status.counts.as_ref().unwrap().untracked, 2);
    assert_eq!(status.changes.len(), 2);
    assert!(
        status
            .changes
            .iter()
            .any(|change| change.path == "literal\\name")
    );
    child.kill().await.unwrap();
}

#[tokio::test]
async fn status_reports_interrupted_am_as_am() {
    let machine = common::Machine::new();
    let repo = machine.root().join("repo");
    repository(&repo);
    let state = repo.join(".git/rebase-apply");
    std::fs::create_dir_all(&state).unwrap();
    std::fs::write(state.join("applying"), "").unwrap();
    let (mut child, channel) = machine.attach().await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .get_status(GetStatusRequest {
            path: absolute(&repo),
            git_entry: absolute(&repo.join(".git")),
            max_entries: 10,
            submodules: SubmoduleMode::Skip as i32,
            max_commits: 0,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_status_response::Result::Status(status)) = response.result else {
        panic!("status failed for interrupted am")
    };
    assert_eq!(status.operation.unwrap().kind, OperationKind::Am as i32);
    child.kill().await.unwrap();
}

#[tokio::test]
async fn git_reader_wait_obeys_the_request_deadline() {
    let machine = common::Machine::new();
    let repo = machine.root().join("repo");
    repository(&repo);
    let shim = pipe_leaking_git_shim(&machine);
    let (mut child, channel) = machine.attach_with_path(Some(&shim)).await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .get_repository(GetRepositoryRequest {
            path: absolute(&repo),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_repository_response::Result::Failure(failure)) = response.result else {
        panic!("a pipe-leaking Git child was accepted as a repository")
    };
    assert_eq!(failure.reason, GitFailureReason::TimedOut as i32);
    child.kill().await.unwrap();
}

#[tokio::test]
async fn status_returns_failure_when_commit_query_fails() {
    let machine = common::Machine::new();
    let repo = machine.root().join("repo");
    repository(&repo);
    let shim = failing_git_log_shim(&machine);
    let (mut child, channel) = machine.attach_with_path(Some(&shim)).await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .get_status(GetStatusRequest {
            path: absolute(&repo),
            git_entry: absolute(&repo.join(".git")),
            max_entries: 10,
            submodules: SubmoduleMode::Skip as i32,
            max_commits: 1,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_status_response::Result::Failure(failure)) = response.result else {
        panic!("a failed commit query was reported as a successful status")
    };
    assert_eq!(failure.reason, GitFailureReason::GitFailed as i32);
    child.kill().await.unwrap();
}

#[tokio::test]
async fn upstream_ahead_and_behind_are_reported() {
    let machine = common::Machine::new();
    let root = machine.root();
    let bare = root.join("remote.git");
    let output = fixture_git()
        .args(["init", "--bare", "-q"])
        .arg(&bare)
        .output()
        .unwrap();
    assert!(output.status.success());
    let repo = root.join("repo");
    repository(&repo);
    git(&repo, &["remote", "add", "origin", &absolute(&bare)]);
    git(&repo, &["push", "-u", "origin", "HEAD"]);
    std::fs::write(repo.join("local.txt"), "local").unwrap();
    git(&repo, &["add", "local.txt"]);
    git(&repo, &["commit", "-m", "local"]);
    let other = root.join("other");
    let out = fixture_git()
        .args(["clone", "-q"])
        .arg(&bare)
        .arg(&other)
        .output()
        .unwrap();
    assert!(out.status.success());
    git(&other, &["config", "user.name", "Test User"]);
    git(&other, &["config", "user.email", "test@example.invalid"]);
    std::fs::write(other.join("remote.txt"), "remote").unwrap();
    git(&other, &["add", "remote.txt"]);
    git(&other, &["commit", "-m", "remote"]);
    git(&other, &["push"]);
    git(&repo, &["fetch"]);
    let (mut machine_child, channel) = machine.attach().await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .get_status(GetStatusRequest {
            path: absolute(&repo),
            git_entry: absolute(&repo.join(".git")),
            max_entries: 0,
            submodules: SubmoduleMode::Skip as i32,
            max_commits: 0,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_status_response::Result::Status(status)) = response.result else {
        panic!("status missing")
    };
    let upstream = status.upstream.unwrap();
    assert!(!upstream.gone);
    assert_eq!(upstream.ahead, Some(1));
    assert_eq!(upstream.behind, Some(1));
    drop(client);
    machine_child.kill().await.unwrap();
}

#[tokio::test]
async fn worktree_create_list_delete_and_invalid_branch() {
    let machine = common::Machine::new();
    let root = machine.root();
    let repo = root.join("repo");
    repository(&repo);
    let path = root.join("linked");
    let (mut child, channel) = machine.attach().await;
    let mut client = GitServiceClient::new(channel);
    let invalid = client
        .create_worktree(CreateWorktreeRequest {
            request_id: "bad".into(),
            repository: absolute(&repo),
            branch: "../invalid".into(),
            base: None,
            path: absolute(&path),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(create_worktree_response::Result::Failure(e)) = invalid.result else {
        panic!("invalid branch accepted")
    };
    assert_eq!(e.reason, GitFailureReason::InvalidInput as i32);
    let response = client
        .create_worktree(CreateWorktreeRequest {
            request_id: "create-1".into(),
            repository: absolute(&repo),
            branch: "feature/test".into(),
            base: None,
            path: absolute(&path),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(create_worktree_response::Result::Worktree(w)) = response.result else {
        panic!("worktree creation failed")
    };
    assert_eq!(w.path, absolute(&path));
    let moved_repo = root.join("repo-moved");
    std::fs::rename(&repo, &moved_repo).unwrap();
    let replay = client
        .create_worktree(CreateWorktreeRequest {
            request_id: "create-1".into(),
            repository: absolute(&repo),
            branch: "feature/test".into(),
            base: None,
            path: absolute(&path),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(create_worktree_response::Result::Worktree(replayed)) = replay.result else {
        panic!("replayed create failed after source repository moved")
    };
    assert_eq!(replayed.path, absolute(&path));
    std::fs::rename(moved_repo, &repo).unwrap();
    let response = client
        .list_worktrees(ListWorktreesRequest {
            repository: absolute(&repo),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(list_worktrees_response::Result::Worktrees(wts)) = response.result else {
        panic!("worktree list failed")
    };
    assert_eq!(wts.worktrees.len(), 2);
    let response = client
        .delete_worktree(DeleteWorktreeRequest {
            request_id: "delete-1".into(),
            path: absolute(&path),
        })
        .await
        .unwrap()
        .into_inner();
    assert!(matches!(
        response.result,
        Some(delete_worktree_response::Result::Deleted(_))
    ));
    let replay = client
        .delete_worktree(DeleteWorktreeRequest {
            request_id: "delete-1".into(),
            path: absolute(&path),
        })
        .await
        .unwrap()
        .into_inner();
    assert!(matches!(
        replay.result,
        Some(delete_worktree_response::Result::Deleted(_))
    ));
    child.kill().await.unwrap();
}

#[tokio::test]
async fn create_returns_worktree_when_followup_head_query_fails() {
    let machine = common::Machine::new();
    let root = machine.root();
    let repo = root.join("repo");
    repository(&repo);
    let path = root.join("linked");
    let shim = failing_git_head_shim(&machine);
    let (mut child, channel) = machine.attach_with_path(Some(&shim)).await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .create_worktree(CreateWorktreeRequest {
            request_id: "create-head-fails".into(),
            repository: absolute(&repo),
            branch: "feature/head-query".into(),
            base: None,
            path: absolute(&path),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(create_worktree_response::Result::Worktree(worktree)) = response.result else {
        panic!("created worktree was not returned after HEAD query failed")
    };
    assert_eq!(worktree.path, absolute(&path));
    assert!(worktree.head.is_none());
    assert!(path.is_dir());
    child.kill().await.unwrap();
}

#[tokio::test]
async fn gitdir_outside_root_is_refused() {
    let machine = common::Machine::new();
    let root = machine.root();
    let outside_temp = tempfile::tempdir().unwrap();
    let external = outside_temp.path().to_path_buf();
    let source = external.join("source");
    let git_dir = external.join("linked.git");
    repository(&source);
    let repo = root.join("linked");
    let out = fixture_git()
        .args(["clone", "-q", "--separate-git-dir"])
        .arg(&git_dir)
        .arg(&source)
        .arg(&repo)
        .output()
        .unwrap();
    assert!(out.status.success());
    let (shim, marker) = git_shim(&machine);
    let (_child, channel) = machine.attach_with_path(Some(&shim)).await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .get_repository(GetRepositoryRequest {
            path: absolute(&repo),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_repository_response::Result::Failure(e)) = response.result else {
        panic!("external gitdir accepted")
    };
    assert_eq!(e.reason, GitFailureReason::OutsideRoots as i32);
    assert!(
        !marker.exists(),
        "git process started before outside-root refusal"
    );
}

#[tokio::test]
async fn common_directory_outside_roots_is_refused_before_git() {
    let machine = common::Machine::new();
    let root = machine.root();
    let repo = root.join("repo");
    repository(&repo);
    let outside_temp = tempfile::tempdir().unwrap();
    let external = outside_temp.path().to_path_buf();
    std::fs::write(repo.join(".git/commondir"), absolute(&external)).unwrap();
    let (shim, marker) = git_shim(&machine);
    let (_child, channel) = machine.attach_with_path(Some(&shim)).await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .get_repository(GetRepositoryRequest {
            path: absolute(&repo),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_repository_response::Result::Failure(failure)) = response.result else {
        panic!("external common directory was accepted")
    };
    assert_eq!(failure.reason, GitFailureReason::OutsideRoots as i32);
    assert!(!marker.exists(), "git started before common-dir refusal");
}

#[tokio::test]
async fn object_alternate_outside_roots_is_refused_before_git() {
    let machine = common::Machine::new();
    let root = machine.root();
    let repo = root.join("repo");
    repository(&repo);
    let outside_temp = tempfile::tempdir().unwrap();
    let external = outside_temp.path().to_path_buf();
    let alternates = repo.join(".git/objects/info/alternates");
    std::fs::create_dir_all(alternates.parent().unwrap()).unwrap();
    std::fs::write(&alternates, format!("\"{}\"", absolute(&external))).unwrap();
    let (shim, marker) = git_shim(&machine);
    let (_child, channel) = machine.attach_with_path(Some(&shim)).await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .get_repository(GetRepositoryRequest {
            path: absolute(&repo),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_repository_response::Result::Failure(failure)) = response.result else {
        panic!("external object alternate was accepted")
    };
    assert_eq!(failure.reason, GitFailureReason::OutsideRoots as i32);
    assert!(!marker.exists(), "git started before alternate refusal");
}
#[tokio::test]
async fn locate_repository_is_bounded_and_does_not_start_git() {
    let machine = common::Machine::new();
    repository(machine.home.path());
    let local_repo = machine.root().join("local-repo");
    repository(&local_repo);
    let inside = machine.root().join("inside");
    std::fs::create_dir_all(&inside).unwrap();
    let file = inside.join("file");
    std::fs::write(&file, "data").unwrap();
    let (shim, marker) = git_shim(&machine);
    let (_child, channel) = machine.attach_with_path(Some(&shim)).await;
    let mut client = GitServiceClient::new(channel);
    let absent = client
        .locate_repository(LocateRepositoryRequest {
            path: absolute(&inside),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(locate_repository_response::Result::Failure(failure)) = absent.result else {
        panic!("repository above the registered root was found")
    };
    assert_eq!(failure.reason, GitFailureReason::NoRepositoryInRoot as i32);
    let found = client
        .locate_repository(LocateRepositoryRequest {
            path: absolute(&local_repo),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(locate_repository_response::Result::GitEntry(entry)) = found.result else {
        panic!("repository entry was not found")
    };
    assert_eq!(entry, absolute(&local_repo.join(".git")));
    let missing = client
        .locate_repository(LocateRepositoryRequest {
            path: absolute(&file),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(locate_repository_response::Result::Failure(failure)) = missing.result else {
        panic!("file path was accepted as a directory")
    };
    assert_eq!(failure.reason, GitFailureReason::RootMissing as i32);
    assert!(
        !marker.exists(),
        "locate started git: {}",
        std::fs::read_to_string(&marker).unwrap_or_default()
    );
}

#[tokio::test]
async fn status_refuses_changed_admitted_git_entry_without_git() {
    let machine = common::Machine::new();
    let root = machine.root();
    let repo = root.join("repo");
    repository(&repo);
    let admitted = absolute(&repo.join(".git"));
    std::fs::remove_dir_all(repo.join(".git")).unwrap();
    let (shim, marker) = git_shim(&machine);
    let (_child, channel) = machine.attach_with_path(Some(&shim)).await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .get_status(GetStatusRequest {
            path: absolute(&repo),
            git_entry: admitted,
            max_entries: 0,
            submodules: SubmoduleMode::Unspecified as i32,
            max_commits: 0,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_status_response::Result::Failure(failure)) = response.result else {
        panic!("changed git entry was accepted")
    };
    assert_eq!(failure.reason, GitFailureReason::EntryChanged as i32);
    assert!(
        !marker.exists(),
        "status started git after the entry changed"
    );
}

#[tokio::test]
async fn status_does_not_discover_parent_repository_through_empty_nested_git_entry() {
    let machine = common::Machine::new();
    let root = machine.root();
    let parent = root.join("parent");
    repository(&parent);
    let nested = parent.join("nested");
    std::fs::create_dir_all(nested.join(".git")).unwrap();
    let (mut child, channel) = machine.attach().await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .get_status(GetStatusRequest {
            path: absolute(&nested),
            git_entry: absolute(&nested.join(".git")),
            max_entries: 0,
            submodules: SubmoduleMode::Unspecified as i32,
            max_commits: 0,
        })
        .await
        .unwrap()
        .into_inner();
    let Some(get_status_response::Result::Failure(failure)) = response.result else {
        panic!("nested empty git entry fell back to parent repository")
    };
    assert_eq!(failure.reason, GitFailureReason::GitFailed as i32);
    child.kill().await.unwrap();
}

#[tokio::test]
async fn option_like_worktree_base_is_rejected_before_git() {
    let machine = common::Machine::new();
    let repo = machine.root().join("repo");
    repository(&repo);
    let (shim, marker) = git_shim(&machine);
    let (_child, channel) = machine.attach_with_path(Some(&shim)).await;
    let mut client = GitServiceClient::new(channel);
    let response = client
        .create_worktree(CreateWorktreeRequest {
            request_id: "option-like-base".into(),
            repository: absolute(&repo),
            branch: "feature".into(),
            base: Some("--force".into()),
            path: absolute(&machine.root().join("linked")),
        })
        .await
        .unwrap()
        .into_inner();
    let Some(create_worktree_response::Result::Failure(failure)) = response.result else {
        panic!("option-like base was accepted")
    };
    assert_eq!(failure.reason, GitFailureReason::InvalidInput as i32);
    assert!(!marker.exists(), "worktree operation started git");
}
