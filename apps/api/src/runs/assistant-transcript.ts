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
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import { type RunEvent } from '../db/schema';
import { type MessagePart } from '../chats/context-builder';
import { normalizeToolObservationOutcome } from '../chats/tool-observation-part';
import { type ToolResult } from '../tools/types';
import { type PermissionDecisionMetadata } from '../tools/permissions/decision-record';
import {
  type PermissionClauseReference,
  type PermissionDecisionReason,
} from '../tools/permissions/types';

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
  /**
   * Safe, owner-visible permission decision metadata (openspec/changes/
   * tool-call-permissions D5). Excluded from model replay, public shares,
   * exports, and search; it never contains policy bodies or matched input.
   */
  permission?: PermissionDecisionMetadata;
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

  text(text: string): void {
    if (text.length === 0) return;
    const last = this.collected.at(-1);
    if (last?.type === 'text' && isString(last.text)) {
      last.text += text;
      return;
    }
    this.collected.push({ type: 'text', text });
  }

  reasoning(text: string): void {
    if (text.length === 0) return;
    const last = this.collected.at(-1);
    if (last?.type === 'reasoning' && isString(last.text)) {
      last.text += text;
      return;
    }
    this.collected.push({ type: 'reasoning', text });
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
        .map((part) =>
          part.type === 'reasoning' &&
          isString(part.text) &&
          part.text.length > REASONING_PERSIST_MAX
            ? {
                ...part,
                text: `${part.text.slice(0, REASONING_PERSIST_MAX)}…`,
              }
            : part,
        )
    );
  }
}

/** Builds the stored assistant transcript in the exact order llame observed it. */
export function createAssistantPartCollector(): AssistantPartCollectorImpl {
  return new AssistantPartCollectorImpl();
}

export type ToolActivityPartInput = {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
  readonly result: ToolResult;
  readonly permission?: PermissionDecisionMetadata;
};

/**
 * Exported for `RunExecutionService`'s live-stream path, which shapes tool
 * results the same way the durable reconstructor below does.
 */
export function toolActivityPart(
  call: ToolActivityPartInput,
): ToolActivityPart {
  const { toolCallId, toolName, input, result, permission } = call;
  const part: ToolActivityPart =
    result.status === 'success'
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
  if (permission !== undefined) part.permission = permission;
  return part;
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
type OpenToolCall = {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly permission?: PermissionDecisionMetadata;
};

const PERMISSION_REASONS: ReadonlySet<string> = new Set([
  'explicit_reject',
  'no_allow',
  'invalid_field',
  'input_limit',
  'matched_allow',
]);

function isPermissionReason(value: unknown): value is PermissionDecisionReason {
  return isString(value) && PERMISSION_REASONS.has(value);
}

function permissionClauseFromPayload(
  value: unknown,
): PermissionClauseReference | null {
  if (!isRecord(value)) return null;
  const groupId = value['groupId'];
  const list = value['list'];
  const clauseIndex = value['clauseIndex'];
  if (!isString(groupId)) return null;
  if (list !== 'allow' && list !== 'reject') return null;
  if (clauseIndex !== null && !isNumber(clauseIndex)) return null;
  return { groupId, list, clauseIndex };
}

/** Re-read the safe decision metadata from a `tool.requested` payload. */
function permissionFromPayload(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- the raw `run_events.payload` JSONB value; `eventPayloadField` and the `isRecord`/`isString` guards below parse it before any field is trusted.
  payload: unknown,
): PermissionDecisionMetadata | undefined {
  const permission = eventPayloadField(payload, 'permission');
  if (!isRecord(permission)) return undefined;
  const policyId = permission['policyId'];
  const decision = permission['decision'];
  const reason = permission['reason'];
  if (!isString(policyId)) return undefined;
  if (decision !== 'allow' && decision !== 'reject') return undefined;
  if (!isPermissionReason(reason)) return undefined;
  return {
    policyId,
    decision,
    reason,
    clause: permissionClauseFromPayload(permission['clause']),
  };
}

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
    const permission = permissionFromPayload(event.payload);
    this.openToolCalls.set(toolCallId, { toolName, toolInput, permission });
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
      toolActivityPart({
        toolCallId,
        toolName: request.toolName,
        input: request.toolInput,
        result,
        permission: request.permission,
      }),
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
