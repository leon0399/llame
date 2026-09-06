import { type UnknownRecord } from "@workspace/runtime-safety";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { connect } from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { type Readable, type Writable } from "node:stream";
import { isRecord, isString, isNumber } from "@workspace/runtime-safety";
import { CliError } from "@workspace/personal-node/errors";
import { privateDirectory } from "@workspace/personal-node/private-files";
import {
  assertPrivateSocket,
  socketPath,
  entryExists,
} from "@workspace/personal-node/socket";
import { JsonLines } from "@workspace/personal-node/json-lines";
import {
  MAX_RESPONSE_BYTES,
  NODE_PROTOCOL_VERSION,
  type NodeRequest,
} from "@workspace/personal-node/protocol";
import {
  jsonValue,
  record,
  text,
  uuid,
  type JsonValue,
} from "@workspace/personal-node/validation";
import { type Approval } from "@workspace/personal-node/types";
import { type LocalConnectionOptions } from "./types";
import { type ClientOutput } from "./types";

interface Pending {
  readonly method: string;
  readonly signal: AbortSignal;
  readonly resolve: (value: JsonValue) => void;
  readonly reject: (error: Error) => void;
  readonly abort: () => void;
  asking: boolean;
  cancellationTimer?: ReturnType<typeof setTimeout>;
}

/** Thin protocol client. Never opens SQLite, executes a tool, or resolves a key. */
export class NodeClient {
  private readonly pending = new Map<string, Pending>();
  private failure?: CliError;
  private exited?: Promise<void>;
  private child?: ChildProcessWithoutNullStreams;

  private constructor(
    input: Readable,
    private readonly writer: Writable,
    private readonly output: ClientOutput,
    private readonly approve: Approval,
  ) {
    this.watch(input);
  }

  private watch(input: Readable): void {
    const reader = new JsonLines(MAX_RESPONSE_BYTES, (value: unknown) => {
      if (!isRecord(value))
        throw new CliError("invalid_data", "Node response must be an object.");
      this.receive(value);
    });
    input.on("data", (data: Buffer) => {
      try {
        reader.push(data);
      } catch {
        this.fail(
          new CliError(
            "node_protocol",
            "Invalid response from the local Node.",
          ),
        );
      }
    });
    input.once("end", () =>
      this.fail(
        new CliError(
          "node_disconnected",
          "Local Node disconnected. Inspect Chats/Runs before retrying; no request was resubmitted.",
        ),
      ),
    );
    input.once("error", () =>
      this.fail(
        new CliError("node_disconnected", "Local Node connection failed."),
      ),
    );
    this.writer.on("error", () =>
      this.fail(
        new CliError("node_disconnected", "Local Node connection closed."),
      ),
    );
  }

  private bindChild(child: ChildProcessWithoutNullStreams): void {
    this.child = child;
    this.exited = new Promise((done) => child.once("close", () => done()));
    child.once("error", () =>
      this.fail(
        new CliError(
          "node_start_failed",
          "Could not launch the bundled personal Node. Build its workspace first.",
        ),
      ),
    );
    // Runtime diagnostics are deliberately generic; they never contain config or raw SDK errors.
    child.stderr.resume();
  }

  static connect(
    options: LocalConnectionOptions,
    env: NodeJS.ProcessEnv,
    output: ClientOutput,
    approve: Approval,
  ): NodeClient {
    privateDirectory(options.data);
    const path =
      process.platform === "win32"
        ? undefined
        : join(options.data, "node.sock");
    if (path && entryExists(path)) {
      assertPrivateSocket(path);
      const socket = connect(socketPath(options.data));
      return new NodeClient(socket, socket, output, approve);
    }
    if (entryExists(join(options.data, "node-server.json")))
      throw new CliError(
        "node_unavailable",
        "The configured local Node is starting or stopped uncleanly. Inspect it and use node recover; no other executor was selected.",
      );
    return NodeClient.launch(options, env, output, approve);
  }

