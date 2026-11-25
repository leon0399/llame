//! Streamable HTTP relay for MCP servers.

use futures::StreamExt;
use machine_protocol::v1::{
    McpFailureReason, OpenSessionRequest, OpenSessionResponse, Opened, Secrets,
    open_session_response::Message as ResponseMessage,
};
use serde_json::Value;
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tokio::{
    sync::{Mutex, mpsc},
    task::JoinSet,
};
use tonic::{Status, Streaming};

use crate::{MAX_MESSAGE_BYTES, failure, message_response, redact};

#[derive(Clone)]
struct RelayState {
    client: reqwest::Client,
    tx: mpsc::Sender<Result<OpenSessionResponse, Status>>,
    url: String,
    declared_headers: BTreeMap<String, String>,
    session_id: Arc<Mutex<Option<String>>>,
    protocol_version: Arc<Mutex<Option<String>>>,
    protected_values: Arc<Mutex<Vec<String>>>,
}

/// Relays messages over Streamable HTTP until the client closes its stream.
#[allow(clippy::too_many_lines)]
pub async fn run_http(
    mut incoming: Streaming<OpenSessionRequest>,
    tx: mpsc::Sender<Result<OpenSessionResponse, Status>>,
    url: String,
    declared_headers: BTreeMap<String, String>,
    protected: Vec<String>,
) {
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            let _ = tx
                .send(Ok(failure(
                    McpFailureReason::Unavailable,
                    redact(&error.to_string(), &protected),
                )))
                .await;
            return;
        }
    };
    if tx
        .send(Ok(OpenSessionResponse {
            message: Some(ResponseMessage::Opened(Opened {
                secrets: Some(Secrets {
                    values: protected.clone(),
                }),
            })),
        }))
        .await
        .is_err()
    {
        return;
    }
    let state = RelayState {
        client,
        tx: tx.clone(),
        url,
        declared_headers,
        session_id: Arc::new(Mutex::new(None)),
        protocol_version: Arc::new(Mutex::new(None)),
        protected_values: Arc::new(Mutex::new(protected.clone())),
    };
    let mut requests: JoinSet<Result<(), String>> = JoinSet::new();
    let mut stream_open = true;
    while stream_open {
        tokio::select! {
            () = tx.closed() => stream_open = false,
            completed = requests.join_next(), if !requests.is_empty() => {
                match completed {
                    Some(Ok(Err(error))) => {
                        let values = state.protected_values.lock().await.clone();
                        let _ = tx.send(Ok(failure(McpFailureReason::Unavailable, redact(&error, &values)))).await;
                        stream_open = false;
                    }
                    Some(Err(error)) => {
                        let values = state.protected_values.lock().await.clone();
                        let _ = tx.send(Ok(failure(McpFailureReason::Unavailable, redact(&error.to_string(), &values)))).await;
                        stream_open = false;
                    }
                    Some(Ok(Ok(()))) | None => {}
                }
            },
            message = incoming.message() => {
                let Ok(Some(request)) = message else {
                    stream_open = false;
                    continue;
                };
                let Some(frame) = request.message else {
                    stream_open = false;
                    continue;
                };
                let text = match frame {
                    machine_protocol::v1::open_session_request::Message::ProtocolVersion(version) => {
                        *state.protocol_version.lock().await = Some(version);
                        continue;
                    }
                    machine_protocol::v1::open_session_request::Message::JsonRpc(text) => text,
                    machine_protocol::v1::open_session_request::Message::Open(_) => {
                        stream_open = false;
                        continue;
                    }
                };
                if text.len() > MAX_MESSAGE_BYTES {
                    let _ = tx.send(Ok(failure(
                        McpFailureReason::Unavailable,
                        "MCP request exceeded the 1048576-byte limit".to_owned(),
                    ))).await;
                    stream_open = false;
                    continue;
                }
                let state = state.clone();
                requests.spawn(async move { relay_request(state, text).await });
            }
        }
    }
    requests.abort_all();
    while requests.join_next().await.is_some() {}
    let session_id = state.session_id.lock().await.clone();
    if let Some(id) = session_id {
        let mut request = state.client.delete(&state.url).header("mcp-session-id", id);
        for (name, value) in &state.declared_headers {
            request = request.header(name, value);
        }
        let protocol_version = state.protocol_version.lock().await.clone();
        if let Some(version) = protocol_version {
            request = request.header("mcp-protocol-version", version);
        }
        let _ = tokio::time::timeout(Duration::from_secs(2), request.send()).await;
    }
}

