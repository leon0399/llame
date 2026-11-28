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

const MAX_IN_FLIGHT_HTTP_REQUESTS: usize = 32;
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
    let mut requests: JoinSet<(bool, bool, Result<(), String>)> = JoinSet::new();
    let mut cancellation_in_flight = false;
    let mut response_in_flight = false;
    let mut stream_open = true;
    while stream_open {
        tokio::select! {
            () = tx.closed() => stream_open = false,
            completed = requests.join_next(), if !requests.is_empty() => {
                match completed {
                    Some(Ok((is_cancellation, is_response, Err(error)))) => {
                        cancellation_in_flight &= !is_cancellation;
                        response_in_flight &= !is_response;
                        let values = state.protected_values.lock().await.clone();
                        let _ = tx
                            .send(Ok(failure(
                                McpFailureReason::Unavailable,
                                redact(&error, &values),
                            )))
                            .await;
                        stream_open = false;
                    }
                    Some(Err(error)) => {
                        let values = state.protected_values.lock().await.clone();
                        let _ = tx
                            .send(Ok(failure(
                                McpFailureReason::Unavailable,
                                redact(&error.to_string(), &values),
                            )))
                            .await;
                        stream_open = false;
                    }
                    Some(Ok((is_cancellation, is_response, Ok(())))) => {
                        cancellation_in_flight &= !is_cancellation;
                        response_in_flight &= !is_response;
                    }
                    None => {}
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
                let (method, request_id) = request_metadata(&text);
                let is_initialized_notification =
                    method.as_deref() == Some("notifications/initialized");
                let is_cancellation = method.as_deref() == Some("notifications/cancelled");
                let is_response = method.is_none();
                if exceeds_request_capacity(
                    method.as_deref(),
                    requests.len(),
                    cancellation_in_flight,
                    response_in_flight,
                ) {
                    if reject_capacity(&tx, request_id, is_response).await {
                        stream_open = false;
                    }
                    continue;
                }
                if is_initialized_notification {
                    if let Err(error) = relay_request(state.clone(), text).await {
                        let values = state.protected_values.lock().await.clone();
                        let _ = tx
                            .send(Ok(failure(
                                McpFailureReason::Unavailable,
                                redact(&error, &values),
                            )))
                            .await;
                        stream_open = false;
                    }
                } else {
                    cancellation_in_flight |= is_cancellation;
                    response_in_flight |= is_response;
                    let state = state.clone();
                    requests.spawn(async move {
                        (
                            is_cancellation,
                            is_response,
                            relay_request(state, text).await,
                        )
                    });
                }
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
    let (request_method, request_id) = request_metadata(&text);
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
    let established = session_id.is_some();
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
    if !response.status().is_success() {
        let status = response.status();
        if request_id.is_none()
            && request_method
                .as_deref()
                .is_some_and(|method| method != "notifications/initialized")
        {
            return Ok(());
        }
        if status_is_call_level(
            status,
            established,
            request_method.as_deref(),
            request_id.is_some(),
        ) {
            send_call_error(&state.tx, request_id, status).await?;
            return Ok(());
        }
        return Err(format!("HTTP MCP server returned {status}"));
    }
    if should_capture_session_id(request_method.as_deref(), response.status()) {
        capture_session_id(&state, &response).await?;
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
                forward_sse(response, &state.tx, request_id.as_ref()).await
            } else {
                forward_json(response, &state.tx).await
            }
        } => result,
    }
}

fn request_metadata(text: &str) -> (Option<String>, Option<Value>) {
    let Ok(request) = serde_json::from_str::<Value>(text) else {
        return (None, None);
    };
    (
        request
            .get("method")
            .and_then(Value::as_str)
            .map(str::to_owned),
        request.get("id").cloned(),
    )
}

async fn send_call_error(
    tx: &mpsc::Sender<Result<OpenSessionResponse, Status>>,
    id: Option<Value>,
    status: reqwest::StatusCode,
) -> Result<(), String> {
    let Some(id) = id else {
        return Ok(());
    };
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

async fn send_capacity_error(
    tx: &mpsc::Sender<Result<OpenSessionResponse, Status>>,
    id: Option<Value>,
) {
    let Some(id) = id else {
        return;
    };
    let message = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": -32002,
            "message": "MCP HTTP relay is at capacity"
        }
    });
    if let Ok(message) = serde_json::to_string(&message) {
        let _ = tx.send(Ok(message_response(message))).await;
    }
}
async fn reject_capacity(
    tx: &mpsc::Sender<Result<OpenSessionResponse, Status>>,
    id: Option<Value>,
    is_response: bool,
) -> bool {
    if is_response {
        let _ = tx
            .send(Ok(failure(
                McpFailureReason::Unavailable,
                "MCP HTTP relay is at capacity while forwarding a server response".to_owned(),
            )))
            .await;
        true
    } else {
        send_capacity_error(tx, id).await;
        false
    }
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
    expected_id: Option<&Value>,
) -> Result<(), String> {
    let mut stream = response.bytes_stream();
    let mut line = Vec::new();
    let mut data = Vec::new();
    let mut event = Vec::new();
    let mut event_bytes = 0_usize;
    let mut previous_was_cr = false;
    let mut first_line = true;
    let mut reply_seen = expected_id.is_none();
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
                        reply_seen |= dispatch_sse_event(&event, &data, tx, expected_id).await?;
                    }
                    data.clear();
                    event.clear();
                    event_bytes = 0;
                } else {
                    parse_sse_field_line(&line, &mut event, &mut data, first_line);
                    first_line = false;
                    line.clear();
                }
            } else {
                previous_was_cr = false;
                line.push(byte);
            }
        }
    }
    if reply_seen {
        Ok(())
    } else {
        Err("MCP SSE response ended before the request reply".to_owned())
    }
}
fn should_forward_sse_event(event: &[u8]) -> bool {
    event.is_empty() || event == b"message"
}

