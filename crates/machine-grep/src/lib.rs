//! Content search for `FileService.SearchFiles`.

use machine_core::Context;
use machine_protocol::v1::{SearchFilesRequest, SearchFilesResponse};
use tonic::Status;

pub type SearchStream = tokio_stream::wrappers::ReceiverStream<Result<SearchFilesResponse, Status>>;

#[allow(clippy::unused_async)]
pub async fn search(
    _context: &Context,
    _request: SearchFilesRequest,
) -> Result<SearchStream, Status> {
    Err(Status::unimplemented("FileService.SearchFiles"))
}