async fn relay_request(state: RelayState, text: String) -> Result<(), String> {
    let request_id = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|request| request.get("id").cloned())
        .unwrap_or(Value::Null);
    let mut request = state
        .client
        .post(&state.url)
        .header("accept", "application/json, text/event-stream")
        .header("content-type", "application/json")
        .body(text);
    for (name, value) in &state.declared_headers {
        request = request.header(name, value);
    }
    let session_id = state.session_id.lock().await.clone();
    if let Some(id) = session_id {
        request = request.header("mcp-session-id", id);
    }
    let protocol_version = state.protocol_version.lock().await.clone();
    if let Some(version) = protocol_version {
        request = request.header("mcp-protocol-version", version);
    }
    let response = tokio::select! {
        () = state.tx.closed() => return Ok(()),
        response = request.send() => response.map_err(|error| error.to_string())?,
    };
    capture_session_id(&state, &response).await?;
    if !response.status().is_success() {
        let status = response.status();
        let established = state.session_id.lock().await.is_some();
        if status_is_call_level(status, established) {
            send_call_error(&state.tx, request_id, status).await?;
            return Ok(());
        }
        return Err(format!("HTTP MCP server returned {status}"));
    }
    let is_sse = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("text/event-stream"));
    if !is_sse
        && response
            .content_length()
            .is_some_and(|length| length > MAX_MESSAGE_BYTES as u64)
    {
        return Err("MCP response exceeded the 1048576-byte transport limit".to_owned());
    }
    tokio::select! {
        () = state.tx.closed() => Ok(()),
        result = async {
            if is_sse {
                forward_sse(response, &state.tx).await
            } else {
                forward_json(response, &state.tx).await
            }
        } => result,
    }
}

async fn send_call_error(
    tx: &mpsc::Sender<Result<OpenSessionResponse, Status>>,
    id: Value,
    status: reqwest::StatusCode,
) -> Result<(), String> {
    let message = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": -32000,
            "message": format!("HTTP MCP server returned {status}")
        }
    });
    let message = serde_json::to_string(&message).map_err(|error| error.to_string())?;
    tx.send(Ok(message_response(message)))
        .await
        .map_err(|_| "MCP stream closed".to_owned())
}

async fn capture_session_id(
    state: &RelayState,
    response: &reqwest::Response,
) -> Result<(), String> {
    let Some(id) = response
        .headers()
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .filter(|id| !id.is_empty())
    else {
        return Ok(());
    };
    let mut current = state.session_id.lock().await;
    if current.as_deref() != Some(id) {
        *current = Some(id.to_owned());
        let mut values = state.protected_values.lock().await;
        if !values.iter().any(|value| value == id) {
            values.push(id.to_owned());
        }
        state
            .tx
            .send(Ok(OpenSessionResponse {
                message: Some(ResponseMessage::Secrets(Secrets {
                    values: vec![id.to_owned()],
                })),
            }))
            .await
            .map_err(|_| "MCP stream closed".to_owned())?;
    }
    Ok(())
}

async fn forward_json(
    response: reqwest::Response,
    tx: &mpsc::Sender<Result<OpenSessionResponse, Status>>,
) -> Result<(), String> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if body.len().saturating_add(chunk.len()) > MAX_MESSAGE_BYTES {
            return Err("MCP response exceeded the 1048576-byte transport limit".to_owned());
        }
        body.extend_from_slice(&chunk);
    }
    if body.is_empty() {
        return Ok(());
    }
    let value: Value = serde_json::from_slice(&body).map_err(|error| error.to_string())?;
    let message = serde_json::to_string(&value).map_err(|error| error.to_string())?;
    tx.send(Ok(message_response(message)))
        .await
        .map_err(|_| "MCP stream closed".to_owned())
}

