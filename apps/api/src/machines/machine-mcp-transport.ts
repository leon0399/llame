/**
 * MachineTransport — the hub's `@ai-sdk/mcp` transport over one `mcp.open`
 * channel (remote-machines design D6; spec "Workspace MCP servers of a Machine
 * Workspace run from the Machine").
 *
 * The Machine owns everything that names a process or an endpoint: it resolves
 * the declaration against its own environment, starts the server, and relays
 * JSON-RPC messages in both directions. The hub sends a server name and
 * nothing else. What stays here is the pipe plus the three decisions only the
 * hub may make: the protected values of the definition the Machine actually
 * started are secrets from the moment they arrive, the diagnostics the Machine
 * relays are bounded and redacted a second time on this side, and a closed
 * channel is a crashed server rather than a transport hiccup.
 */

import {
  validateJSONRPCMessage,
  type JSONRPCMessage,
  type MCPTransport,
  type MCPTransportSendOptions,
} from '@ai-sdk/mcp';
import {
  CANCEL_NOTIFICATION,
  isSerializableRecord,
  isStringValue,
  MCP_MESSAGE_NOTIFICATION,
  MCP_PROTECTED_NOTIFICATION,
  MCP_SET_PROTOCOL_VERSION_NOTIFICATION,
  MCP_STDERR_NOTIFICATION,
  type JsonRpcNotification,
  type JsonValue,
  type MachineChannel,
  type SerializableValue,
} from '@workspace/machine-protocol';
import { DiagnosticBuffer } from '@workspace/mcp-workspace';
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  normalizeProtectedValues,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import type { MachineConnector } from './machine-connector.service';
import { readMcpOpenResult } from './machine-results';
import type { MachineRequestEnvelope } from './machine-session';

export type MachineMcpTransportOptions = {
  readonly connector: MachineConnector;
  /** The Machine the Workspace lives on. */
  readonly machine: string;
  /** The Workspace's absolute path on that Machine. */
  readonly root: string;
  /** The server's name in that Workspace's configuration. */
  readonly server: string;
  /** The identity and time budget every `mcp.*` request of this session carries. */
  readonly envelope: MachineRequestEnvelope;
  /** Aborting this closes the channel, which is how the Machine is told to
   *  stop the server it started. */
  readonly signal?: AbortSignal;
  /** One bounded, redacted line the Machine relayed on this server's stderr. */
  readonly onDiagnostic?: (text: string) => void;
};