fn parse_sse_field_line(line: &[u8], event: &mut Vec<u8>, data: &mut Vec<u8>, first_line: bool) {
    let line = if first_line {
        line.strip_prefix(b"\xef\xbb\xbf").unwrap_or(line)
    } else {
        line
    };
    let (field, value) = line
        .iter()
        .position(|byte| *byte == b':')
        .map_or((line, &[][..]), |index| {
            (&line[..index], &line[index + 1..])
        });
    let value = value.strip_prefix(b" ").unwrap_or(value);
    match field {
        b"data" => {
            if !data.is_empty() {
                data.push(b'\n');
            }
            data.extend_from_slice(value);
        }
        b"event" => {
            event.clear();
            event.extend_from_slice(value);
        }
        _ => {}
    }
}

async fn dispatch_sse_event(
    event: &[u8],
    data: &[u8],
    tx: &mpsc::Sender<Result<OpenSessionResponse, Status>>,
    expected_id: Option<&Value>,
) -> Result<bool, String> {
    if !should_forward_sse_event(event) {
        return Ok(false);
    }
    let payload = std::str::from_utf8(data).map_err(|error| error.to_string())?;
    let value: Value = serde_json::from_str(payload).map_err(|error| error.to_string())?;
    let reply = expected_id.is_some_and(|id| value.get("id") == Some(id));
    let message = serde_json::to_string(&value).map_err(|error| error.to_string())?;
    tx.send(Ok(message_response(message)))
        .await
        .map_err(|_| "MCP stream closed".to_owned())?;
    Ok(reply)
}
fn status_is_call_level(
    status: reqwest::StatusCode,
    established: bool,
    method: Option<&str>,
    has_request_id: bool,
) -> bool {
    method.is_some()
        && has_request_id
        && status != reqwest::StatusCode::UNAUTHORIZED
        && status != reqwest::StatusCode::FORBIDDEN
        && (status != reqwest::StatusCode::NOT_FOUND || !established)
}

