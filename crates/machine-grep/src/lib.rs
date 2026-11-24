//! Content search for `FilesService.Grep`.

use machine_core::Context;
use machine_protocol::v1::{GrepRequest, GrepResponse};
use tonic::Status;

#[allow(clippy::unused_async)]
pub async fn grep(_context: &Context, _request: GrepRequest) -> Result<GrepResponse, Status> {
    Err(Status::unimplemented("Files.Grep"))
}
