//! `McpService`: workspace MCP servers relayed over one stream per session.

use std::{
    collections::BTreeMap,
    env, io,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use machine_core::{Context, PathKind};
use machine_protocol::v1::{
    ListServersRequest, ListServersResponse, McpFailure, McpFailureReason, OpenSessionRequest,
    OpenSessionResponse, Opened, Secrets, Server, Transport,
    mcp_service_server::{McpService, McpServiceServer},
};
use serde_json::Value;
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::mpsc,
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status, Streaming};
mod http;

const MAX_DIAGNOSTIC_CHARS: usize = 64 * 1024;
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

pub fn service(context: Context) -> McpServiceServer<Mcp> {
    McpServiceServer::new(Mcp { context })
}

pub struct Mcp {
    context: Context,
}

#[derive(Clone)]
enum Definition {
    Stdio {
        command: String,
        args: Vec<String>,
        cwd: PathBuf,
        env: BTreeMap<String, String>,
    },
    Http {
        url: String,
        headers: BTreeMap<String, String>,
    },
}

struct Configured {
    name: String,
    definition: Option<Definition>,
    protected: Vec<String>,
    transport: Transport,
    diagnostic: Option<String>,
}

#[tonic::async_trait]
impl McpService for Mcp {
    async fn list_servers(
        &self,
        request: Request<ListServersRequest>,
    ) -> Result<Response<ListServersResponse>, Status> {
        let root = self.workspace_root(&request.get_ref().workspace)?;
        let configs = read_configs(&root).await;
        Ok(Response::new(ListServersResponse {
            servers: configs
                .into_iter()
                .map(|config| Server {
                    name: config.name,
                    transport: config.transport as i32,
                    available: config.definition.is_some(),
                    diagnostic: config.diagnostic.unwrap_or_default(),
                })
                .collect(),
        }))
    }

    type OpenSessionStream = ReceiverStream<Result<OpenSessionResponse, Status>>;

    async fn open_session(
        &self,
        request: Request<Streaming<OpenSessionRequest>>,
    ) -> Result<Response<Self::OpenSessionStream>, Status> {
        let mut incoming = request.into_inner();
        let first = incoming.message().await?.ok_or_else(|| {
            Status::invalid_argument("McpService.OpenSession requires an open message first")
        })?;
        let Some(machine_protocol::v1::open_session_request::Message::Open(open)) = first.message
        else {
            return Err(Status::invalid_argument(
                "McpService.OpenSession requires an open message first",
            ));
        };
        let root = match self.workspace_root(&open.workspace) {
            Ok(root) => root,
            Err(error) => return Ok(failure_stream(error.message().to_owned())),
        };
        let configs = read_configs(&root).await;
        let Some(config) = configs
            .into_iter()
            .find(|config| config.name == open.server)
        else {
            return Ok(failure_stream(format!(
                "this Workspace declares no server named {}",
                open.server
            )));
        };
        let Some(definition) = config.definition else {
            return Ok(failure_stream(format!(
                "the server named {} is unavailable: {}",
                open.server,
                config
                    .diagnostic
                    .unwrap_or_else(|| "invalid server entry".to_owned())
            )));
        };

        let (tx, rx) = mpsc::channel(16);
        match definition {
            Definition::Stdio {
                command,
                args,
                cwd,
                env,
            } => {
                tokio::spawn(run_stdio(
                    incoming,
                    tx,
                    command,
                    args,
                    cwd,
                    env,
                    config.protected,
                ));
            }
            Definition::Http { url, headers } => {
                tokio::spawn(http::run_http(incoming, tx, url, headers, config.protected));
            }
        }
        Ok(Response::new(ReceiverStream::new(rx)))
    }
}

impl Mcp {
    fn workspace_root(&self, input: &str) -> Result<PathBuf, Status> {
        let guarded = self.context.guard().resolve(input)?;
        if guarded.kind != PathKind::Directory {
            return Err(Status::invalid_argument(
                "the Workspace root is not a directory",
            ));
        }
        Ok(guarded.path)
    }
}

fn failure_stream(
    message: String,
) -> Response<ReceiverStream<Result<OpenSessionResponse, Status>>> {
    let (tx, rx) = mpsc::channel(1);
    let _ = tx.try_send(Ok(failure(McpFailureReason::Unavailable, message)));
    Response::new(ReceiverStream::new(rx))
}

