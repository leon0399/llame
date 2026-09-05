/**
 * Assistant transcript building (#48/#49/#50, design D5/D6) — turns the live
 * stream of model/tool events into the exact `MessagePart[]` llame persists
 * on an assistant message, and rebuilds that same transcript from the
 * append-only `run_events` log when execution wasn't the one settling the
 * run.
 *
 * Two producers share this vocabulary: `createAssistantPartCollector` is fed
 * live during `RunExecutionService#executeRun`'s stream callbacks, and
 * `reconstructDurableAssistant` replays a persisted event log (used by
 * `finishRun` when a run terminalizes without its own in-memory turn, e.g.
 * dead-letter expiry). Both go through the same `toolActivityPart` shaping
 * and the same occurrence-order rules, so a durable-replayed transcript and a
 * live-collected one are indistinguishable to the UI.
 *
 * Deliberately DB-free and side-effect-free: every function here is a pure
 * transform over events/deltas, which is what makes it unit-testable without
 * the full executeRun path (see `chats/reasoning-parts.test.ts`).
 */
import { isNumber, isRecord, isString } from '../unknown-record';
import { type RunEvent } from '../db/schema';
import { type MessagePart } from '../chats/context-builder';
import { normalizeToolObservationOutcome } from '../chats/tool-observation-part';
import { type ToolResult } from '../tools/types';
import { separateGluedReasoningBlocks } from './reasoning-summaries';

/**
 * Cap on persisted reasoning text. Reasoning is display-only (stripped from
 * model context), so this bounds storage + the per-turn context-read cost (each
 * build reads every message's parts) without affecting what the model sees.
 */
export const REASONING_PERSIST_MAX = 24_000;

/**
 * A persisted tool-activity part (design D5, AI SDK tool-part vocabulary):
 * `type: "tool-<name>"`, correlated by `toolCallId`, settled state only
 * (`output-available` | `output-error` — no `input-streaming`/`input-available`
 * snapshot is persisted; results are atomic in this slice, D5). Built by both
 * the genuine-execution path (runTool) and the unavailable/hallucinated-call
 * refusal path (onUnavailableToolCall), so both render through the exact same
 * `ToolCallPart` component web-side.
 */
export type ToolActivityPart = {
  type: `tool-${string}`;
  toolCallId: string;
  state: 'output-available' | 'output-error';
  input: unknown;
  output?: unknown;
  errorText?: string;
  /** Provider-portable structured outcome: success or the ToolResult error type. */
  outcome: string;
  /** SDK-supported result metadata marking an error produced by run termination
   *  rather than by the tool itself. Persisted so the UI can render
   *  "Cancelled" without parsing error text, and survives the live transport. */
  resultProviderMetadata?: { llame: { cancelled: true } };
};

/** The step-cap marker part (design D6): `type: "data-cap-notice"`, AI SDK
 * v6 data-part shape (payload nested under `.data`) so the SAME part renders
 * live (bridge → `data-cap-notice` stream chunk) and from history. */
export type CapNoticePart = {
  type: 'data-cap-notice';
  data: { stepsUsed: number; maxSteps: number };
};

type PendingToolPart = { readonly type: 'pending-tool'; toolCallId: string };

/**
 * Stateful implementation behind `createAssistantPartCollector` — a class
 * rather than a closure so each append/settle operation is its own method,
 * mirroring `RunEventTranslatorImpl` (run-stream-bridge.ts).
 */
class AssistantPartCollectorImpl {
  private readonly collected: Array<MessagePart | PendingToolPart> = [];
  private readonly pendingToolIndexes = new Map<string, number>();
  // Ids whose outcome is already recorded, by either path. Settlement is
  // at-most-once per call (design D6, first writer wins).
  private readonly settledToolCallIds = new Set<string>();
  private readonly idBackedReasoning = new Set<MessagePart>();
  private openReasoningPartId: string | undefined;

  text(text: string): void {
    if (text.length === 0) return;
    const last = this.collected.at(-1);
    if (last?.type === 'text' && isString(last.text)) {
      last.text += text;
      return;
    }
    this.collected.push({ type: 'text', text });
  }

  reasoning(text: string, partId?: string): void {
    if (text.length === 0) return;
    const last = this.collected.at(-1);
    if (
      last?.type === 'reasoning' &&
      isString(last.text) &&
      !this.isNewReasoningPart(partId)
    ) {
      last.text += text;
      this.openReasoningPartId = partId ?? this.openReasoningPartId;
      return;
    }
    this.openReasoningPartId = partId;
    const part: MessagePart = { type: 'reasoning', text };
    if (partId !== undefined) {
      this.idBackedReasoning.add(part);
    }
    this.collected.push(part);
  }

