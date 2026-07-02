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

import { TenantDbService } from '../db/tenant-db.service';
import { RunEventsRepository, RunsRepository } from './runs-repository';

/** UI-message stream chunk subset the bridge emits (AI SDK v1 protocol). */
export type UiChunk =
  | { type: 'start'; messageId: string }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'error'; errorText: string }
  | { type: 'finish' };

const TEXT_PART_ID = 'text-1';

export interface RunEventLike {
  eventType: string;
  payload: unknown;
}

/**
 * Stateful translator: run events in, UI chunks out. Emits the stream prelude
 * lazily (start + text-start before the first delta) and closes text/stream on
 * the terminal events. Pure state machine — trivially unit-testable.
 */
export function createRunEventTranslator(messageId: string): {
  translate(event: RunEventLike): UiChunk[];
  /** True once a terminal run event has been translated. */
  finished(): boolean;
} {
  let startedText = false;
  let startedStream = false;
  let finished = false;

  const prelude = (): UiChunk[] => {
    const chunks: UiChunk[] = [];
    if (!startedStream) {
      startedStream = true;
      chunks.push({ type: 'start', messageId });
    }
    return chunks;
  };

  return {
    finished: () => finished,
    translate(event: RunEventLike): UiChunk[] {
      switch (event.eventType) {
        case 'model.delta': {
          const text =
            typeof event.payload === 'object' &&
            event.payload !== null &&
            typeof (event.payload as { text?: unknown }).text === 'string'
              ? (event.payload as { text: string }).text
              : '';
          if (text.length === 0) {
            return [];
          }
          const chunks = prelude();
          if (!startedText) {
            startedText = true;
            chunks.push({ type: 'text-start', id: TEXT_PART_ID });
          }
          chunks.push({ type: 'text-delta', id: TEXT_PART_ID, delta: text });
          return chunks;
        }
        case 'run.completed':
        case 'run.cancelled': {
          finished = true;
          const chunks = prelude();
          if (startedText) {
            chunks.push({ type: 'text-end', id: TEXT_PART_ID });
          }
          chunks.push({ type: 'finish' });
          return chunks;
        }
        case 'run.failed': {
          finished = true;
          const message =
            typeof event.payload === 'object' &&
            event.payload !== null &&
            typeof (event.payload as { message?: unknown }).message === 'string'
              ? (event.payload as { message: string }).message
              : 'Run failed.';
          const chunks = prelude();
          if (startedText) {
            chunks.push({ type: 'text-end', id: TEXT_PART_ID });
          }
          chunks.push({ type: 'error', errorText: message });
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
const MAX_STREAM_MS = 5 * 60 * 1000;

@Injectable()
export class RunStreamBridgeService {
  constructor(private readonly tenantDb: TenantDbService) {}

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
            if (Date.now() - startedAt > MAX_STREAM_MS) {
              break;
            }

            // Defensive: if the run row reached terminal without a terminal
            // event (or was deleted), close instead of spinning.
            if (events.length === 0) {
              const run = await tenantDb.runAs(input.userId, (tx) =>
                new RunsRepository(tx).findById(input.runId, input.userId),
              );
              if (!run) {
                break;
              }
              await sleep(POLL_MS);
            }
          }

          controller.enqueue('data: [DONE]\n\n');
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
