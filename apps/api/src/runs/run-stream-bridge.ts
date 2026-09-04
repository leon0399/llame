import { toolTerminationMessage } from './tool-settlement';
/**
 * Run-event → AI SDK UI-message stream bridge (#50, SPEC §9.4/§9.5).
 *
 * In worker mode the API request thread no longer holds the model stream — the
 * worker executes the run and persists run_events; this bridge replays those
 * events to the HTTP client in the AI SDK UI-message SSE protocol (v1), so the
 * existing apps/web chat transport works unchanged. A client disconnect stops
 * only the bridge; the run keeps executing — that is the durability win.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TenantDbService } from '../db/tenant-db.service';
import { isNumber, isRecord, isString } from '../unknown-record';
import { RunEventsRepository, RunsRepository } from './runs-repository';

/** UI-message stream chunk subset the bridge emits (AI SDK v1 protocol). */
export type UiChunk =
  | { type: 'start'; messageId: string }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'message-metadata'; messageMetadata: unknown }
  | {
      type: 'tool-input-available';
      toolCallId: string;
      toolName: string;
      input: unknown;
      dynamic: true;
    }
  | {
      type: 'tool-output-available';
      toolCallId: string;
      output: unknown;
      dynamic: true;
    }
  | {
      type: 'tool-output-error';
      toolCallId: string;
      errorText: string;
      providerMetadata?: { llame: { cancelled: true } };
      dynamic: true;
    }
  | {
      type: 'data-cap-notice';
      data: { stepsUsed: number; maxSteps: number };
    }
  | { type: 'error'; errorText: string }
  | { type: 'finish' };

export interface RunEventLike {
  eventType: string;
  payload: unknown;
}

