//! Refusals before any work: gRPC status codes with a typed `ErrorDetail`.
//! Domain outcomes travel in each response instead.

use machine_protocol::v1::{ErrorDetail, ErrorReason};
use prost::Message;
use prost_types::Any;
use tonic_types::pb::Status as RpcStatus;
use tonic::{Code, Status};

/// The fixed refusal for a path outside the roots. Identical whether or not
/// the path exists.
pub const PATH_NOT_REGISTERED_MESSAGE: &str = "The path is outside every root registered on this Machine.";

/// Attach an `ErrorDetail` to the gRPC status details.
pub fn status(code: Code, reason: ErrorReason, message: impl Into<String>) -> Status {
    let detail = ErrorDetail { reason: reason as i32 };
    let rpc_status = RpcStatus {
        code: code as i32,
        message: message.into(),
        details: vec![Any {
            type_url: "type.googleapis.com/stead.machine.v1.ErrorDetail".to_owned(),
            value: detail.encode_to_vec(),
        }],
    };
    let details = rpc_status.encode_to_vec();
    Status::with_details(code, rpc_status.message, details.into())
}

/// Decode the typed refusal detail, if present and valid.
pub fn decode(status: &Status) -> Option<ErrorDetail> {
    let rpc_status = RpcStatus::decode(status.details()).ok()?;
    rpc_status.details.into_iter().find_map(|any| {
        (any.type_url == "type.googleapis.com/stead.machine.v1.ErrorDetail")
            .then(|| ErrorDetail::decode(any.value.as_slice()).ok())
            .flatten()
    })
}

pub fn path_not_registered() -> Status {
    status(Code::PermissionDenied, ErrorReason::PathNotRegistered, PATH_NOT_REGISTERED_MESSAGE)
}

pub fn invalid_argument(message: impl Into<String>) -> Status {
    status(Code::InvalidArgument, ErrorReason::InvalidArgument, message)
}

pub fn job_limit(limit: u32) -> Status {
    status(
        Code::ResourceExhausted,
        ErrorReason::JobLimit,
        format!("The Machine already runs its limit of {limit} jobs."),
    )
}

pub fn job_not_found() -> Status {
    status(Code::NotFound, ErrorReason::JobNotFound, "The job was not found.")
}

pub fn job_running() -> Status {
    status(Code::FailedPrecondition, ErrorReason::JobRunning, "The job is still running.")
}

pub fn internal(message: impl Into<String>) -> Status {
    Status::internal(message)
}
