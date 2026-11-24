//! `McpService`: workspace MCP servers relayed over one stream per session.

use machine_core::Context;
use machine_protocol::v1::{
    ListServersRequest, ListServersResponse, OpenRequest, OpenResponse,
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
        Err(Status::unimplemented("Mcp.ListServers"))
    }
    type OpenStream = tokio_stream::wrappers::ReceiverStream<Result<OpenResponse, Status>>;
    async fn open(&self, _: Request<Streaming<OpenRequest>>) -> Result<Response<Self::OpenStream>, Status> {
        Err(Status::unimplemented("Mcp.Open"))
    }
}