  private isNewReasoningPart(partId?: string): boolean {
    return (
      partId !== undefined &&
      this.openReasoningPartId !== undefined &&
      partId !== this.openReasoningPartId
    );
  }

  toolRequested(toolCallId: string): void {
    this.pendingToolIndexes.set(toolCallId, this.collected.length);
    this.collected.push({ type: 'pending-tool', toolCallId });
  }

  tool(part: ToolActivityPart): void {
    // Settlement is at-most-once per call. A tool that ignored cancellation
    // and completed after termination already settled it must not replace
    // that record, nor append a second one for the same id.
    if (this.settledToolCallIds.has(part.toolCallId)) {
      return;
    }
    this.settledToolCallIds.add(part.toolCallId);
    const pendingIndex = this.pendingToolIndexes.get(part.toolCallId);
    if (pendingIndex === undefined) {
      this.collected.push(part);
      return;
    }
    this.collected[pendingIndex] = part;
    this.pendingToolIndexes.delete(part.toolCallId);
  }

  capNotice(part: CapNoticePart): void {
    this.collected.push(part);
  }

  parts(): Array<MessagePart> {
    return (
      this.collected
        // Only settled tool parts are a durable history representation. A
        // provider failure after tool.requested leaves the request in the
        // event log, while avoiding an invalid UI tool-part snapshot.
        .filter((part): part is MessagePart => part.type !== 'pending-tool')
        .map((part) => this.persistedPart(part))
    );
  }

  private persistedPart(part: MessagePart): MessagePart {
    if (part.type !== 'reasoning' || !isString(part.text)) {
      return part;
    }
    const text = this.idBackedReasoning.has(part)
      ? part.text
      : separateGluedReasoningBlocks(part.text);
    if (text.length > REASONING_PERSIST_MAX) {
      return { ...part, text: `${text.slice(0, REASONING_PERSIST_MAX)}…` };
    }
    return text === part.text ? part : { ...part, text };
  }
}

/** Builds the stored assistant transcript in the exact order llame observed it. */
export function createAssistantPartCollector(): AssistantPartCollectorImpl {
  return new AssistantPartCollectorImpl();
}

/**
 * Exported for `RunExecutionService`'s live-stream path, which shapes tool
 * results the same way the durable reconstructor below does.
 */
