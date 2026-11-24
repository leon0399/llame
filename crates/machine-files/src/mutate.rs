//! `Files.Edit` and `Files.Write`.

use machine_core::Context;
use machine_protocol::v1::{EditRequest, EditResponse, WriteRequest, WriteResponse};
use tonic::Status;

#[allow(clippy::unused_async)]
pub async fn edit(_context: &Context, _request: EditRequest) -> Result<EditResponse, Status> {
    Err(Status::unimplemented("Files.Edit"))
}

#[allow(clippy::unused_async)]
pub async fn write(_context: &Context, _request: WriteRequest) -> Result<WriteResponse, Status> {
    Err(Status::unimplemented("Files.Write"))
}