async fn read_configs(root: &Path) -> Vec<Configured> {
    let mut merged = BTreeMap::<String, Value>::new();
    let mut unavailable_entries = Vec::new();
    for (label, file) in [
        (".mcp.json", root.join(".mcp.json")),
        (".llame/mcp.json", root.join(".llame/mcp.json")),
    ] {
        let text = match tokio::fs::read_to_string(&file).await {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                unavailable_entries.push(unavailable(
                    label,
                    format!("configuration file {label} could not be read"),
                ));
                continue;
            }
        };
        let parsed: Value = match serde_json::from_str(&text) {
            Ok(value) => value,
            Err(_) => {
                unavailable_entries.push(unavailable(
                    label,
                    format!("configuration file {label} is malformed"),
                ));
                continue;
            }
        };
        let Some(object) = parsed.as_object() else {
            unavailable_entries.push(unavailable(
                label,
                format!("configuration file {label} must contain an object"),
            ));
            continue;
        };
        let servers = object.get("mcpServers").unwrap_or(&parsed);
        let Some(servers) = servers.as_object() else {
            unavailable_entries.push(unavailable(
                label,
                format!("configuration file {label} has an invalid mcpServers object"),
            ));
            continue;
        };
        for (name, entry) in servers {
            merged.insert(name.clone(), entry.clone());
        }
    }
    let mut result: Vec<_> = merged
        .into_iter()
        .map(|(name, entry)| resolve_entry(name, entry, root))
        .collect();
    result.extend(unavailable_entries);
    result
}

fn unavailable(name: &str, diagnostic: String) -> Configured {
    Configured {
        name: name.to_owned(),
        definition: None,
        protected: Vec::new(),
        transport: Transport::Unspecified,
        diagnostic: Some(diagnostic),
    }
}

fn resolve_entry(name: String, entry: Value, root: &Path) -> Configured {
    if name.is_empty()
        || name.contains("__")
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return unavailable(&name, "invalid server name".to_owned());
    }
    let Some(object) = entry.as_object() else {
        return unavailable(&name, "invalid server entry".to_owned());
    };
    let kind = object.get("type").and_then(Value::as_str);
    let is_stdio = kind == Some("stdio") || (kind.is_none() && object.contains_key("command"));
    if is_stdio {
        let allowed = ["type", "command", "args", "env", "cwd"];
        if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
            return unavailable(&name, format!("unknown field {key}"));
        }
        let Some(command) = object
            .get("command")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
        else {
            return unavailable(&name, "command must be a non-empty string".to_owned());
        };
        let mut protected = Vec::new();
        let Some(command) = interpolate(command, root, &mut protected) else {
            return unavailable(&name, "command interpolation failed".to_owned());
        };
        let mut args = Vec::new();
        if let Some(raw) = object.get("args") {
            let Some(values) = raw.as_array() else {
                return unavailable(&name, "args must be an array of strings".to_owned());
            };
            for value in values {
                let Some(value) = value.as_str() else {
                    return unavailable(&name, "args must be an array of strings".to_owned());
                };
                let Some(value) = interpolate(value, root, &mut protected) else {
                    return unavailable(&name, "args interpolation failed".to_owned());
                };
                args.push(value);
            }
        }
        let mut child_env = BTreeMap::new();
        if let Some(raw) = object.get("env") {
            let Some(values) = raw.as_object() else {
                return unavailable(&name, "env must be an object".to_owned());
            };
            for (key, value) in values {
                let Some(value) = value.as_str() else {
                    return unavailable(&name, format!("env.{key} must be a string"));
                };
                let Some(value) = interpolate(value, root, &mut protected) else {
                    return unavailable(&name, format!("env.{key} interpolation failed"));
                };
                child_env.insert(key.clone(), value);
            }
        }
        let cwd = match object.get("cwd") {
            None => root.to_path_buf(),
            Some(Value::String(value)) => match interpolate(value, root, &mut protected) {
                Some(value) => resolve_path(root, &value),
                None => return unavailable(&name, "cwd interpolation failed".to_owned()),
            },
            _ => return unavailable(&name, "cwd must be a string".to_owned()),
        };
        return Configured {
            name,
            definition: Some(Definition::Stdio {
                command,
                args,
                cwd,
                env: child_env,
            }),
            protected,
            transport: Transport::Stdio,
            diagnostic: None,
        };
    }
    if matches!(kind, Some("http" | "streamable-http")) {
        let allowed = ["type", "url", "headers"];
        if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
            return unavailable(&name, format!("unknown field {key}"));
        }
        let Some(raw_url) = object
            .get("url")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
        else {
            return unavailable(&name, "url must be a non-empty string".to_owned());
        };
        let mut protected = Vec::new();
        let Some(url) = interpolate(raw_url, root, &mut protected) else {
            return unavailable(&name, "url interpolation failed".to_owned());
        };
        let Ok(parsed_url) = reqwest::Url::parse(&url) else {
            return unavailable(
                &name,
                "url must be an absolute http or https URL".to_owned(),
            );
        };
        if !matches!(parsed_url.scheme(), "http" | "https") {
            return unavailable(
                &name,
                "url must be an absolute http or https URL".to_owned(),
            );
        }
        if !parsed_url.username().is_empty() || parsed_url.password().is_some() {
            return unavailable(
                &name,
                "url must be an absolute http or https URL without userinfo".to_owned(),
            );
        }
        let mut headers = BTreeMap::new();
        let mut folded = BTreeMap::<String, String>::new();
        if let Some(raw) = object.get("headers") {
            let Some(values) = raw.as_object() else {
                return unavailable(&name, "headers must be an object".to_owned());
            };
            for (key, value) in values {
                if reqwest::header::HeaderName::from_bytes(key.as_bytes()).is_err() {
                    return unavailable(&name, format!("invalid header {key}"));
                }
                let lower = key.to_ascii_lowercase();
                if let Some(previous) = folded.get(&lower) {
                    return unavailable(
                        &name,
                        format!("header names collide: {previous} and {key}"),
                    );
                }
                if matches!(
                    lower.as_str(),
                    "accept"
                        | "content-type"
                        | "mcp-protocol-version"
                        | "mcp-session-id"
                        | "last-event-id"
                ) {
                    return unavailable(&name, format!("transport-owned header {key}"));
                }
                let Some(raw_value) = value.as_str() else {
                    return unavailable(&name, format!("header {key} must be a string"));
                };
                if raw_value.trim().is_empty() {
                    return unavailable(&name, format!("header {key} must be non-empty"));
                }
                let Some(value) = interpolate(raw_value, root, &mut protected) else {
                    return unavailable(&name, "header interpolation failed".to_owned());
                };
                headers.insert(key.clone(), value.clone());
                if matches!(
                    lower.as_str(),
                    "authorization" | "proxy-authorization" | "cookie"
                ) {
                    let credential = value.trim().to_owned();
                    if !credential.is_empty() && !protected.contains(&credential) {
                        protected.push(credential);
                    }
                }
                folded.insert(lower, key.clone());
            }
        }
        return Configured {
            name,
            definition: Some(Definition::Http { url, headers }),
            protected,
            transport: Transport::Http,
            diagnostic: None,
        };
    }
    unavailable(
        &name,
        format!("unsupported transport {}", kind.unwrap_or("missing")),
    )
}

