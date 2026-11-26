/**
 * MachineTransport — the hub's `@ai-sdk/mcp` transport over one `mcp.open`
 * bidi stream (remote-machines design D6; spec "Workspace MCP servers of a
 * Workspace run from the Machine").
 *
 * The Machine owns everything that names a process or an endpoint: it resolves
 * the declaration against its own environment, starts the server, and relays
 * JSON-RPC messages in both directions. The hub sends a server name and
 * nothing else. What stays here is the pipe plus the three decisions only the
 * hub may make: the protected values of the definition the Machine actually
 * started are secrets from the moment they arrive, the diagnostics the Machine
 * relays are bounded and redacted a second time on this side, and a closed
 * stream is a crashed server rather than a transport hiccup.
 */

import {
  validateJSONRPCMessage,
  type JSONRPCMessage,
  type MCPTransport,
  type MCPTransportSendOptions,
} from '@ai-sdk/mcp';
import {
  create,
  type JsonValue,
  OpenSessionRequestSchema,
  type OpenSessionRequest,
  type OpenSessionResponse,
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
import type { MachineRequestEnvelope, MachineSession } from './machine-session';

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
  /** Aborting closes the stream, which tells the Machine to stop the server. */
  readonly signal?: AbortSignal;
  /** One bounded, redacted line the Machine relayed on this server's stderr. */
  readonly onDiagnostic?: (text: string) => void;
};

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: Array<T> = [];
  private readonly readers: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T): void {
    const reader = this.readers.shift();

    if (reader === undefined) this.values.push(value);
    else reader({ done: false, value });
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;

    for (const reader of this.readers.splice(0))
      reader({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();

        if (value !== undefined) return Promise.resolve({ done: false, value });

        if (this.ended)
          return Promise.resolve({ done: true, value: undefined });
        const deferred = Promise.withResolvers<IteratorResult<T>>();
        this.readers.push(deferred.resolve);

        return deferred.promise;
      },
      return: () => {
        this.close();

        return Promise.resolve({ done: true, value: undefined });
      },
      throw: (error: unknown) => {
        this.close();

        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      },
    };
  }
}

