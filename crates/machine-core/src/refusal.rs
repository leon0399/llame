//! Refusals before any work: gRPC status codes with a `google.rpc.ErrorInfo`
//! reason. Domain outcomes travel in each response instead.

use tonic::{Code, Status};
use tonic_types::{ErrorDetails, StatusExt};

pub const DOMAIN: &str = "machine.stead.dev";

/// The fixed refusal for a path outside the roots. Identical whether or not
/// the path exists.
pub const PATH_NOT_REGISTERED_MESSAGE: &str = "The path is outside every root registered on this Machine.";

pub fn with_reason(code: Code, reason: &str, message: impl Into<String>) -> Status {
    Status::with_error_details(code, message, ErrorDetails::with_error_info(reason, DOMAIN, []))
}

pub fn path_not_registered() -> Status {
    with_reason(Code::PermissionDenied, "path_not_registered", PATH_NOT_REGISTERED_MESSAGE)
}

pub fn invalid_argument(message: impl Into<String>) -> Status {
    with_reason(Code::InvalidArgument, "invalid_argument", message)
}

pub fn job_limit(limit: u32) -> Status {
    with_reason(
        Code::ResourceExhausted,
        "machine_job_limit",
        format!("The Machine already runs its limit of {limit} jobs."),
    )
}

pub fn internal(message: impl Into<String>) -> Status {
    Status::internal(message)
}