fn exceeds_request_capacity(
    method: Option<&str>,
    in_flight: usize,
    cancellation_in_flight: bool,
    response_in_flight: bool,
) -> bool {
    match method {
        Some("notifications/initialized") => false,
        None => in_flight >= MAX_IN_FLIGHT_HTTP_REQUESTS && response_in_flight,
        Some("notifications/cancelled") => {
            in_flight >= MAX_IN_FLIGHT_HTTP_REQUESTS && cancellation_in_flight
        }
        Some(_) => in_flight >= MAX_IN_FLIGHT_HTTP_REQUESTS,
    }
}

fn should_capture_session_id(method: Option<&str>, status: reqwest::StatusCode) -> bool {
    method == Some("initialize") && status.is_success()
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

    #[test]
    fn sse_parser_strips_initial_bom_and_colonless_event_resets_type() {
        let mut event = Vec::new();
        let mut data = Vec::new();
        parse_sse_field_line(b"\xef\xbb\xbfdata: {\"id\":1}", &mut event, &mut data, true);
        assert_eq!(data, br#"{"id":1}"#);
        parse_sse_field_line(b"event: ping", &mut event, &mut data, false);
        assert_eq!(event, b"ping");
        parse_sse_field_line(b"event", &mut event, &mut data, false);
        assert!(event.is_empty());
    }

    #[tokio::test]
    async fn sse_ping_payload_is_ignored_before_valid_message() {
        let (tx, mut rx) = mpsc::channel(4);
        assert!(
            !dispatch_sse_event(b"ping", b"not-json", &tx, Some(&serde_json::json!(1)))
                .await
                .unwrap()
        );
        assert!(rx.try_recv().is_err());
        assert!(
            dispatch_sse_event(
                b"message",
                br#"{"jsonrpc":"2.0","id":1}"#,
                &tx,
                Some(&serde_json::json!(1))
            )
            .await
            .unwrap()
        );
        let response = rx.try_recv().unwrap().unwrap();
        assert!(matches!(
            response.message.as_ref(),
            Some(ResponseMessage::JsonRpc(text)) if text.contains("\"id\":1")
        ));
    }

    #[tokio::test]
    async fn sse_eof_without_matching_response_fails_pending_request() {
        use tokio::io::AsyncWriteExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let fixture = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\n";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        let response = reqwest::Client::new()
            .get(format!("http://{address}/mcp"))
            .send()
            .await
            .unwrap();
        let (tx, mut rx) = mpsc::channel(2);
        assert!(
            forward_sse(response, &tx, Some(&serde_json::json!(7)))
                .await
                .is_err()
        );
        let message = rx.try_recv().unwrap().unwrap().message.unwrap();
        assert!(
            matches!(message, ResponseMessage::JsonRpc(text) if text.contains("notifications/progress"))
        );
        fixture.await.unwrap();
    }

    #[test]
    fn request_capacity_reserves_one_response_and_one_cancellation() {
        assert!(exceeds_request_capacity(
            Some("tools/list"),
            MAX_IN_FLIGHT_HTTP_REQUESTS,
            false,
            false
        ));
        assert!(!exceeds_request_capacity(
            None,
            MAX_IN_FLIGHT_HTTP_REQUESTS,
            false,
            false
        ));
        assert!(exceeds_request_capacity(
            None,
            MAX_IN_FLIGHT_HTTP_REQUESTS + 1,
            false,
            true
        ));
        assert!(!exceeds_request_capacity(
            Some("notifications/cancelled"),
            MAX_IN_FLIGHT_HTTP_REQUESTS,
            false,
            false
        ));
        assert!(exceeds_request_capacity(
            Some("notifications/cancelled"),
            MAX_IN_FLIGHT_HTTP_REQUESTS + 1,
            true,
            false
        ));
        assert!(!exceeds_request_capacity(
            Some("notifications/initialized"),
            MAX_IN_FLIGHT_HTTP_REQUESTS,
            false,
            false
        ));
    }

    #[test]
    fn call_level_statuses_are_request_scoped_except_auth_and_expired_session() {
        for method in ["tools/call", "tools/list", "resources/read"] {
            assert!(status_is_call_level(
                reqwest::StatusCode::TOO_MANY_REQUESTS,
                true,
                Some(method),
                true
            ));
            assert!(status_is_call_level(
                reqwest::StatusCode::INTERNAL_SERVER_ERROR,
                true,
                Some(method),
                true
            ));
        }
        assert!(!status_is_call_level(
            reqwest::StatusCode::NOT_FOUND,
            true,
            Some("tools/list"),
            true
        ));
        assert!(!status_is_call_level(
            reqwest::StatusCode::UNAUTHORIZED,
            true,
            Some("tools/call"),
            true
        ));
        assert!(!status_is_call_level(
            reqwest::StatusCode::FORBIDDEN,
            true,
            Some("tools/call"),
            true
        ));
        assert!(!status_is_call_level(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            true,
            None,
            true
        ));
        assert!(!status_is_call_level(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            true,
            Some("tools/list"),
            false
        ));
        assert!(status_is_call_level(
            reqwest::StatusCode::NOT_FOUND,
            false,
            Some("tools/list"),
            true
        ));
        assert!(should_capture_session_id(
            Some("initialize"),
            reqwest::StatusCode::OK
        ));
        assert!(!should_capture_session_id(
            Some("tools/list"),
            reqwest::StatusCode::OK
        ));
        assert!(!should_capture_session_id(
            Some("initialize"),
            reqwest::StatusCode::INTERNAL_SERVER_ERROR
        ));
    }

    #[tokio::test]
    async fn capacity_rejection_fails_instead_of_replying_to_server_response() {
        let (tx, mut rx) = mpsc::channel(1);
        assert!(reject_capacity(&tx, Some(1.into()), true).await);
        let response = rx.try_recv().unwrap().unwrap();
        assert!(matches!(
            response.message,
            Some(ResponseMessage::Failure(failure))
                if failure.reason == McpFailureReason::Unavailable as i32
        ));
    }

    #[tokio::test]
    async fn capacity_rejection_returns_error_for_client_request() {
        let (tx, mut rx) = mpsc::channel(1);
        assert!(!reject_capacity(&tx, Some(1.into()), false).await);
        let response = rx.try_recv().unwrap().unwrap();
        assert!(matches!(
            response.message,
            Some(ResponseMessage::JsonRpc(text)) if text.contains("\"error\"")
        ));
    }

    #[allow(clippy::too_many_lines)]
    #[tokio::test]
    async fn relay_drops_failed_notifications_and_keeps_call_errors_without_session() {
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let fixture = tokio::spawn(async move {
            for status in [429, 500, 429, 500, 410, 404, 404, 500, 429, 404] {
                let (socket, _) = listener.accept().await.unwrap();
                let mut reader = BufReader::new(socket);
                let mut content_length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).await.unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some(value) = line
                        .split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                    {
                        content_length = value.1.trim().parse::<usize>().unwrap();
                    }
                }
                let mut body = vec![0; content_length];
                reader.read_exact(&mut body).await.unwrap();
                let response = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
                reader
                    .get_mut()
                    .write_all(response.as_bytes())
                    .await
                    .unwrap();
            }
        });
        let (tx, mut rx) = mpsc::channel(8);
        let state = RelayState {
            client: reqwest::Client::new(),
            tx,
            url: format!("http://{address}/mcp"),
            declared_headers: BTreeMap::new(),
            session_id: Arc::new(Mutex::new(None)),
            protocol_version: Arc::new(Mutex::new(None)),
            protected_values: Arc::new(Mutex::new(Vec::new())),
        };
        let requests = [
            (
                r#"{"jsonrpc":"2.0","method":"notifications/progress"}"#,
                true,
            ),
            (
                r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
                false,
            ),
            (
                r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}"#,
                true,
            ),
            (
                r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{}}"#,
                true,
            ),
            (
                r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{}}"#,
                true,
            ),
            (
                r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{}}"#,
                true,
            ),
            (
                r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{}}"#,
                false,
            ),
            (r#"{"jsonrpc":"2.0","id":6,"method":"tools/list"}"#, true),
            (
                r#"{"jsonrpc":"2.0","id":7,"method":"resources/read"}"#,
                true,
            ),
            (
                r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
                false,
            ),
        ];
        for (index, (request, succeeds)) in requests.into_iter().enumerate() {
            if index == 6 || index == 9 {
                *state.session_id.lock().await = Some("session".to_owned());
            }
            let result = relay_request(state.clone(), request.to_owned()).await;
            assert_eq!(result.is_ok(), succeeds, "request {index}");
            if index == 0 || !succeeds {
                assert!(
                    rx.try_recv().is_err(),
                    "request {index} must not emit a frame"
                );
            } else {
                let response = rx.try_recv().unwrap().unwrap();
                assert!(matches!(
                    response.message,
                    Some(ResponseMessage::JsonRpc(text)) if text.contains("\"error\"")
                ));
            }
        }
        fixture.await.unwrap();
    }

    #[tokio::test]
    async fn failed_notification_does_not_emit_null_id_error() {
        let (tx, mut rx) = mpsc::channel(1);
        send_call_error(&tx, None, reqwest::StatusCode::TOO_MANY_REQUESTS)
            .await
            .unwrap();
        assert!(rx.try_recv().is_err());
    }

    #[allow(clippy::too_many_lines)]
    #[tokio::test]
    async fn relay_echoes_padded_header_as_a_redactable_secret() {
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let fixture = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut reader = BufReader::new(socket);
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).await.unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                headers.push_str(&line);
            }
            let content_length = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                })
                .map(|(_, value)| value.trim().parse::<usize>().unwrap())
                .unwrap();
            let mut body = vec![0; content_length];
            reader.read_exact(&mut body).await.unwrap();
            let header = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("x-api-key"))
                })
                .map(|(_, value)| value.trim().to_owned())
                .unwrap();
            let response_body = format!(r#"{{"jsonrpc":"2.0","id":7,"result":"{header}"}}"#);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            reader
                .get_mut()
                .write_all(response.as_bytes())
                .await
                .unwrap();
            (header, String::from_utf8(body).unwrap())
        });

        let (tx, mut rx) = mpsc::channel(2);
        let mut protected = Vec::new();
        crate::register_protected("  padded-header-token-1931  ", &mut protected, true);
        let state = RelayState {
            client: reqwest::Client::new(),
            tx,
            url: format!("http://{address}/mcp"),
            declared_headers: BTreeMap::from([(
                "X-Api-Key".to_owned(),
                "  padded-header-token-1931  ".to_owned(),
            )]),
            session_id: Arc::new(Mutex::new(Some("session".to_owned()))),
            protocol_version: Arc::new(Mutex::new(None)),
            protected_values: Arc::new(Mutex::new(protected.clone())),
        };
        tokio::time::timeout(
            Duration::from_secs(5),
            relay_request(
                state,
                r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{}}"#.to_owned(),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        let (header, request_body) = tokio::time::timeout(Duration::from_secs(5), fixture)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(header, "padded-header-token-1931");
        assert!(request_body.contains("\"method\":\"tools/call\""));
        let response = rx.recv().await.unwrap().unwrap();
        let Some(ResponseMessage::JsonRpc(response)) = response.message else {
            panic!("expected relayed JSON-RPC response");
        };
        let redacted = crate::redact(&response, &protected);
        assert!(redacted.contains("[REDACTED]"));
        assert!(!redacted.contains("padded-header-token-1931"));
    }
}