  private static launch(
    options: LocalConnectionOptions,
    env: NodeJS.ProcessEnv,
    output: ClientOutput,
    approve: Approval,
  ): NodeClient {
    const args = [
      require.resolve("@workspace/node/server"),
      "--stdio",
      "--config",
      options.config,
      "--data-dir",
      options.data,
      "--cwd",
      options.cwd,
      ...(options.native ? ["--native"] : []),
    ];
    const child = spawn(process.execPath, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = new NodeClient(child.stdout, child.stdin, output, approve);
    client.bindChild(child);
    return client;
  }

  async open(signal: AbortSignal): Promise<NodeClient> {
    try {
      const hello = record(
        await this.call(
          "core.hello",
          { version: NODE_PROTOCOL_VERSION },
          AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        ),
        "Node hello",
      );
      if (
        hello.version !== NODE_PROTOCOL_VERSION ||
        hello.principal !== "local-owner" ||
        !isRecord(hello.modules) ||
        hello.modules.core !== 1
      ) {
        throw new CliError(
          "protocol_version",
          "Incompatible local Node protocol.",
        );
      }
      uuid(hello.nodeId);
      return this;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async call(
    method: string,
    params: UnknownRecord,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    if (signal.aborted)
      throw new CliError("cancelled", "Local request cancelled.", 130);
    if (this.failure) throw this.failure;
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel(id, method, reject);
      this.pending.set(id, {
        method,
        signal,
        resolve,
        reject,
        abort,
        asking: false,
      });
      signal.addEventListener("abort", abort, { once: true });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private cancel(
    id: string,
    method: string,
    reject: (error: Error) => void,
  ): void {
    this.send({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "core.cancel",
      params: { requestId: id },
    });
    const finish = () => {
      this.pending.delete(id);
      reject(
        new CliError(
          "cancelled",
          "Local request cancelled. Inspect its Run before retrying.",
          130,
        ),
      );
    };
    const pending = this.pending.get(id);
    // Keep receiving the durable terminal event before closing the channel.
    if (method === "execution.run" && pending)
      pending.cancellationTimer = setTimeout(finish, 5000);
    else finish();
  }

  private send(value: NodeRequest): void {
    if (!this.writer.destroyed && !this.writer.writableEnded)
      this.writer.write(JSON.stringify(value) + "\n");
  }

  private receive(value: UnknownRecord): void {
    if (value.jsonrpc !== "2.0")
      throw new CliError("node_protocol", "Expected JSON-RPC 2.0.");
    if (value.method === "core.error") {
      this.failCoreError(value);
      return;
    }
    if (value.method) {
      this.notification(
        text(value.method, "notification", 100),
        record(value.params, "params"),
      );
      return;
    }
    this.finish(value);
  }

  private failCoreError(frame: UnknownRecord): void {
    const error = record(frame.params, "Node error");
    this.fail(
      new CliError(
        text(error.code, "code", 100),
        text(error.message, "message", 1000),
      ),
    );
  }

  private finish(frame: UnknownRecord): void {
    const id = text(frame.id, "response id", 100);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.cancellationTimer);
    pending.signal.removeEventListener("abort", pending.abort);
    if (frame.error !== undefined) {
      pending.reject(rpcError(frame));
      return;
    }
    if (pending.signal.aborted)
      pending.reject(
        new CliError("cancelled", "Local request cancelled.", 130),
      );
    else pending.resolve(jsonValue(frame.result));
  }

  private notification(method: string, params: UnknownRecord): void {
    const pending = this.pending.get(text(params.requestId, "request id", 100));
    if (!pending || pending.method !== "execution.run") return;
    if (method === "execution.approval.requested") {
      this.ask(pending, params);
      return;
    }
    if (method !== "execution.output")
      throw new CliError("node_protocol", "Unknown Node notification.");
    this.emitOutput(params);
  }

  private ask(pending: Pending, params: UnknownRecord): void {
    if (pending.asking)
      throw new CliError(
        "approval_overlap",
        "Node sent overlapping approval requests.",
      );
    pending.asking = true;
    const id = uuid(params.approvalId);
    const prompt = text(params.prompt, "approval prompt", 262_144);
    void this.approve(prompt, pending.signal)
      .then((approved) =>
        this.call(
          "execution.approval.decide",
          { approvalId: id, approved },
          pending.signal,
        ),
      )
      .catch(() => undefined)
      .finally(() => {
        pending.asking = false;
      });
  }

  private emitOutput(params: UnknownRecord): void {
    if (params.kind === "text" && isString(params.value)) {
      this.output.text(params.value);
      return;
    }
    if (params.kind === "notice" && isString(params.value)) {
      this.output.notice(params.value);
      return;
    }
    if (params.kind !== "event")
      throw new CliError("node_protocol", "Invalid Node output notification.");
    const event = record(params.value, "event");
    this.output.event({
      eventType: text(event.eventType, "eventType", 100),
      payload: jsonValue(event.payload),
      runId: event.runId === undefined ? undefined : uuid(event.runId),
      chatId: event.chatId === undefined ? undefined : uuid(event.chatId),
      sequence: isNumber(event.sequence) ? event.sequence : undefined,
    });
  }

  private fail(error: CliError): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.cancellationTimer);
      pending.signal.removeEventListener("abort", pending.abort);
      pending.reject(this.failure);
    }
    this.pending.clear();
  }

  async close(): Promise<void> {
    this.writer.end();
    if (!this.child || !this.exited) return;
    const terminate = setTimeout(() => this.child?.kill("SIGTERM"), 3000);
    const kill = setTimeout(() => this.child?.kill("SIGKILL"), 5000);
    await this.exited;
    clearTimeout(terminate);
    clearTimeout(kill);
  }
}

function rpcError(frame: UnknownRecord): CliError {
  const error = record(frame.error, "error");
  const data = record(error.data, "error data");
  return new CliError(
    text(data.code, "code", 100),
    text(error.message, "error message", 2000),
    exitCode(data.exitCode),
  );
}

function exitCode(value: unknown): number {
  if (!isNumber(value)) return 1;
  if (!Number.isInteger(value) || value <= 0 || value > 255) return 1;
  return value;
}
