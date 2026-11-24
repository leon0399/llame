//! `WriteFile` and `ReplaceText`.

use machine_core::Context;
use machine_protocol::v1::{ReplaceTextRequest, ReplaceTextResponse, WriteFileRequest, WriteFileResponse};
use tonic::Status;

#[allow(clippy::unused_async)]
pub async fn write(_context: &Context, _request: WriteFileRequest) -> Result<WriteFileResponse, Status> {
    Err(Status::unimplemented("FileService.WriteFile"))
}

#[allow(clippy::unused_async)]
pub async fn replace(_context: &Context, _request: ReplaceTextRequest) -> Result<ReplaceTextResponse, Status> {
    Err(Status::unimplemented("FileService.ReplaceText"))
}
