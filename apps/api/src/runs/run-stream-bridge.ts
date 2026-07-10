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

function payloadString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function payloadNumber(payload: unknown, key: string): number | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
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
export function createRunEventTranslator(messageId: string): {
  translate(event: RunEventLike): UiChunk[];
  /** True once a terminal run event has been translated. */
  finished(): boolean;
} {
  let startedStream = false;
  let finished = false;
  // Each contiguous run of text/reasoning is its own UI part (text-1, text-2, …
  // / reasoning-1, …), so a tool part can sit between them. text and reasoning
  // are mutually exclusive: opening one closes the other, so parts never
  // interleave, and either can re-open (e.g. a reasoning model that thinks,
  // answers, then thinks again). null when no part of that kind is open.
  let textPartCount = 0;
  let openTextId: string | null = null;
  let reasoningPartCount = 0;
  let openReasoningId: string | null = null;

  const prelude = (): UiChunk[] => {
    if (startedStream) {
      return [];
    }
    startedStream = true;
    return [{ type: 'start', messageId }];
  };

  const closeText = (): UiChunk[] => {
    if (openTextId === null) {
      return [];
    }
    const chunk: UiChunk = { type: 'text-end', id: openTextId };
    openTextId = null;
    return [chunk];
  };

  const closeReasoning = (): UiChunk[] => {
    if (openReasoningId === null) {
      return [];
    }
    const chunk: UiChunk = { type: 'reasoning-end', id: openReasoningId };
    openReasoningId = null;
    return [chunk];
  };

  return {
    finished: () => finished,
    translate(event: RunEventLike): UiChunk[] {
      switch (event.eventType) {
        case 'model.delta': {
          const text = payloadString(event.payload, 'text') ?? '';
          if (text.length === 0) {
            return [];
          }
          const chunks = [...prelude(), ...closeReasoning()];
          if (openTextId === null) {
            textPartCount += 1;
            openTextId = `text-${textPartCount}`;
            chunks.push({ type: 'text-start', id: openTextId });
          }
          chunks.push({ type: 'text-delta', id: openTextId, delta: text });
          return chunks;
        }
        case 'reasoning.delta': {
          const text = payloadString(event.payload, 'text') ?? '';
          if (text.length === 0) {
            return [];
          }
          const chunks = [...prelude(), ...closeText()];
          if (openReasoningId === null) {
            reasoningPartCount += 1;
            openReasoningId = `reasoning-${reasoningPartCount}`;
            chunks.push({ type: 'reasoning-start', id: openReasoningId });
          }
          chunks.push({
            type: 'reasoning-delta',
            id: openReasoningId,
            delta: text,
          });
          return chunks;
        }
        case 'model.completed': {
          // Surface the per-turn telemetry (tokens + cost + latency + model) as
          // message metadata so the UI can show it live and on resume — useChat
          // lands `messageMetadata` on `message.metadata`. Not terminal — the
          // stream still finishes on the following run.completed/cancelled.
          const telemetry =
            typeof event.payload === 'object' && event.payload !== null
              ? (event.payload as { telemetry?: unknown }).telemetry
              : undefined;
          if (telemetry === undefined) {
            // Legacy event predating telemetry — nothing to surface.
            return [];
          }
          // Close whichever part (text or reasoning) is open first so metadata
          // lands after the answer; run.completed's own close becomes a no-op.
          const chunks = [...prelude(), ...closeReasoning(), ...closeText()];
          chunks.push({
            type: 'message-metadata',
            messageMetadata: { usage: telemetry },
          });
          return chunks;
        }
        case 'tool.requested': {
          const toolCallId = payloadString(event.payload, 'toolCallId');
          const toolName = payloadString(event.payload, 'toolName');
          if (!toolCallId || !toolName) {
            return [];
          }
          const input =
            typeof event.payload === 'object' && event.payload !== null
              ? (event.payload as { input?: unknown }).input
              : undefined;
          // Close whichever part (text or reasoning) is open first, same as
          // model.completed/the terminal events — a tool call is a structurally
          // distinct part, so neither should stay open across it.
          return [
            ...prelude(),
            ...closeReasoning(),
            ...closeText(),
            {
              type: 'tool-input-available',
              toolCallId,
              toolName,
              input,
              dynamic: true,
            },
          ];
        }
        // 'tool.started' has no UI representation of its own — the
        // 'tool-input-available' chunk already put the part in the "running"
        // state (tool-call-part.tsx's toolActivityStatus maps input-available
        // -> "running"); a distinct started event exists for the durable
        // request/started/completed trace, not for the live stream.
        case 'tool.started':
          return [];
        case 'tool.completed': {
          const toolCallId = payloadString(event.payload, 'toolCallId');
          if (!toolCallId) {
            return [];
          }
          const status = payloadString(event.payload, 'status');
          const output =
            typeof event.payload === 'object' && event.payload !== null
              ? (event.payload as { output?: unknown }).output
              : undefined;
          // A structured tool error (status: 'error' — refused, invalid
          // input, timeout, or a caught throw, per runner.ts) maps to the
          // AI SDK's own `tool-output-error` chunk, not `tool-output-available`
          // — otherwise the live view would show "done" for a failed call.
          if (status === 'error') {
            const errorText =
              typeof output === 'object' &&
              output !== null &&
              typeof (output as { message?: unknown }).message === 'string'
                ? (output as { message: string }).message
                : 'The tool failed.';
            return [
              ...prelude(),
              {
                type: 'tool-output-error',
                toolCallId,
                errorText,
                dynamic: true,
              },
            ];
          }
          return [
            ...prelude(),
            {
              type: 'tool-output-available',
              toolCallId,
              output,
              dynamic: true,
            },
          ];
        }
        case 'run.step_cap_reached': {
          const stepsUsed = payloadNumber(event.payload, 'stepsUsed');
          const maxSteps = payloadNumber(event.payload, 'maxSteps');
          if (stepsUsed === undefined || maxSteps === undefined) {
            return [];
          }
          // Close whichever part is open, same as a tool call — the cap
          // notice is a structurally distinct part.
          return [
            ...prelude(),
            ...closeReasoning(),
            ...closeText(),
            {
              type: 'data-cap-notice',
              data: { stepsUsed, maxSteps },
            },
          ];
        }
        case 'run.completed':
        case 'run.cancelled': {
          finished = true;
          return [
            ...prelude(),
            ...closeReasoning(),
            ...closeText(),
            { type: 'finish' },
          ];
        }
        case 'run.expired':
        case 'run.failed': {
          finished = true;
          const message =
            payloadString(event.payload, 'message') ?? 'Run failed.';
          const chunks = [...prelude(), ...closeReasoning(), ...closeText()];
          if (payloadString(event.payload, 'status') === 'cancelled') {
            chunks.push({ type: 'finish' });
          } else {
            chunks.push({ type: 'error', errorText: message });
          }
          return chunks;
        }
        // Lifecycle bookkeeping with no UI representation.
        default:
          return [];
      }
    },
  };
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
    const { tenantDb } = this;
    const translator = createRunEventTranslator(input.runId);
    const maxStreamMs = this.maxStreamMs();
    const startedAt = Date.now();
    let cursor = 0;

    const stream = new ReadableStream<string>({
      start: async (controller) => {
        const emit = (chunk: UiChunk) =>
          controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);

        try {
          for (;;) {
            const events = await tenantDb.runAs(input.userId, (tx) =>
              new RunEventsRepository(tx).listByRunId(
                input.runId,
                input.userId,
                { afterSequence: cursor },
              ),
            );
            for (const event of events) {
              cursor = event.sequence;
              for (const chunk of translator.translate(event)) {
                emit(chunk);
              }
            }

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
            if (events.length === 0) {
              const run = await tenantDb.runAs(input.userId, (tx) =>
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
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalRunStatus(status: string): boolean {
  return ['completed', 'failed', 'cancelled', 'expired'].includes(status);
}
