import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  JSONRPCMessageSchema,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createMcpGuardedFetch,
  createStdioTransport,
  DiagnosticBuffer,
  isStdio,
  type McpRuntimeRemoteDefinition,
  type McpRuntimeServerDefinition,
  type McpRuntimeStdioDefinition,
  type McpStdioTransportConfig,
} from "@workspace/mcp-workspace";
import {
  isSerializableRecord,
  isStringValue,
  MCP_MESSAGE_NOTIFICATION,
  MCP_PROTECTED_NOTIFICATION,
  MCP_SET_PROTOCOL_VERSION_NOTIFICATION,
  MCP_STDERR_NOTIFICATION,
  type JsonRpcNotification,
  type JsonValue,
} from "@workspace/machine-protocol";
import { redactProtectedString } from "@workspace/runtime-safety";
import { MachineRequestError } from "./errors";
import type { OperationContext } from "./dispatch-types";
import { toJsonValue } from "./json-value";
import { createSignal } from "./signal";

/**
 * The hub's own HTTP bounds, applied on the Machine because that is where the
 * server is reached: one mebibyte each way, exactly as the hub's guarded fetch
 * caps a local Workspace server's traffic.
 */
const MCP_BODY_MAX_BYTES = 1024 * 1024;

const START_FAILURE_MESSAGE = "mcp.open: the server could not be started";
const RELAY_FAILURE_MESSAGE = "The Workspace MCP relay on this Machine stopped";
const REFUSED_MESSAGE = "the hub sent a message that is not a JSON-RPC message";
const SERVER_CLOSED_MESSAGE = "the server exited";

/** What a relay reports and the context it reports it through. */
export type McpRelayInput = {
  /** The server's name in this Workspace, for diagnostics only. */
  readonly name: string;
  readonly definition: McpRuntimeServerDefinition;
  readonly protectedValues: ReadonlyArray<string>;
  readonly context: OperationContext;
};