/** Raw field off an unknown object payload — the one null-guard every reader shares. */
function payloadField(payload: unknown, key: string) {
  if (!isRecord(payload)) {
    return undefined;
  }
  return payload[key];
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- delegates directly to `payloadField` above, which validates via `!isRecord(payload)` as its own first statement; bare-identifier delegation, not itself a validating call.
function payloadString(payload: unknown, key: string): string | undefined {
  const value = payloadField(payload, key);
  return isString(value) ? value : undefined;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- delegates directly to `payloadField` above, which validates via `!isRecord(payload)` as its own first statement; bare-identifier delegation, not itself a validating call.
function payloadNumber(payload: unknown, key: string): number | undefined {
  const value = payloadField(payload, key);
  return isNumber(value) ? value : undefined;
}

/**
 * Stateful translator: run events in, UI chunks out. Emits the stream prelude
 * lazily and closes text/reasoning/stream on the terminal events. Reasoning
 * ("thinking") deltas render as their own part, mutually exclusive with
 * text — opening one closes the other, so the UI renders ordered parts
 * (reasoning → text → reasoning → …) rather than merging the two. Tool events
 * become `dynamic-tool` UI parts (tool.call → tool-input-available,
 * tool.result → tool-output-available), correlated by toolCallId. A tool part
 * closes the open text part first, so the UI renders ordered parts
 * (text → tool → text) rather than merging text across the tool boundary.
 * Pure state machine — trivially unit-testable.
 */
export type RunEventTranslator = {
  translate(event: RunEventLike): Array<UiChunk>;
  /** True once a terminal run event has been translated. */
  finished(): boolean;
};

/**
 * Stateful implementation of `RunEventTranslator`. A class rather than a
 * closure factory so each event-type handler is its own method — a real
 * responsibility boundary the closure form couldn't express without either
 * one giant switch or threading every field through free functions.
 */
class RunEventTranslatorImpl implements RunEventTranslator {
  private startedStream = false;
  private isFinished = false;
  // Each contiguous run of text/reasoning is its own UI part (text-1, text-2, …
  // / reasoning-1, …), so a tool part can sit between them. text and reasoning
  // are mutually exclusive: opening one closes the other, so parts never
  // interleave, and either can re-open (e.g. a reasoning model that thinks,
  // answers, then thinks again). null when no part of that kind is open.
  private textPartCount = 0;
  private openTextId: string | null = null;
  private reasoningPartCount = 0;
  private openReasoningId: string | null = null;
  // Tool calls whose result has not arrived. A terminal run event must settle
  // these: `tool-input-available` renders as "running", so finishing without
  // closing them leaves the UI spinning on a call that will never complete.
  private readonly openToolCallIds = new Set<string>();

  constructor(private readonly messageId: string) {}

  finished(): boolean {
    return this.isFinished;
  }

  private prelude(): Array<UiChunk> {
    if (this.startedStream) {
      return [];
    }
    this.startedStream = true;
    return [{ type: 'start', messageId: this.messageId }];
  }

  private closeText(): Array<UiChunk> {
    if (this.openTextId === null) {
      return [];
    }
    const chunk: UiChunk = { type: 'text-end', id: this.openTextId };
    this.openTextId = null;
    return [chunk];
  }

  private closeReasoning(): Array<UiChunk> {
    if (this.openReasoningId === null) {
      return [];
    }
    const chunk: UiChunk = { type: 'reasoning-end', id: this.openReasoningId };
    this.openReasoningId = null;
    return [chunk];
  }

  private settleOpenTools(reason: string): Array<UiChunk> {
    const chunks: Array<UiChunk> = [];
    for (const toolCallId of this.openToolCallIds) {
      chunks.push({
        type: 'tool-output-error',
        toolCallId,
        errorText: reason,
        providerMetadata: { llame: { cancelled: true } },
        dynamic: true,
      });
    }
    this.openToolCallIds.clear();
    return chunks;
  }

  translate(event: RunEventLike): Array<UiChunk> {
    switch (event.eventType) {
      case 'model.delta':
        return this.onModelDelta(event);
      case 'reasoning.delta':
        return this.onReasoningDelta(event);
      case 'model.completed':
        return this.onModelCompleted(event);
      case 'tool.requested':
        return this.onToolRequested(event);
      // 'tool.started' has no UI representation of its own — the
      // 'tool-input-available' chunk already put the part in the "running"
      // state (tool-call-part.tsx's toolActivityStatus maps input-available
      // -> "running"); a distinct started event exists for the durable
      // request/started/completed trace, not for the live stream.
      case 'tool.started':
        return [];
      case 'tool.completed':
        return this.onToolCompleted(event);
      case 'run.step_cap_reached':
        return this.onStepCapReached(event);
      case 'run.completed':
      case 'run.cancelled':
        return this.onRunTerminated(event);
      case 'run.expired':
      case 'run.failed':
        return this.onRunFailed(event);
      // Lifecycle bookkeeping with no UI representation.
      default:
        return [];
    }
  }

  private onModelDelta(event: RunEventLike): Array<UiChunk> {
    const text = payloadString(event.payload, 'text') ?? '';
    if (text.length === 0) {
      return [];
    }
    const chunks = [...this.prelude(), ...this.closeReasoning()];
    if (this.openTextId === null) {
      this.textPartCount += 1;
      this.openTextId = `text-${this.textPartCount}`;
      chunks.push({ type: 'text-start', id: this.openTextId });
    }
    chunks.push({ type: 'text-delta', id: this.openTextId, delta: text });
    return chunks;
  }

  private onReasoningDelta(event: RunEventLike): Array<UiChunk> {
    const text = payloadString(event.payload, 'text') ?? '';
    if (text.length === 0) {
      return [];
    }
    const chunks = [...this.prelude(), ...this.closeText()];
    if (this.openReasoningId === null) {
      this.reasoningPartCount += 1;
      this.openReasoningId = `reasoning-${this.reasoningPartCount}`;
      chunks.push({ type: 'reasoning-start', id: this.openReasoningId });
    }
    chunks.push({
      type: 'reasoning-delta',
      id: this.openReasoningId,
      delta: text,
    });
    return chunks;
  }

  private onModelCompleted(event: RunEventLike): Array<UiChunk> {
    // Surface the per-turn telemetry (tokens + cost + latency + model) as
    // message metadata so the UI can show it live and on resume — useChat
    // lands `messageMetadata` on `message.metadata`. Not terminal — the
    // stream still finishes on the following run.completed/cancelled.
    const telemetry = payloadField(event.payload, 'telemetry');
    if (telemetry === undefined) {
      // Legacy event predating telemetry — nothing to surface.
      return [];
    }
    // Close whichever part (text or reasoning) is open first so metadata
    // lands after the answer; run.completed's own close becomes a no-op.
    const chunks = [
      ...this.prelude(),
      ...this.closeReasoning(),
      ...this.closeText(),
    ];
    chunks.push({
      type: 'message-metadata',
      messageMetadata: { usage: telemetry },
    });
    return chunks;
  }

  private onToolRequested(event: RunEventLike): Array<UiChunk> {
    const toolCallId = payloadString(event.payload, 'toolCallId');
    const toolName = payloadString(event.payload, 'toolName');
    if (!toolCallId || !toolName) {
      return [];
    }
    const input = payloadField(event.payload, 'input');
    this.openToolCallIds.add(toolCallId);
    // Close whichever part (text or reasoning) is open first, same as
    // model.completed/the terminal events — a tool call is a structurally
    // distinct part, so neither should stay open across it.
    return [
      ...this.prelude(),
      ...this.closeReasoning(),
      ...this.closeText(),
      {
        type: 'tool-input-available',
        toolCallId,
        toolName,
        input,
        dynamic: true,
      },
    ];
  }

  private onToolCompleted(event: RunEventLike): Array<UiChunk> {
    const toolCallId = payloadString(event.payload, 'toolCallId');
    // At-most-once: if this call was already settled (by termination or a
    // prior event), a late completion must not emit a second outcome.
    // openToolCallIds tracks open calls; absence means already settled.
    if (!toolCallId || !this.openToolCallIds.delete(toolCallId)) {
      return [];
    }
    const status = payloadString(event.payload, 'status');
    const output = payloadField(event.payload, 'output');
    if (status !== 'error') {
      return [
        ...this.prelude(),
        { type: 'tool-output-available', toolCallId, output, dynamic: true },
      ];
    }
    const isCancelled = isRecord(output) && output.type === 'cancelled';
    const errorText =
      isRecord(output) && isString(output.message)
        ? output.message
        : 'The tool failed.';
    return [
      ...this.prelude(),
      {
        type: 'tool-output-error',
        toolCallId,
        errorText,
        ...(isCancelled && {
          providerMetadata: { llame: { cancelled: true as const } },
        }),
        dynamic: true,
      },
    ];
  }

  private onStepCapReached(event: RunEventLike): Array<UiChunk> {
    const stepsUsed = payloadNumber(event.payload, 'stepsUsed');
    const maxSteps = payloadNumber(event.payload, 'maxSteps');
    if (stepsUsed === undefined || maxSteps === undefined) {
      return [];
    }
    // Close whichever part is open, same as a tool call — the cap
    // notice is a structurally distinct part.
    return [
      ...this.prelude(),
      ...this.closeReasoning(),
      ...this.closeText(),
      {
        type: 'data-cap-notice',
        data: { stepsUsed, maxSteps },
      },
    ];
  }

  private onRunTerminated(event: RunEventLike): Array<UiChunk> {
    this.isFinished = true;
    return [
      ...this.prelude(),
      ...this.closeReasoning(),
      ...this.closeText(),
      ...this.settleOpenTools(
        toolTerminationMessage(
          event.eventType === 'run.cancelled' ? 'cancelled' : 'failed',
        ),
      ),
      { type: 'finish' },
    ];
  }

  private onRunFailed(event: RunEventLike): Array<UiChunk> {
    this.isFinished = true;
    const message = payloadString(event.payload, 'message') ?? 'Run failed.';
    const chunks = [
      ...this.prelude(),
      ...this.closeReasoning(),
      ...this.closeText(),
      ...this.settleOpenTools(
        toolTerminationMessage(
          event.eventType === 'run.expired' ? 'expired' : 'failed',
        ),
      ),
    ];
    chunks.push({ type: 'error', errorText: message });
    return chunks;
  }
}

export function createRunEventTranslator(
  messageId: string,
): RunEventTranslator {
  return new RunEventTranslatorImpl(messageId);
}

const POLL_MS = 200;
/** Default hard cap on one bridge connection; override via RUN_STREAM_MAX_MS. */
const DEFAULT_MAX_STREAM_MS = 5 * 60 * 1000;

@Injectable()
export class RunStreamBridgeService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly config: ConfigService,
  ) {}

  private maxStreamMs(): number {
    const raw = Number(this.config.get<string>('RUN_STREAM_MAX_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_STREAM_MS;
  }

  /**
   * Build the SSE Response for a freshly enqueued run. Polls run_events by
   * cursor until the run is terminal, translating to UI-message chunks. The
   * `messageId` in the start chunk is the run id — a client-side surrogate;
   * reloads read real message ids from history.
   */
  createUiMessageStreamResponse(input: {
    runId: string;
    userId: string;
    abortSignal?: AbortSignal;
  }): Response {
    const translator = createRunEventTranslator(input.runId);
    const maxStreamMs = this.maxStreamMs();

    const stream = new ReadableStream<string>({
      start: async (controller) => {
        try {
          await this.pumpUiMessageEvents({
            controller,
            input,
            translator,
            maxStreamMs,
          });
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream.pipeThrough(new TextEncoderStream()), {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-vercel-ai-ui-message-stream': 'v1',
      },
    });
  }

  /** Fetches events past `cursor`, translates each, and emits its UI chunks. */
  private async drainAndTranslate(options: {
    runId: string;
    userId: string;
    cursor: number;
    translator: RunEventTranslator;
    emit: (chunk: UiChunk) => void;
  }): Promise<{ cursor: number; count: number }> {
    const { runId, userId, cursor, translator, emit } = options;
    const events = await this.tenantDb.runAs(userId, (tx) =>
      new RunEventsRepository(tx).listByRunId(runId, userId, {
        afterSequence: cursor,
      }),
    );
    let nextCursor = cursor;
    for (const event of events) {
      nextCursor = event.sequence;
      for (const chunk of translator.translate(event)) {
        emit(chunk);
      }
    }
    return { cursor: nextCursor, count: events.length };
  }

  /**
   * The event-poll loop backing `createUiMessageStreamResponse`, split out so
   * the caller's try/catch isn't itself one more nesting level around every
   * branch below.
   */
  private async pumpUiMessageEvents(options: {
    controller: ReadableStreamDefaultController<string>;
    input: { runId: string; userId: string; abortSignal?: AbortSignal };
    translator: RunEventTranslator;
    maxStreamMs: number;
  }): Promise<void> {
    const { controller, input, translator, maxStreamMs } = options;
    const startedAt = Date.now();
    let cursor = 0;
    const emit = (chunk: UiChunk) =>
      controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);

    for (;;) {
      if (input.abortSignal?.aborted) {
        controller.close();
        return;
      }
      const drained = await this.drainAndTranslate({
        runId: input.runId,
        userId: input.userId,
        cursor,
        translator,
        emit,
      });
      cursor = drained.cursor;

      if (translator.finished()) {
        break;
      }
      if (input.abortSignal?.aborted) {
        // Client is gone — stop bridging. The run keeps executing.
        controller.close();
        return;
      }
      if (Date.now() - startedAt > maxStreamMs) {
        // The cap is a bridge limit, not a run outcome — tell the
        // client explicitly instead of closing mid-'streaming' (the
        // resume-by-cursor UX lands with the web slice, #49).
        emit({
          type: 'error',
          errorText:
            'Stream window elapsed; the run is still executing. Reload to see the result.',
        });
        break;
      }

      // Defensive: if the run row reached terminal without a terminal
      // event (or was deleted), close instead of spinning.
      if (drained.count === 0) {
        const run = await this.tenantDb.runAs(input.userId, (tx) =>
          new RunsRepository(tx).findById(input.runId, input.userId),
        );
        if (!run || isTerminalRunStatus(run.status)) {
          break;
        }
      }
      // Floor delay on EVERY non-terminal pass — an actively streaming
      // run yields events on each poll, and without the floor this loop
      // re-queries the DB back-to-back for the whole stream.
      await sleep(POLL_MS);
      if (input.abortSignal?.aborted) {
        controller.close();
        return;
      }
    }

    if (translator.finished()) {
      controller.enqueue('data: [DONE]\n\n');
    }
    controller.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalRunStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'expired'].includes(status);
}

/**
 * The only capability a caller needs to answer a turn. Narrower than the whole
 * service on purpose: `RunStreamBridgeService` has private fields, so a
 * structural stub can never satisfy it and every test faking it needs a cast.
 */
export type RunStreamResponder = Pick<
  RunStreamBridgeService,
  'createUiMessageStreamResponse'
>;
