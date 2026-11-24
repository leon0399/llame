//! Request metadata shared by daemon services for request correlation logs.

use tonic::{Request, metadata::MetadataMap};

/// Log correlation headers when a service receives a request.
pub fn log<T>(request: &Request<T>) {
    let metadata = request.metadata();
    tracing::debug!(
        tool_call_id = header(metadata, "x-llame-tool-call-id"),
        sentry_trace = header(metadata, "sentry-trace"),
        baggage = header(metadata, "baggage"),
        "machine request metadata"
    );
}

fn header<'a>(metadata: &'a MetadataMap, name: &'static str) -> Option<&'a str> {
    metadata.get(name).and_then(|value| value.to_str().ok())
}
