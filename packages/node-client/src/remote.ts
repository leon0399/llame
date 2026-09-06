import {
  parseNodeRequest,
  queryParams,
  NODE_REQUEST_PATH,
  NODE_PRINCIPAL_HEADER,
  NODE_VERSION_HEADER,
  NODE_REQUEST_MAX_BYTES,
  NODE_RESULT_MAX_BYTES,
} from "@workspace/node-protocol";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import {
  type UnknownRecord,
  isRecord,
  isString,
} from "@workspace/runtime-safety";
import { type Credential } from "./auth";
import {
  request,
  readJson,
  sse,
  type SseFrame,
} from "@workspace/personal-node/http";
import { type AccountCursors, RemoteCursors } from "./remote-cursors";
import { type ClientOutput } from "./types";
import { SecretStream } from "@workspace/personal-node/output";
import { aborted, CliError } from "@workspace/personal-node/errors";
import {
  integer,
  jsonValue,
  parseJson,
  record,
  text,
  uuid,
  type JsonValue,
} from "@workspace/personal-node/validation";

const terminal = new Set(["completed", "failed", "cancelled", "expired"]);

type PullResult =
  | { kind: "return" }
  | { kind: "throw"; error: unknown }
  | { kind: "backoff"; cursor: number; notice: boolean };

/** Thin client: the server remains the advancing executor and policy owner. */
export class Remote {
  private readonly base: string;
  private readonly headers: { authorization: string };
  private readonly cursors: AccountCursors;
  private nextEffort?: string;
  private followState?: {
    readonly runId: string;
    readonly chatId: string;
    readonly stream: SecretStream;
  };
  constructor(
    private readonly credential: Credential,
    store: RemoteCursors,
    private readonly output: ClientOutput,
  ) {
    this.base = credential.authority;
    this.headers = { authorization: `Bearer ${credential.token}` };
    this.cursors = store.forAccount(this.base, credential.userId);
    output.protect([credential.token]);
  }

  get authority(): string {
    return this.base;
  }
  get principalId(): string {
    return this.credential.userId;
  }

  withEffort(effort: string | undefined): this {
    this.nextEffort = effort;
    return this;
  }

  /** Only the shared read contract crosses HTTP; local admin and execution IPC never do. */
  async call(
    method: string,
    params: UnknownRecord,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    if (method !== "core.describe") queryParams(method, params);
    const input = parseNodeRequest({
      jsonrpc: "2.0",
      id: randomUUID(),
      method,
      params,
    });
    const body = JSON.stringify(input);
    if (Buffer.byteLength(body) > NODE_REQUEST_MAX_BYTES)
      throw new CliError("request_limit", "Node request is too large.");
    const response = await request(
      this.base + NODE_REQUEST_PATH,
      {
        method: "POST",
        headers: {
          ...this.headers,
          "content-type": "application/json",
          [NODE_VERSION_HEADER]: "1",
          [NODE_PRINCIPAL_HEADER]: this.credential.userId,
        },
        body,
      },
      AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    );
    return this.nodeResult(
      record(
        await readJson(response, NODE_RESULT_MAX_BYTES + 4096),
        "Node response",
      ),
      input.id,
    );
  }

  private nodeResult(reply: UnknownRecord, id: string): JsonValue {
    if (
      reply.jsonrpc !== "2.0" ||
      reply.id !== id ||
      Object.hasOwn(reply, "error") === Object.hasOwn(reply, "result")
    ) {
      throw new CliError(
        "node_protocol",
        "Uncorrelated or invalid Node response.",
      );
    }
    if (reply.error !== undefined) {
      const error = record(reply.error, "Node error");
      const data = record(error.data, "Node error data");
      // Never display a remote exception/stack or echo untrusted method/parameters.
      throw new CliError(
        text(data.code, "error code", 100),
        "The selected Node rejected the request. Check its advertised capabilities and account.",
      );
    }
    return jsonValue(reply.result);
  }