fn interpolate(input: &str, root: &Path, protected: &mut Vec<String>) -> Option<String> {
    let mut output = String::new();
    let mut index = 0;
    while index < input.len() {
        let rest = &input[index..];
        let dollar = rest.starts_with("${");
        let env_prefix = rest.starts_with("{env:");
        let path_prefix = rest.starts_with("{path:");
        if !dollar && !env_prefix && !path_prefix {
            let character = rest.chars().next()?;
            output.push(character);
            index += character.len_utf8();
            continue;
        }
        let prefix = if dollar {
            2
        } else if path_prefix {
            6
        } else {
            5
        };
        let Some(relative_end) = rest[prefix..].find('}') else {
            output.push_str(rest);
            break;
        };
        let body = &rest[prefix..prefix + relative_end];
        let mut protect = false;
        let value = if path_prefix {
            if body.is_empty() {
                return None;
            }
            let location = Path::new(body);
            let path = if location.is_absolute() {
                location.to_path_buf()
            } else {
                root.join(location)
            };
            protect = true;
            std::fs::read_to_string(path).ok()?.trim().to_owned()
        } else {
            let (name, fallback) = if dollar {
                (body, None)
            } else if let Some((name, fallback)) = body.split_once(":-") {
                (name, Some(fallback))
            } else {
                (body, None)
            };
            if name.is_empty()
                || !name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            {
                output.push_str(&rest[..1]);
                index += 1;
                continue;
            }
            match env::var(name) {
                Ok(value) if !value.is_empty() || fallback.is_none() => {
                    protect = true;
                    value
                }
                Ok(_) | Err(_) => fallback?.to_owned(),
            }
        };
        if protect && !value.is_empty() && !protected.contains(&value) {
            protected.push(value.clone());
        }
        output.push_str(&value);
        index += prefix + relative_end + 1;
    }
    Some(output)
}