/** Runs `handler` when `signal` aborts, including one already aborted. */
function onAbort(signal: AbortSignal, handler: () => void): void {
  if (signal.aborted) handler();
  else signal.addEventListener("abort", handler, { once: true });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** A transport failure's text, including the cause a wrapped fetch hides. */
function describeError(error: Error): string {
  const cause = error.cause;
  if (!(cause instanceof Error) || cause.message.length === 0)
    return error.message;
  return `${error.message}: ${cause.message}`;
}

/**
 * The bounded, redacted diagnostics of one relay. The protected set can grow
 * mid-session — an HTTP server's session id is learned from its first response
 * — and the buffer redacts against the set it was built with, so learning a
 * value drops the buffer and the next diagnostic rebuilds from the wider set.
 */
class RelayDiagnostics {
  private buffer: DiagnosticBuffer | undefined;
  private readonly values: Array<string>;

  constructor(
    values: ReadonlyArray<string>,
    private readonly emit: (text: string) => void,
  ) {
    this.values = [...values];
  }

  /** Takes a value the server resolved mid-session — the sole caller is the
   *  HTTP session id, which the guarded fetch reports once. */
  learn(value: string): void {
    this.values.push(value);
    this.buffer = undefined;
  }

  append(chunk: Buffer | string): void {
    if (this.buffer === undefined)
      this.buffer = new DiagnosticBuffer(this.values, this.emit);
    this.buffer.append(chunk);
  }

  flush(): void {
    this.buffer?.flush();
  }
}

/**
 * One `mcp.open` stream: the relay that keeps a Workspace server of this
 * Machine running for as long as the hub's channel is open.
 *
 * The daemon resolves the declaration, starts the server, and then carries
 * JSON-RPC messages in both directions — it is a pipe, not an MCP client: the
 * protocol client, admission, and redaction stay on the hub, and nothing the
 * hub sends can name a command, URL, or environment.
 */
export class McpRelay {
  private readonly diagnostics: RelayDiagnostics;
  private readonly settled = createSignal<void>();
  private transport: Transport | undefined;
  private closing: Promise<void> | undefined;
  /** Whether the hub has been told the server exists, i.e. whether closing
   *  the stream is still this relay's to do. */
  private published = false;

  constructor(private readonly input: McpRelayInput) {
    this.diagnostics = new RelayDiagnostics(input.protectedValues, (text) =>
      input.context.notify(MCP_STDERR_NOTIFICATION, { text }),
    );
  }

  /** Resolves once the server this relay started is gone. */
  get done(): Promise<void> {
    return this.settled.promise;
  }

  /**
   * Starts the definition's server and begins relaying. The stream outlives
   * the answer this returns, so a failure here is still the operation's own
   * error to the hub; only a failure after that closes the stream.
   */
  async start(): Promise<void> {
    const transport = this.createTransport();
    this.transport = transport;
    this.listen(transport);
    try {
      await transport.start();
    } catch (error) {
      // Nothing was published, so this relay puts its own process down and
      // leaves the stream to the error `runOperation` answers with.
      await this.close();
      throw startFailure(this.input.name, error, this.input.protectedValues);
    }
    this.published = true;
    // Linked after the answer is the hub's: cancelling the stream or losing
    // the session are the two ways this relay is told to put the server down,
    // and both arrive as this one abort.
    onAbort(this.input.context.streamSignal, () => void this.close());
  }

  close(): Promise<void> {
    this.closing ??= this.closeOnce();
    return this.closing;
  }

  private async closeOnce(): Promise<void> {
    this.diagnostics.flush();
    const transport = this.transport;
    this.transport = undefined;
    try {
      await transport?.close();
    } catch {
      // A transport that already died refuses to close; there is nothing left
      // to do about it, and the stream below still has to be closed.
    }
    this.diagnostics.flush();
    if (this.published) this.input.context.closeStream();
    this.settled.resolve();
  }

  private createTransport(): Transport {
    return isStdio(this.input.definition)
      ? this.createStdioTransport(this.input.definition)
      : this.createHttpTransport(this.input.definition);
  }

  private createStdioTransport(
    definition: McpRuntimeStdioDefinition,
  ): Transport {
    const config: McpStdioTransportConfig = {
      command: definition.command,
      ...(definition.args !== undefined && { args: definition.args }),
      ...(definition.env !== undefined && { env: definition.env }),
      ...(definition.cwd !== undefined && { cwd: definition.cwd }),
    };
    const transport = createStdioTransport(config);
    // Attached before start: the child can write to stderr from its first
    // instruction, and the buffer bounds and redacts what it writes.
    transport.stderr?.on("data", (chunk: Buffer) =>
      this.diagnostics.append(chunk),
    );
    return transport;
  }

  private createHttpTransport(
    definition: McpRuntimeRemoteDefinition,
  ): Transport {
    return new StreamableHTTPClientTransport(new URL(definition.url), {
      fetch: createMcpGuardedFetch({
        fetch: globalThis.fetch,
        maxRequestBytes: MCP_BODY_MAX_BYTES,
        maxResponseBytes: MCP_BODY_MAX_BYTES,
        onSessionId: (sessionId) => this.reportProtected(sessionId),
      }),
      ...(definition.headers !== undefined && {
        requestInit: { headers: definition.headers },
      }),
    });
  }

  private listen(transport: Transport): void {
    transport.onmessage = (message) => this.publish(message);
    transport.onerror = (error) => this.fail(error);
    // The server is gone, which is a crashed server on the hub's side: the
    // diagnostic says why the tools vanished, and this stream ends instead of
    // carrying messages no server will answer.
    transport.onclose = () => this.failWith(SERVER_CLOSED_MESSAGE);
    this.input.context.onNotification((message) => this.receive(message));
  }

  /**
   * Hands the hub a message the server sent. Everything here came off a JSON
   * wire — stdout framing or an HTTP body — so it is a JSON value already.
   */
  private publish(message: JSONRPCMessage): void {
    this.input.context.notify(MCP_MESSAGE_NOTIFICATION, {
      message: toJsonValue(message),
    });
  }

  private receive(notification: JsonRpcNotification): void {
    if (notification.method === MCP_SET_PROTOCOL_VERSION_NOTIFICATION) {
      this.setProtocolVersion(notification.params);
      return;
    }
    if (notification.method !== MCP_MESSAGE_NOTIFICATION) return;
    const message = readRelayedMessage(notification.params);
    if (message === undefined) {
      this.failWith(REFUSED_MESSAGE);
      return;
    }
    void this.send(message);
  }

  private async send(message: JSONRPCMessage): Promise<void> {
    try {
      await this.transport?.send(message);
    } catch (error) {
      this.fail(asError(error));
    }
  }

  private setProtocolVersion(params: JsonValue | undefined): void {
    const version = readProtocolVersion(params);
    if (version === undefined) return;
    this.transport?.setProtocolVersion?.(version);
  }

  /** The session id the server issued: a secret from the moment it arrives. */
  private reportProtected(value: string): void {
    this.diagnostics.learn(value);
    this.input.context.notify(MCP_PROTECTED_NOTIFICATION, { values: [value] });
  }

  private fail(error: Error): void {
    this.failWith(describeError(error));
  }

  private failWith(reason: string): void {
    // Only the first failure is reported: a transport that reports an error
    // and then closes would otherwise describe one death twice.
    if (this.closing !== undefined) return;
    this.diagnostics.append(
      `${RELAY_FAILURE_MESSAGE} for ${this.input.name}: ${reason}\n`,
    );
    void this.close();
  }
}

function startFailure(
  name: string,
  error: unknown,
  protectedValues: ReadonlyArray<string>,
): MachineRequestError {
  const detail = redactProtectedString(
    describeError(asError(error)),
    protectedValues,
  );
  return new MachineRequestError(
    "internal",
    `${START_FAILURE_MESSAGE} for ${name}: ${detail}`,
  );
}

/** The message a hub notification carries, or null when it is not one. */
function readRelayedMessage(
  params: JsonValue | undefined,
): JSONRPCMessage | undefined {
  if (params === undefined || !isSerializableRecord(params)) return undefined;
  const parsed = JSONRPCMessageSchema.safeParse(params["message"]);
  return parsed.success ? parsed.data : undefined;
}

function readProtocolVersion(
  params: JsonValue | undefined,
): string | undefined {
  if (params === undefined || !isSerializableRecord(params)) return undefined;
  const version = params["version"];
  return isStringValue(version) ? version : undefined;
}