  async json(
    path: string,
    signal: AbortSignal,
    method = "GET",
    body?: UnknownRecord,
  ): Promise<UnknownRecord> {
    return record(
      await readJson(
        await request(
          this.base + path,
          {
            method,
            headers: {
              ...this.headers,
              "content-type": "application/json",
              [NODE_VERSION_HEADER]: "1",
              [NODE_PRINCIPAL_HEADER]: this.credential.userId,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          },
          AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        ),
      ),
      "JSON response",
    );
  }

  async modelId(
    selected: string | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    const catalogue = record(
      await this.json("/api/v1/models", signal),
      "model catalogue",
    );
    const id = selected || text(catalogue.defaultModelId, "default model");
    if (
      !Array.isArray(catalogue.models) ||
      !catalogue.models.some((model) => isRecord(model) && model.id === id)
    ) {
      throw new CliError(
        "unknown_model",
        "Selected remote model is not available to this account.",
      );
    }
    return id;
  }

  async run(
    chat: string,
    prompt: string,
    selected: string | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    const chatId = uuid(chat);
    const messageId = randomUUID();
    const modelId = await this.modelId(selected, signal);
    const effort = this.nextEffort;
    this.nextEffort = undefined;
    const body = {
      modelId,
      message: { id: messageId, parts: [{ type: "text", text: prompt }] },
      ...(effort ? { effort } : undefined),
    };
    this.output.notice(`remote chat=${chatId} submission=${messageId}`);
    const runId = await this.admit(chatId, messageId, body, signal);
    this.output.notice(`remote run=${runId}`);
    this.cursors.save(runId, chatId, 0);
    await this.follow(runId, signal);
    return runId;
  }

  private async admit(
    chatId: string,
    messageId: string,
    body: UnknownRecord,
    signal: AbortSignal,
  ): Promise<string> {
    // Admission and event attachment are separate. Losing this response is
    // uncertain; never re-POST to a compatibility route or replay the message.
    try {
      const accepted = record(
        await this.json("/api/v1/runs", signal, "POST", { chatId, ...body }),
        "Run admission",
      );
      const runId = uuid(accepted.runId);
      if (accepted.chatId !== chatId || accepted.messageId !== messageId)
        throw new CliError(
          "admission_binding",
          "Run admission did not match the submitted message.",
        );
      return runId;
    } catch (error) {
      if (error instanceof CliError && /^http_4\d\d$/.test(error.code))
        throw error;
      throw new CliError(
        "submission_uncertain",
        `Submission outcome is uncertain. Inspect remote chat ${chatId}; use runs attach ${chatId} for its active run. The message was NOT resubmitted.`,
      );
    }
  }

  async attach(chatId: string, signal: AbortSignal): Promise<void> {
    const response = await request(
      `${this.base}/api/v1/chats/${uuid(chatId)}/stream`,
      { headers: this.headers },
      signal,
    );
    if (response.status === 204) {
      this.output.notice(
        "No active remote run. Inspect chats show for completed history.",
      );
      return;
    }
    let runId: string | undefined;
    for await (const frame of sse(response)) {
      if (frame.data === "[DONE]") break;
      const chunk = record(parseJson(frame.data), "UI stream chunk");
      if (chunk.type === "start") {
        runId = uuid(chunk.messageId);
        break;
      }
    }
    if (!runId)
      throw new CliError(
        "missing_run",
        "Remote active stream supplied no run ID.",
      );
    this.output.notice(`remote run=${runId}`);
    await this.follow(runId, signal);
  }

  async follow(
    runId: string,
    signal: AbortSignal,
    after?: number,
  ): Promise<void> {
    uuid(runId);
    const run = record(await this.json(`/api/v1/runs/${runId}`, signal), "run");
    this.followState = {
      runId,
      chatId: uuid(run.chatId),
      stream: new SecretStream([this.credential.token]),
    };
    try {
      await this.followLoop(after ?? this.cursors.cursor(runId), signal);
    } finally {
      this.followState = undefined;
    }
  }

  private async followLoop(cursor: number, signal: AbortSignal): Promise<void> {
    const runId = this.followState?.runId;
    if (!runId) return;
    let failures = 0;
    for (;;) {
      aborted(signal);
      const result = await this.pull(cursor, signal);
      if (result.kind === "return") return;
      if (result.kind === "throw") throw result.error;
      cursor = result.cursor;
      if (result.notice)
        this.output.notice(
          `Remote event connection interrupted; resume cursor=${cursor}.`,
        );
      failures++;
      if (failures > 5)
        throw new CliError(
          "stream_disconnected",
          `Remote run may continue. Resume with runs events ${runId}; no message was resubmitted.`,
        );
      await delay(Math.min(200 * 2 ** failures, 5000), undefined, { signal });
    }
  }

  private async pull(cursor: number, signal: AbortSignal): Promise<PullResult> {
    try {
      return await this.readSse(
        await this.eventRequest(cursor, signal),
        cursor,
        signal,
      );
    } catch (error) {
      aborted(signal);
      if (fatalStreamError(error)) return { kind: "throw", error };
      return { kind: "backoff", cursor, notice: true };
    }
  }

  private eventRequest(cursor: number, signal: AbortSignal): Promise<Response> {
    const state = this.followState;
    if (!state) throw new CliError("missing_run", "Remote follow has no run.");
    return request(
      `${this.base}/api/v1/runs/${state.runId}/events?after_sequence=${cursor}`,
      {
        headers: {
          ...this.headers,
          accept: "text/event-stream",
          "last-event-id": String(cursor),
        },
      },
      AbortSignal.any([signal, AbortSignal.timeout(320_000)]),
    );
  }

  private async readSse(
    response: Response,
    cursor: number,
    signal: AbortSignal,
  ): Promise<PullResult> {
    let done = false;
    for await (const frame of sse(response)) {
      if (frame.data === "[DONE]") {
        done = true;
        break;
      }
      const next = this.applyEvent(frame, cursor);
      if (next !== undefined) cursor = next;
    }
    if (!done) return { kind: "backoff", cursor, notice: false };
    return this.finishIfTerminal(cursor, signal);
  }

  private applyEvent(frame: SseFrame, cursor: number): number | undefined {
    const state = this.followState;
    if (!state) return undefined;
    const event = record(parseJson(frame.data), "run event");
    const sequence = integer(
      event.sequence,
      "event sequence",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    if (sequence <= cursor) return undefined;
    const eventType = text(event.eventType, "event type", 100);
    const payload =
      eventType === "model.delta" && isRecord(event.payload)
        ? this.deltaPayload(event.payload)
        : (event.payload ?? null);
    if (eventType !== "model.delta" || !isRecord(event.payload))
      this.noticePolicy(eventType);
    this.output.event({
      eventType,
      payload,
      sequence,
      runId: state.runId,
      chatId: state.chatId,
    });
    // Deliberate checkpoint AFTER rendering: a crash can replay one event
    // but cannot silently skip an unrendered event. --after 0 replays all.
    if (!state.stream.hasPending())
      this.cursors.save(state.runId, state.chatId, sequence);
    return sequence;
  }

  private deltaPayload(payload: UnknownRecord): UnknownRecord {
    const state = this.followState;
    if (!state || !isString(payload.text)) return payload;
    const safeText = state.stream.push(payload.text);
    this.output.text(safeText);
    return { ...payload, text: safeText };
  }

  private noticePolicy(eventType: string): void {
    if (eventType.startsWith("tool.") || eventType.includes("approval"))
      this.output.notice(`${eventType} (remote policy)`);
  }

  private async finishIfTerminal(
    cursor: number,
    signal: AbortSignal,
  ): Promise<PullResult> {
    const state = this.followState;
    if (!state) return { kind: "backoff", cursor, notice: false };
    const current = record(
      await this.json(`/api/v1/runs/${state.runId}`, signal),
      "run",
    );
    const status = text(current.status, "run status", 100);
    if (!terminal.has(status))
      return { kind: "backoff", cursor, notice: false };
    this.flushTail(cursor);
    if (status === "completed") return { kind: "return" };
    return {
      kind: "throw",
      error: new CliError(
        `run_${status}`,
        `Remote run ${state.runId} ${status}.`,
      ),
    };
  }

  private flushTail(cursor: number): void {
    const state = this.followState;
    if (!state) return;
    const tail = state.stream.push("", true);
    this.output.text(tail + "\n");
    if (tail)
      this.output.event({
        eventType: "client.text_flush",
        payload: { text: tail },
        runId: state.runId,
        chatId: state.chatId,
      });
    this.cursors.save(state.runId, state.chatId, cursor);
  }
}

function fatalStreamError(error: unknown): boolean {
  if (!(error instanceof CliError)) return false;
  return error.code !== "connection_failed" && !/^http_5\d\d$/.test(error.code);
}