export function toolActivityPart(
  toolCallId: string,
  toolName: string,
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- persisted verbatim into the tool-observation record's `input` field; each tool's actual argument shape is validated separately at the AI SDK / MCP boundary before this function ever runs (see the `tool({ execute })` callback below) -- this just records what was already admitted.
  input: unknown,
  result: ToolResult,
): ToolActivityPart {
  return result.status === 'success'
    ? {
        type: `tool-${toolName}`,
        toolCallId,
        state: 'output-available',
        input,
        output: result,
        outcome: 'success',
      }
    : {
        type: `tool-${toolName}`,
        toolCallId,
        state: 'output-error',
        input,
        errorText: result.message,
        outcome: normalizeToolObservationOutcome(result.type, 'error'),
        ...(result.type === 'cancelled' && {
          resultProviderMetadata: {
            llame: { cancelled: true as const },
          },
        }),
      };
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- validated by the ternary test `isRecord(payload)` below -- an `isXxx`-named guard call, but as a ternary test rather than an `if`/`return`-of-boolean, a shape the structural exemption doesn't unwrap.
function eventPayloadField(payload: unknown, key: string) {
  return isRecord(payload) ? payload[key] : undefined;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- delegates directly to `eventPayloadField` above, which validates via `isRecord(payload)` as its own ternary test; bare-identifier delegation, not itself a validating call.
function eventPayloadString(payload: unknown, key: string): string | undefined {
  const value = eventPayloadField(payload, key);
  return isString(value) ? value : undefined;
}

/**
 * Rebuild the observable assistant prefix from the append-only event log and
 * identify calls that were durably requested but never durably completed.
 * Request-time reservations keep synthetic results in occurrence order even
 * though their completion events are appended at terminalization.
 */
type OpenToolCall = { readonly toolName: string; readonly toolInput: unknown };

/**
 * Replays the append-only event log into `createAssistantPartCollector`. A
 * class rather than a closure/for-loop so each event type is its own method,
 * mirroring `RunEventTranslatorImpl` (run-stream-bridge.ts).
 */
class DurableAssistantReconstructor {
  readonly collector = createAssistantPartCollector();
  readonly openToolCalls = new Map<string, OpenToolCall>();
  private readonly seenToolCallIds = new Set<string>();
  private readonly completedToolCallIds = new Set<string>();

  apply(events: Array<RunEvent>): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  private applyEvent(event: RunEvent): void {
    switch (event.eventType) {
      case 'model.delta':
        this.collector.text(eventPayloadString(event.payload, 'text') ?? '');
        return;
      case 'reasoning.delta':
        this.collector.reasoning(
          eventPayloadString(event.payload, 'text') ?? '',
          eventPayloadString(event.payload, 'partId'),
        );
        return;
      case 'run.step_cap_reached':
        this.applyStepCapReached(event);
        return;
      case 'tool.requested':
        this.applyToolRequested(event);
        return;
      case 'tool.completed':
        this.applyToolCompleted(event);
        return;
      default:
        return;
    }
  }

  private applyStepCapReached(event: RunEvent): void {
    const stepsUsed = eventPayloadField(event.payload, 'stepsUsed');
    const maxSteps = eventPayloadField(event.payload, 'maxSteps');
    if (isNumber(stepsUsed) && isNumber(maxSteps)) {
      this.collector.capNotice({
        type: 'data-cap-notice',
        data: { stepsUsed, maxSteps },
      });
    }
  }

  private applyToolRequested(event: RunEvent): void {
    const toolCallId = eventPayloadString(event.payload, 'toolCallId');
    const toolName = eventPayloadString(event.payload, 'toolName');
    if (
      !toolCallId ||
      !toolName ||
      this.seenToolCallIds.has(toolCallId) ||
      this.completedToolCallIds.has(toolCallId)
    ) {
      return;
    }
    this.seenToolCallIds.add(toolCallId);
    const toolInput = eventPayloadField(event.payload, 'input');
    this.openToolCalls.set(toolCallId, { toolName, toolInput });
    this.collector.toolRequested(toolCallId);
  }

  private applyToolCompleted(event: RunEvent): void {
    const toolCallId = eventPayloadString(event.payload, 'toolCallId');
    if (!toolCallId || this.completedToolCallIds.has(toolCallId)) {
      return;
    }
    const request = this.openToolCalls.get(toolCallId);
    const output = eventPayloadField(event.payload, 'output');
    if (!request || !isRecord(output)) {
      return;
    }
    const status = output['status'];
    let result: ToolResult;
    if (status === 'success') {
      result = { ...output, status };
    } else if (
      status === 'error' &&
      isString(output['type']) &&
      isString(output['message'])
    ) {
      result = { status, type: output['type'], message: output['message'] };
    } else {
      return;
    }
    this.completedToolCallIds.add(toolCallId);
    this.openToolCalls.delete(toolCallId);
    this.collector.tool(
      toolActivityPart(toolCallId, request.toolName, request.toolInput, result),
    );
  }
}

export function reconstructDurableAssistant(events: Array<RunEvent>) {
  const reconstructor = new DurableAssistantReconstructor();
  reconstructor.apply(events);
  return {
    collector: reconstructor.collector,
    openToolCalls: reconstructor.openToolCalls,
  };
}

/**
 * Assistant-turn parts, in occurrence order: a leading `reasoning` part
 * (capped, display-only) when the model produced thinking, then every tool
 * call/result of the run (in the order they were recorded), then the answer
 * text, then an optional step-cap notice. All three display-only kinds —
 * reasoning, tool parts, and the cap notice — survive a reload for the UI but
 * are stripped by `partsToText`, so they never re-enter model context on a
 * later turn or in a compaction summary (the model saw tool results live
 * during the run's own loop; the persisted parts are a UI record).
 */
export function assistantParts(input: {
  reasoningText: string;
  toolParts: ReadonlyArray<ToolActivityPart>;
  text: string;
  capNotice?: CapNoticePart;
}): Array<MessagePart> {
  const { reasoningText, toolParts, text, capNotice } = input;
  const parts: Array<MessagePart> = [];
  if (reasoningText.length > 0) {
    const reasoning =
      reasoningText.length > REASONING_PERSIST_MAX
        ? `${reasoningText.slice(0, REASONING_PERSIST_MAX)}…`
        : reasoningText;
    parts.push({ type: 'reasoning', text: reasoning });
  }
  parts.push(...toolParts);
  // Skip an empty text part: a reasoning-only turn (or one that hits onFinish
  // with no visible answer) should not persist a spurious `{ type: 'text',
  // text: '' }` -- no downstream renderer (chat-page.tsx, markdown export)
  // needs an empty text bubble/line.
  if (text.length > 0) {
    parts.push({ type: 'text', text });
  }
  if (capNotice) {
    parts.push(capNotice);
  }
  return parts;
}