fn resolve_path(root: &Path, path: &str) -> PathBuf {
    let path = Path::new(path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_stdio(
    mut incoming: Streaming<OpenSessionRequest>,
    tx: mpsc::Sender<Result<OpenSessionResponse, Status>>,
    command: String,
    args: Vec<String>,
    cwd: PathBuf,
    declared_env: BTreeMap<String, String>,
    protected: Vec<String>,
) {
    let mut child_env = BTreeMap::new();
    for key in [
        "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "LC_ALL", "TMPDIR", "TMP",
        "TEMP",
    ] {
        if let Ok(value) = env::var(key) {
            child_env.insert(key.to_owned(), value);
        }
    }
    child_env.extend(declared_env);
    let mut child = match start_child(&command, &args, &cwd, &child_env) {
        Ok(child) => child,
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
            message: Some(
                machine_protocol::v1::open_session_response::Message::Opened(Opened {
                    secrets: Some(Secrets {
                        values: protected.clone(),
                    }),
                }),
            ),
        }))
        .await
        .is_err()
    {
        kill_group(child.id()).await;
        let _ = child.wait().await;
        return;
    }
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();
    let Some(stdout) = stdout else {
        return;
    };
    let Some(stderr) = stderr else {
        return;
    };
    let Some(mut stdin) = stdin else {
        return;
    };
    let out_tx = tx.clone();
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        while let Ok(Some(line)) = read_bounded_line(&mut reader, MAX_MESSAGE_BYTES).await {
            let text = String::from_utf8_lossy(&line)
                .trim_end_matches(['\r', '\n'])
                .to_owned();
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                let message = serde_json::to_string(&value).unwrap_or_default();
                if out_tx.send(Ok(message_response(message))).await.is_err() {
                    break;
                }
            }
        }
        let _ = out_tx
            .send(Ok(failure(
                McpFailureReason::Unavailable,
                "the server exited".to_owned(),
            )))
            .await;
    });
    let diag_tx = tx.clone();
    let diagnostic_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut retained = 0;
        loop {
            if retained >= MAX_DIAGNOSTIC_CHARS {
                break;
            }
            let remaining = MAX_DIAGNOSTIC_CHARS - retained;
            let Ok(Some(line)) = read_bounded_line(&mut reader, remaining).await else {
                break;
            };
            retained += line.len();
            let text = String::from_utf8_lossy(&line);
            if text.trim().is_empty() {
                continue;
            }
            let text = redact(&text, &protected);
            if diag_tx
                .send(Ok(OpenSessionResponse {
                    message: Some(
                        machine_protocol::v1::open_session_response::Message::Stderr(text),
                    ),
                }))
                .await
                .is_err()
            {
                break;
            }
        }
    });
    loop {
        tokio::select! {
            incoming_message = incoming.message() => match incoming_message {
                Ok(Some(message)) => match message.message {
                    Some(machine_protocol::v1::open_session_request::Message::JsonRpc(text)) => {
                        if text.len() > MAX_MESSAGE_BYTES { break; }
                        if let Ok(value) = serde_json::from_str::<Value>(&text) {
                            if value.get("jsonrpc").and_then(Value::as_str) == Some("2.0") {
                                let mut bytes = text.into_bytes(); bytes.push(b'\n');
                                if stdin.write_all(&bytes).await.is_err() { break; }
                            } else { break; }
                        } else { break; }
                    }
                    Some(machine_protocol::v1::open_session_request::Message::ProtocolVersion(_)) => {},
                    _ => break,
                },
                _ => break,
            },
            _ = tx.closed() => break,
        }
    }
    kill_group(child.id()).await;
    let _ = child.wait().await;
    stdout_task.abort();
    diagnostic_task.abort();
}

fn start_child(
    command: &str,
    args: &[String],
    cwd: &Path,
    env: &BTreeMap<String, String>,
) -> std::io::Result<Child> {
    let mut child = Command::new("setsid");
    child
        .arg(command)
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    child.spawn()
}

async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    limit: usize,
) -> io::Result<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let buffer = reader.fill_buf().await?;
        if buffer.is_empty() {
            return Ok(None);
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let count = newline.map_or(buffer.len(), |index| index + 1);
        if line.len() + count > limit {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "MCP transport line exceeded its byte limit",
            ));
        }
        line.extend_from_slice(&buffer[..count]);
        reader.consume(count);
        if newline.is_some() {
            return Ok(Some(line));
        }
    }
}

async fn kill_group(pid: Option<u32>) {
    let Some(pid) = pid else {
        return;
    };
    let _ = Command::new("kill")
        .args(["-TERM", "--", &format!("-{pid}")])
        .status()
        .await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    let _ = Command::new("kill")
        .args(["-KILL", "--", &format!("-{pid}")])
        .status()
        .await;
}

fn redact(input: &str, protected: &[String]) -> String {
    protected
        .iter()
        .filter(|value| value.len() >= 8)
        .fold(input.to_owned(), |text, value| {
            text.replace(value, "[REDACTED]")
        })
}

fn message_response(message: String) -> OpenSessionResponse {
    OpenSessionResponse {
        message: Some(machine_protocol::v1::open_session_response::Message::JsonRpc(message)),
    }
}

fn failure(reason: McpFailureReason, message: String) -> OpenSessionResponse {
    OpenSessionResponse {
        message: Some(
            machine_protocol::v1::open_session_response::Message::Failure(McpFailure {
                reason: reason as i32,
                message,
            }),
        ),
    }
}