export class MachineTransport implements MCPTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  protocolVersion?: string;

  private input: AsyncQueue<OpenSessionRequest> | undefined;
  private reader: AsyncIterator<OpenSessionResponse> | undefined;
  private session: MachineSession | undefined;
  private released = false;
  private streamController: AbortController | undefined;
  private starting: Promise<void> | undefined;
  private diagnostics: DiagnosticBuffer | undefined;
  private values: ReadonlyArray<string> = [];
  private shutdown = false;
  private halted = false;
  private published = false;
  constructor(private readonly options: MachineMcpTransportOptions) {}

  get lost(): boolean {
    return this.halted;
  }

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

    if (this.input === undefined || this.halted || this.shutdown) {
      return Promise.reject(
        new Error('The Machine Workspace MCP stream is closed.'),
      );
    }

    this.input.push(
      create(OpenSessionRequestSchema, {
        message: {
          case: 'jsonRpc',
          value: JSON.stringify(toJsonValue(message)),
        },
      }),
    );

    return Promise.resolve();
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;

    if (this.input !== undefined && !this.shutdown && !this.halted) {
      this.input.push(
        create(OpenSessionRequestSchema, {
          message: { case: 'protocolVersion', value: version },
        }),
      );
    }
  }

  async close(): Promise<void> {
    this.shutdown = true;
    this.diagnostics?.flush();
    this.streamController?.abort();
    this.input?.close();
    await this.reader?.return?.();
    this.releaseSession();
  }

  private async open(): Promise<void> {
    if (this.shutdown)
      throw new Error('The Machine Workspace MCP transport is closed.');
    this.options.signal?.throwIfAborted();

    const session = await this.options.connector.machineSession(
      this.options.machine,
    );

    this.session = session;

    if (this.shutdown) {
      this.releaseSession();

      return;
    }

    const input = new AsyncQueue<OpenSessionRequest>();
    const controller = new AbortController();
    this.input = input;
    this.streamController = controller;

    const openingController = new AbortController();
    const signal =
      this.options.signal === undefined
        ? AbortSignal.any([controller.signal, openingController.signal])
        : AbortSignal.any([
            this.options.signal,
            controller.signal,
            openingController.signal,
          ]);
    const openingTimer = setTimeout(
      () => openingController.abort(),
      this.options.envelope.budgetMs,
    );
    openingTimer.unref();

    try {
      const callOptions = session.callOptions({
        signal,
        envelope: this.options.envelope,
      });
      delete callOptions.timeoutMs;

      const reader = session.clients.mcp
        .openSession(input, callOptions)
        [Symbol.asyncIterator]();

      this.reader = reader;
      await this.openSession(input, reader);
    } catch (error) {
      input.close();
      await this.reader?.return?.();
      throw session.mapRefusal(error, true);
    } finally {
      clearTimeout(openingTimer);
    }
  }

  private async openSession(
    input: AsyncQueue<OpenSessionRequest>,
    reader: AsyncIterator<OpenSessionResponse>,
  ): Promise<void> {
    input.push(
      create(OpenSessionRequestSchema, {
        message: {
          case: 'open',
          value: { workspace: this.options.root, server: this.options.server },
        },
      }),
    );

    if (this.protocolVersion !== undefined) {
      input.push(
        create(OpenSessionRequestSchema, {
          message: { case: 'protocolVersion', value: this.protocolVersion },
        }),
      );
    }

    const first = await reader.next();

    if (first.done)
      throw new Error('The Machine closed the MCP stream before opening it.');
    const message = first.value.message;

    if (message.case === 'failure') {
      throw new Error(
        `The Machine MCP server is unavailable: ${message.value.message}`,
      );
    }

    if (message.case !== 'opened') {
      throw new Error('The Machine answered an unusable mcp.open response.');
    }

    this.learn(message.value.secrets?.values ?? []);
    this.published = true;
    void this.receiveStream(reader);
  }

  private async receiveStream(
    reader: AsyncIterator<OpenSessionResponse>,
  ): Promise<void> {
    try {
      while (true) {
        const next = await reader.next();

        if (next.done) {
          this.handleStreamEnd();

          return;
        }

        this.receive(next.value);
      }
    } catch (error) {
      let reported = error instanceof Error ? error : new Error(String(error));

      try {
        reported = this.session?.mapRefusal(error, true) ?? reported;
      } catch {
        // Preserve the receive error if refusal mapping itself fails.
      }

      this.fail(reported);
    }
  }

  private handleStreamEnd(): void {
    if (this.published && !this.shutdown) {
      this.fail(new Error('The Machine closed this Workspace MCP stream.'));
    }
  }

  private receive(response: OpenSessionResponse): void {
    const message = response.message;

    switch (message.case) {
      case 'jsonRpc': {
        let decoded: JSONRPCMessage;

        try {
          decoded = validateJSONRPCMessage(JSON.parse(message.value));
        } catch {
          this.fail(new Error('The Machine relayed invalid JSON-RPC text.'));

          return;
        }

        this.onmessage?.(decoded);

        return;
      }

      case 'stderr':
        this.appendDiagnostic(message.value);

        return;
      case 'secrets':
        this.learn(message.value.values);

        return;
      case 'failure':
        this.fail(
          new Error(`The Machine MCP server failed: ${message.value.message}`),
        );

        return;
      default:
        this.fail(
          new Error('The Machine sent an unexpected mcp.open response.'),
        );
    }
  }

  private fail(error: Error): void {
    if (this.halted || this.shutdown) return;
    this.halted = true;
    this.input?.close();
    const closing = this.reader?.return?.();

    if (closing !== undefined) void closing.catch(() => undefined);

    try {
      this.releaseSession();
    } catch {
      // Preserve the receive failure if session cleanup itself fails.
    }

    try {
      this.diagnostics?.flush();
    } catch {
      // Diagnostic consumers must not escape the detached receive loop.
    }

    try {
      this.onerror?.(error);
    } catch {
      // A consumer error handler must not escape the detached receive loop.
    }

    try {
      this.onclose?.();
    } catch {
      // Closing is best-effort after the failure has been delivered.
    }
  }

  private releaseSession(): void {
    const session = this.session;

    if (session === undefined || this.released) return;
    this.released = true;
    this.options.connector.releaseMachineSession(this.options.machine, session);
  }

  private learn(values: ReadonlyArray<string>): void {
    if (values.length === 0) return;
    this.values = normalizeProtectedValues([...this.values, ...values]);
    this.diagnostics = undefined;
  }

  private appendDiagnostic(text: string): void {
    this.diagnostics ??= new DiagnosticBuffer(this.values, (line) =>
      this.options.onDiagnostic?.(line),
    );
    this.diagnostics.append(text);
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
