//! `GitService`: built-in git operations.

use machine_core::Context;
use machine_protocol::v1::{
    InspectRequest, InspectResponse, LocateRequest, LocateResponse, StateRequest, StateResponse,
    WorktreeAddRequest, WorktreeAddResponse, WorktreeListRequest, WorktreeListResponse, WorktreeRemoveRequest,
    WorktreeRemoveResponse,
    git_service_server::{GitService, GitServiceServer},
};
use tonic::{Request, Response, Status};

pub fn service(context: Context) -> GitServiceServer<Git> {
    GitServiceServer::new(Git { _context: context })
}

pub struct Git {
    _context: Context,
}

#[tonic::async_trait]
impl GitService for Git {
    async fn inspect(&self, _: Request<InspectRequest>) -> Result<Response<InspectResponse>, Status> {
        Err(Status::unimplemented("Git.Inspect"))
    }
    async fn locate(&self, _: Request<LocateRequest>) -> Result<Response<LocateResponse>, Status> {
        Err(Status::unimplemented("Git.Locate"))
    }
    async fn state(&self, _: Request<StateRequest>) -> Result<Response<StateResponse>, Status> {
        Err(Status::unimplemented("Git.State"))
    }
    async fn worktree_add(&self, _: Request<WorktreeAddRequest>) -> Result<Response<WorktreeAddResponse>, Status> {
        Err(Status::unimplemented("Git.WorktreeAdd"))
    }
    async fn worktree_list(&self, _: Request<WorktreeListRequest>) -> Result<Response<WorktreeListResponse>, Status> {
        Err(Status::unimplemented("Git.WorktreeList"))
    }
    async fn worktree_remove(
        &self,
        _: Request<WorktreeRemoveRequest>,
    ) -> Result<Response<WorktreeRemoveResponse>, Status> {
        Err(Status::unimplemented("Git.WorktreeRemove"))
    }
}
