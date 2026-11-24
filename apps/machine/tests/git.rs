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
    GitFailureReason, ListWorktreesRequest, SubmoduleMode, create_worktree_response,
    delete_worktree_response, get_repository_response, get_status_response,
    git_service_client::GitServiceClient, list_worktrees_response,
};
use std::{path::Path, process::Command};

fn git(directory: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
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
    let output = Command::new("git")
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
    assert_eq!(facts.worktree, absolute(&repo));
    assert_eq!(facts.git_dir, absolute(&repo.join(".git")));
    assert_eq!(facts.common_dir, facts.git_dir);
    assert!(facts.branch.is_some());
    assert!(facts.head.is_some());
    let response = client
        .get_status(GetStatusRequest {
            path: absolute(&repo),
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
async fn upstream_ahead_and_behind_are_reported() {
    let machine = common::Machine::new();
    let root = machine.root();
    let bare = root.join("remote.git");
    let output = Command::new("git")
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
    let out = Command::new("git")
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
    child.kill().await.unwrap();
}

#[tokio::test]
async fn gitdir_outside_root_is_refused() {
    let machine = common::Machine::new();
    let root = machine.root();
    let external = std::env::temp_dir().join(format!("machine-git-outside-{}", std::process::id()));
    let source = external.join("source");
    let git_dir = external.join("linked.git");
    repository(&source);
    let repo = root.join("linked");
    let out = Command::new("git")
        .args(["clone", "-q", "--separate-git-dir"])
        .arg(&git_dir)
        .arg(&source)
        .arg(&repo)
        .output()
        .unwrap();
    assert!(out.status.success());
    let (_child, channel) = machine.attach().await;
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
    let _ = std::fs::remove_dir_all(external);
}
