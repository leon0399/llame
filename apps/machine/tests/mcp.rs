#![allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::panic,
    clippy::wildcard_enum_match_arm,
    clippy::too_many_lines
)]

mod common;

use machine_protocol::v1::{
    Open, OpenSessionRequest, Transport, mcp_service_client::McpServiceClient,
    open_session_request::Message as RequestMessage,
    open_session_response::Message as ResponseMessage,
};
use tokio_stream::wrappers::ReceiverStream;

#[tokio::test]
async fn lists_resolved_servers_and_relays_stdio_until_stream_close() {
    let machine = common::Machine::new();
    let script = machine.root().join("fixture.sh");
    let pid_file = machine.root().join("fixture.pid");
    std::fs::write(
        &script,
        r#"#!/bin/bash
echo $$ > "$MCP_FIXTURE_PID"
echo fixture-stderr >&2
while IFS= read -r line; do
  echo '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}'
  sleep 30
done
"#,
    )
    .unwrap();
    let config = serde_json::json!({
        "mcpServers": {
            "echo": {
                "command": "/bin/bash",
                "args": [script.to_string_lossy()],
                "env": {"MCP_FIXTURE_PID": pid_file.to_string_lossy()}
            },
            "missing": {
                "command": "/bin/true",
                "env": {"TOKEN": "{env:MCP_TEST_MISSING_TOKEN_UNLIKELY}"}
            }
        }
    });
    std::fs::write(
        machine.root().join(".mcp.json"),
        serde_json::to_vec(&config).unwrap(),
    )
    .unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = McpServiceClient::new(channel);
    let listed = client
        .list_servers(machine_protocol::v1::ListServersRequest {
            workspace: machine.root().to_string_lossy().into_owned(),
        })
        .await
        .unwrap()
        .into_inner();
    assert_eq!(listed.servers.len(), 2);
    assert!(listed.servers[0].available);
    assert_eq!(listed.servers[0].transport, Transport::Stdio as i32);
    assert!(!listed.servers[1].available);

    let (sender, receiver) = tokio::sync::mpsc::channel(4);
    sender
        .send(OpenSessionRequest {
            message: Some(RequestMessage::Open(Open {
                workspace: machine.root().to_string_lossy().into_owned(),
                server: "echo".to_owned(),
            })),
        })
        .await
        .unwrap();
    let response = client
        .open_session(ReceiverStream::new(receiver))
        .await
        .unwrap();
    let mut stream = response.into_inner();
    assert!(matches!(
        stream.message().await.unwrap().unwrap().message,
        Some(ResponseMessage::Opened(_))
    ));
    sender
        .send(OpenSessionRequest {
            message: Some(RequestMessage::JsonRpc(
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#.to_owned(),
            )),
        })
        .await
        .unwrap();

    let mut got_stderr = false;
    let mut got_message = false;
    for _ in 0..5 {
        let message = tokio::time::timeout(std::time::Duration::from_secs(5), stream.message())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .message
            .unwrap();
        match message {
            ResponseMessage::Stderr(text) => {
                got_stderr |= text.contains("fixture-stderr");
            }
            ResponseMessage::JsonRpc(text) => {
                got_message |= text.contains("protocolVersion");
            }
            _ => {}
        }
        if got_stderr && got_message {
            break;
        }
    }
    assert!(got_stderr);
    assert!(got_message);
    let pid: u32 = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if let Ok(pid) = tokio::fs::read_to_string(&pid_file).await {
                break pid.trim().parse().unwrap();
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    drop(stream);
    drop(sender);
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while std::path::Path::new(&format!("/proc/{pid}")).exists() {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn streamable_http_forwards_protocol_and_session_headers() {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for index in 0..3 {
            let (socket, _) = listener.accept().await.unwrap();
            let mut reader = tokio::io::BufReader::new(socket);
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
                .unwrap_or_default();
            let mut body = vec![0; content_length];
            reader.read_exact(&mut body).await.unwrap();
            let (status, content_type, response) = match index {
                0 => (
                    "200 OK",
                    "application/json",
                    r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}"#,
                ),
                1 => (
                    "200 OK",
                    "text/event-stream",
                    "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[]}}\n\n",
                ),
                _ => ("200 OK", "application/json", ""),
            };
            let wire = format!(
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nMcp-Session-Id: session-secret-abc123\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response.len(),
                response,
            );
            reader.get_mut().write_all(wire.as_bytes()).await.unwrap();
            requests.push((headers, String::from_utf8(body).unwrap()));
        }
        requests
    });

    let machine = common::Machine::new();
    let config = serde_json::json!({
        "mcpServers": {
            "remote": {
                "type": "http",
                "url": format!("http://{address}/mcp"),
                "headers": {"X-Api-Key": "fixture-key"}
            }
        }
    });
    std::fs::write(
        machine.root().join(".mcp.json"),
        serde_json::to_vec(&config).unwrap(),
    )
    .unwrap();
    let (_child, channel) = machine.attach().await;
    let mut client = McpServiceClient::new(channel);
    let (sender, receiver) = tokio::sync::mpsc::channel(4);
    sender
        .send(OpenSessionRequest {
            message: Some(RequestMessage::Open(Open {
                workspace: machine.root().to_string_lossy().into_owned(),
                server: "remote".to_owned(),
            })),
        })
        .await
        .unwrap();
    let mut stream = client
        .open_session(ReceiverStream::new(receiver))
        .await
        .unwrap()
        .into_inner();
    assert!(matches!(
        stream.message().await.unwrap().unwrap().message,
        Some(ResponseMessage::Opened(_))
    ));
    sender
        .send(OpenSessionRequest {
            message: Some(RequestMessage::ProtocolVersion("2025-03-26".to_owned())),
        })
        .await
        .unwrap();
    sender
        .send(OpenSessionRequest {
            message: Some(RequestMessage::JsonRpc(
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#.to_owned(),
            )),
        })
        .await
        .unwrap();

    let mut got_protected = false;
    let mut got_message = false;
    for _ in 0..2 {
        match tokio::time::timeout(std::time::Duration::from_secs(5), stream.message())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .message
            .unwrap()
        {
            ResponseMessage::Secrets(secrets) => {
                got_protected = secrets.values.contains(&"session-secret-abc123".to_owned());
            }
            ResponseMessage::JsonRpc(text) => {
                got_message = text.contains("protocolVersion");
            }
            _ => {}
        }
    }
    assert!(got_protected);
    assert!(got_message);
    sender
        .send(OpenSessionRequest {
            message: Some(RequestMessage::JsonRpc(
                r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#.to_owned(),
            )),
        })
        .await
        .unwrap();
    let message = tokio::time::timeout(std::time::Duration::from_secs(5), stream.message())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
        .message
        .unwrap();
    assert!(matches!(message, ResponseMessage::JsonRpc(text) if text.contains("\"tools\":[]")));
    drop(stream);
    drop(sender);
    let requests = server.await.unwrap();
    assert!(
        requests[0]
            .0
            .to_ascii_lowercase()
            .contains("mcp-protocol-version: 2025-03-26")
    );
    assert!(
        requests[0]
            .0
            .to_ascii_lowercase()
            .contains("x-api-key: fixture-key")
    );
    assert!(requests[0].1.contains("\"method\":\"initialize\""));
    assert!(
        requests[1]
            .0
            .to_ascii_lowercase()
            .contains("mcp-protocol-version: 2025-03-26")
    );
    assert!(
        requests[1]
            .0
            .to_ascii_lowercase()
            .contains("mcp-session-id: session-secret-abc123")
    );
    assert!(requests[1].1.contains("\"method\":\"tools/list\""));
    assert!(requests[2].0.to_ascii_lowercase().starts_with("delete "));
    assert!(
        requests[2]
            .0
            .to_ascii_lowercase()
            .contains("mcp-session-id: session-secret-abc123")
    );
}
