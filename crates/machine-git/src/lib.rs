//! `GitService`: repositories, status, and worktrees.

use machine_core::Context;
use machine_protocol::v1::{
    CreateWorktreeRequest, CreateWorktreeResponse, DeleteWorktreeRequest, DeleteWorktreeResponse, GetRepositoryRequest,
    GetRepositoryResponse, GetStatusRequest, GetStatusResponse, ListWorktreesRequest, ListWorktreesResponse,
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
    async fn get_repository(&self, _: Request<GetRepositoryRequest>) -> Result<Response<GetRepositoryResponse>, Status> {
        Err(Status::unimplemented("GitService.GetRepository"))
    }
    async fn get_status(&self, _: Request<GetStatusRequest>) -> Result<Response<GetStatusResponse>, Status> {
        Err(Status::unimplemented("GitService.GetStatus"))
    }
    async fn create_worktree(&self, _: Request<CreateWorktreeRequest>) -> Result<Response<CreateWorktreeResponse>, Status> {
        Err(Status::unimplemented("GitService.CreateWorktree"))
    }
    async fn list_worktrees(&self, _: Request<ListWorktreesRequest>) -> Result<Response<ListWorktreesResponse>, Status> {
        Err(Status::unimplemented("GitService.ListWorktrees"))
    }
    async fn delete_worktree(&self, _: Request<DeleteWorktreeRequest>) -> Result<Response<DeleteWorktreeResponse>, Status> {
        Err(Status::unimplemented("GitService.DeleteWorktree"))
    }
}