async fn forward_sse(
    response: reqwest::Response,
    tx: &mpsc::Sender<Result<OpenSessionResponse, Status>>,
) -> Result<(), String> {
    let mut stream = response.bytes_stream();
    let mut line = Vec::new();
    let mut data = Vec::new();
    let mut event = Vec::new();
    let mut event_bytes = 0_usize;
    let mut previous_was_cr = false;
    while let Some(chunk) = stream.next().await {
        for byte in chunk.map_err(|error| error.to_string())? {
            event_bytes = event_bytes.saturating_add(1);
            if event_bytes > MAX_MESSAGE_BYTES {
                return Err("MCP SSE event exceeded the 1048576-byte transport limit".to_owned());
            }
            if previous_was_cr && byte == b'\n' {
                previous_was_cr = false;
                continue;
            }
            if byte == b'\r' || byte == b'\n' {
                previous_was_cr = byte == b'\r';
                if line.is_empty() {
                    if !data.is_empty() {
                        dispatch_sse_event(&event, &data, tx).await?;
                    }
                    data.clear();
                    event.clear();
                    event_bytes = 0;
                } else {
                    if let Some(value) = line.strip_prefix(b"data:") {
                        let value = value.strip_prefix(b" ").unwrap_or(value);
                        if !data.is_empty() {
                            data.push(b'\n');
                        }
                        data.extend_from_slice(value);
                    } else if let Some(value) = line.strip_prefix(b"event:") {
                        let value = value.strip_prefix(b" ").unwrap_or(value);
                        event.clear();
                        event.extend_from_slice(value);
                    }
                    line.clear();
                }
            } else {
                previous_was_cr = false;
                line.push(byte);
            }
        }
    }
    Ok(())
}
fn should_forward_sse_event(event: &[u8]) -> bool {
    event.is_empty() || event == b"message"
}

async fn dispatch_sse_event(
    event: &[u8],
    data: &[u8],
    tx: &mpsc::Sender<Result<OpenSessionResponse, Status>>,
) -> Result<(), String> {
    if !should_forward_sse_event(event) {
        return Ok(());
    }
    let payload = std::str::from_utf8(data).map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_str(payload).map_err(|error| error.to_string())?;
    let message = serde_json::to_string(&value).map_err(|error| error.to_string())?;
    tx.send(Ok(message_response(message)))
        .await
        .map_err(|_| "MCP stream closed".to_owned())
}

fn status_is_call_level(status: reqwest::StatusCode, established: bool) -> bool {
    status != reqwest::StatusCode::UNAUTHORIZED
        && status != reqwest::StatusCode::FORBIDDEN
        && !(status == reqwest::StatusCode::NOT_FOUND && established)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_message_or_untyped_sse_events_are_forwarded() {
        assert!(should_forward_sse_event(b""));
        assert!(should_forward_sse_event(b"message"));
        assert!(!should_forward_sse_event(b"ping"));
    }

    #[tokio::test]
    async fn sse_ping_payload_is_ignored_before_valid_message() {
        let (tx, mut rx) = mpsc::channel(4);
        dispatch_sse_event(b"ping", b"not-json", &tx).await.unwrap();
        assert!(rx.try_recv().is_err());
        dispatch_sse_event(b"message", br#"{"jsonrpc":"2.0","id":1}"#, &tx)
            .await
            .unwrap();
        let response = rx.try_recv().unwrap().unwrap();
        assert!(matches!(
            response.message.as_ref(),
            Some(ResponseMessage::JsonRpc(text)) if text.contains("\"id\":1")
        ));
    }

    #[test]
    fn call_level_http_statuses_do_not_withdraw_a_session() {
        assert!(status_is_call_level(
            reqwest::StatusCode::TOO_MANY_REQUESTS,
            true
        ));
        assert!(status_is_call_level(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            true
        ));
        assert!(status_is_call_level(reqwest::StatusCode::GONE, true));
        assert!(!status_is_call_level(
            reqwest::StatusCode::UNAUTHORIZED,
            true
        ));
        assert!(!status_is_call_level(reqwest::StatusCode::FORBIDDEN, true));
        assert!(!status_is_call_level(reqwest::StatusCode::NOT_FOUND, true));
        assert!(status_is_call_level(reqwest::StatusCode::NOT_FOUND, false));
    }
}
