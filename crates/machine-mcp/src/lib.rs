//! `McpService`: workspace MCP servers relayed over one stream per session.

use machine_core::Context;
use machine_protocol::v1::{
    OpenSessionRequest, OpenSessionResponse, ListServersRequest, ListServersResponse,
    mcp_service_server::{McpService, McpServiceServer},
};
use tonic::{Request, Response, Status, Streaming};

pub fn service(context: Context) -> McpServiceServer<Mcp> {
    McpServiceServer::new(Mcp { _context: context })
}

pub struct Mcp {
    _context: Context,
}

#[tonic::async_trait]
impl McpService for Mcp {
    async fn list_servers(&self, _: Request<ListServersRequest>) -> Result<Response<ListServersResponse>, Status> {
        Err(Status::unimplemented("McpService.ListServers"))
    }
    type OpenSessionStream = tokio_stream::wrappers::ReceiverStream<Result<OpenSessionResponse, Status>>;
    async fn open_session(&self, _: Request<Streaming<OpenSessionRequest>>) -> Result<Response<Self::OpenSessionStream>, Status> {
        Err(Status::unimplemented("McpService.OpenSession"))
    }
}