export class MachineTransport implements MCPTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  protocolVersion?: string;

  private channel: MachineChannel | undefined;
  private starting: Promise<void> | undefined;
  private diagnostics: DiagnosticBuffer | undefined;
  private values: ReadonlyArray<string> = [];
  /** llame's own close: not a loss, so no `onclose` is reported for it. */
  private shutdown = false;
  /** The Machine ended the channel: every later call fails. */
  private halted = false;
  /** Whether the Machine's answer to `mcp.open` arrived, i.e. whether this
   *  channel is one the hub published to the MCP client. */
  private published = false;

  constructor(private readonly options: MachineMcpTransportOptions) {}

  /**
   * Whether the Machine ended this channel before llame closed it. The MCP
   * client reports that as a crashed server instead of a transport fault.
   */
  get lost(): boolean {
    return this.halted;
  }

  /**
   * The values the Machine resolved for the definition it actually started,
   * plus every value learned since (an HTTP session id). Read at each use,
   * never cached: a value learned after discovery must still be redacted from
   * the next declaration, result, or diagnostic.
   */
  protectedValues(): ReadonlyArray<string> {
    return normalizeProtectedValues(this.values);
  }

  async start(): Promise<void> {
    this.starting ??= this.open();
    return this.starting;
  }

  send(
    message: JSONRPCMessage,
    options?: MCPTransportSendOptions,
  ): Promise<void> {
    options?.signal?.throwIfAborted();
    const channel = this.channel;
    if (channel === undefined || this.halted || this.shutdown) {
      return Promise.reject(
        new Error('The Machine Workspace MCP channel is closed.'),
      );
    }
    channel.notify(MCP_MESSAGE_NOTIFICATION, {
      message: toJsonValue(message),
    });
    return Promise.resolve();
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
    this.channel?.notify(MCP_SET_PROTOCOL_VERSION_NOTIFICATION, { version });
  }

  close(): Promise<void> {
    this.shutdown = true;
    const channel = this.channel;
    this.channel = undefined;
    this.diagnostics?.flush();
    // `cancel` is how the protocol says a stream is given up, and it is the
    // Machine's signal to put down the server it started for this channel.
    channel?.notify(CANCEL_NOTIFICATION, {});
    channel?.close();
    return Promise.resolve();
  }

  private async open(): Promise<void> {
    if (this.shutdown) {
      throw new Error('The Machine Workspace MCP transport is closed.');
    }
    const handle = await this.options.connector.openChannel(
      this.options.machine,
      'mcp.open',
      {
        envelope: this.options.envelope,
        root: this.options.root,
        server: this.options.server,
      },
      this.options.signal === undefined ? {} : { signal: this.options.signal },
    );
    this.channel = handle.channel;
    this.listen(handle.channel);
    await this.publish(handle.result);
  }

  /** Every notification this channel carries, and the one way it ends. */
  private listen(channel: MachineChannel): void {
    channel.onNotification((notification) => this.receive(notification));
    channel.onClose(() => {
      // Before the Machine's answer the channel is not yet the MCP client's,
      // so a close here is part of a failed start, not a lost server.
      if (this.published) {
        this.fail(new Error('The Machine closed this Workspace MCP channel.'));
      }
    });
  }

  /** The Machine's answer to `mcp.open`: the protected values of the
   *  definition it actually started, and the point the channel becomes the
   *  MCP client's to lose. */
  private async publish(result: Promise<JsonValue>): Promise<void> {
    let value: JsonValue;
    try {
      value = await result;
    } catch (error) {
      const channel = this.channel;
      this.channel = undefined;
      channel?.close();
      throw error instanceof Error ? error : new Error(String(error));
    }
    const opened = readMcpOpenResult(value);
    if (opened === undefined) {
      this.fail(new Error('The Machine answered an unusable mcp.open result.'));
      throw new Error('The Machine answered an unusable mcp.open result.');
    }
    this.learn(opened.protectedValues);
    this.published = true;
  }

  private receive(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case MCP_STDERR_NOTIFICATION: {
        this.appendDiagnostic(readText(notification.params));
        return;
      }
      case MCP_PROTECTED_NOTIFICATION: {
        this.learn(readValues(notification.params));
        return;
      }
      case MCP_MESSAGE_NOTIFICATION: {
        const message = readRelayedMessage(notification.params);
        if (message === undefined) {
          this.fail(
            new Error(
              'The Machine relayed a message that is not a JSON-RPC message.',
            ),
          );
          return;
        }
        this.onmessage?.(message);
        return;
      }
      default:
        return;
    }
  }

  /** The Machine ended the channel: a crashed server from here on. */
  private fail(error: Error): void {
    if (this.halted || this.shutdown) return;
    this.halted = true;
    this.channel = undefined;
    this.diagnostics?.flush();
    this.onerror?.(error);
    this.onclose?.();
  }

  /** Takes protected values into the set diagnostics and results redact
   *  against, dropping the buffer so the wider set applies from here on. */
  private learn(values: ReadonlyArray<string>): void {
    if (values.length === 0) return;
    this.values = normalizeProtectedValues([...this.values, ...values]);
    this.diagnostics = undefined;
  }

  private appendDiagnostic(text: string | undefined): void {
    if (text === undefined) return;
    this.diagnostics ??= new DiagnosticBuffer(this.values, (line) =>
      this.options.onDiagnostic?.(line),
    );
    this.diagnostics.append(text);
  }
}

/** One line of diagnostic text the Machine relayed, if that is what it is. */
function readText(params: JsonValue | undefined): string | undefined {
  if (!isSerializableRecord(params)) return undefined;
  const text = params['text'];
  return isStringValue(text) ? text : undefined;
}

/** The values a later-learned protected-value notification carries. */
function readValues(params: JsonValue | undefined): ReadonlyArray<string> {
  if (!isSerializableRecord(params)) return [];
  const values = params['values'];
  return isTextList(values) ? values : [];
}

function isTextList(value: SerializableValue): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((entry) => isString(entry));
}

/** The JSON-RPC message a relayed notification carries, validated rather than
 *  asserted: everything the Machine relays is untrusted input. */
function readRelayedMessage(
  params: JsonValue | undefined,
): JSONRPCMessage | undefined {
  if (!isSerializableRecord(params)) return undefined;
  try {
    return validateJSONRPCMessage(params['message']);
  } catch {
    return undefined;
  }
}

/** Whether JSON can spell this value as a container. */
function isJsonContainer(
  value: unknown,
): value is UnknownRecord | ReadonlyArray<unknown> {
  return isRecord(value) || Array.isArray(value);
}

/** A container's members, as JSON values. */
function toJsonContainer(
  value: UnknownRecord | ReadonlyArray<unknown>,
): JsonValue {
  if (Array.isArray(value)) {
    const items: ReadonlyArray<unknown> = value;
    return items.map((item) => toJsonValue(item));
  }
  const record: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    // An absent value is an omitted property in JSON, exactly as the frame
    // encoder treats it.
    if (entry === undefined) continue;
    record[key] = toJsonValue(entry);
  }
  return record;
}

/**
 * The JSON value of one MCP message the hub is about to relay. The MCP SDK's
 * message type carries `unknown` payload slots — a JSON-RPC `result` is a loose
 * record by construction — so the conversion is checked rather than asserted.
 */
function toJsonValue(value: unknown): JsonValue {
  if (isJsonContainer(value)) return toJsonContainer(value);
  if (value === null || isString(value) || isBoolean(value)) return value;
  if (isNumber(value) && Number.isFinite(value)) return value;
  throw new Error('The message is not a JSON value.');
}
