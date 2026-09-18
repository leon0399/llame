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
import { type ProviderMetadata } from 'ai';
import { type RunEvent } from '../db/schema';
import { type MessagePart } from '../chats/context-builder';
import { normalizeToolObservationOutcome } from '../chats/tool-observation-part';
import { type ToolResult } from '../tools/types';
import {
  type PermissionClauseReference,
  type PermissionDecision,
  type PermissionDecisionReason,
} from '../tools/permissions/types';
import { isSystemOriginPayload } from './tool-activity-origin';

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
  permission?: PermissionDecision;
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
  // Adapter part id of the open reasoning part (undefined = the wire gave
  // none). Decides part boundaries only — never persisted (design D8).
  private openReasoningPartId: string | undefined;
  // Index of every reasoning part this turn collected, by adapter part id.
  // The Responses adapter attaches a part's opaque provider metadata to that
  // part's `reasoning-end` stream part, which carries no text of its own and
  // can arrive after the next summary's part opened (a new summary's start
  // ends the previous still-open one, and the item's completion ends the
  // last), so the metadata is routed to the part its id names rather than to
  // whatever part is open (design D15).
  private readonly reasoningPartIndexes = new Map<string, number>();

  text(text: string): void {
    if (text.length === 0) return;
    const last = this.collected.at(-1);
    if (last?.type === 'text' && isString(last.text)) {
      last.text += text;
      return;
    }
    this.collected.push({ type: 'text', text });
  }

  /**
   * A reasoning delivery: delta `text` (possibly empty — the adapter's end
   * part has none) with the adapter's part id and, when the wire supplied
   * one, the opaque provider metadata bound to that part (design D15). An
   * empty `text` starts no part and moves no boundary; it only binds the
   * metadata to the part `partId` names (the open part when the wire never
   * supplied ids).
   */
  reasoning(
    text: string,
    partId?: string,
    providerMetadata?: ProviderMetadata,
  ): void {
    if (text.length > 0) {
      const last = this.collected.at(-1);
      if (
        last?.type === 'reasoning' &&
        isString(last.text) &&
        !this.isNewReasoningPart(partId)
      ) {
        last.text += text;
        // A defined id becomes the open part's id; an absent id adds nothing.
        this.openReasoningPartId = partId ?? this.openReasoningPartId;
      } else {
        this.openReasoningPartId = partId;
        this.collected.push({ type: 'reasoning', text });
      }
      // A defined id now names the part those characters went into (D15).
      if (partId !== undefined) {
        this.reasoningPartIndexes.set(partId, this.collected.length - 1);
      }
    }
    if (providerMetadata === undefined) return;
    // Opaque and stored verbatim: llame never reads inside it, and an absent
    // one never becomes an `undefined` field on the part. The id names the
    // part the metadata belongs to; a wire that supplied none binds it to the
    // open part, and an id no collected part carries binds nothing.
    const index =
      partId === undefined
        ? this.openReasoningPartIndex()
        : this.reasoningPartIndexes.get(partId);
    if (index === undefined) return;
    const part = this.collected[index];
    if (part?.type === 'reasoning' && isString(part.text)) {
      part.providerMetadata = providerMetadata;
    }
  }

  /** Index of the open reasoning part, when the last collected part is one. */
  private openReasoningPartIndex(): number | undefined {
    const last = this.collected.at(-1);
    return last?.type === 'reasoning' && isString(last.text)
      ? this.collected.length - 1
      : undefined;
  }

  /**
   * Design D8: a new persisted reasoning part starts on two defined ids that
   * differ. An undefined id is "no information" — it neither opens nor closes
   * a part, so an undefined ↔ defined transition is not a boundary (the
   * intervening-part split ahead of this handles a text/tool/notice part).
   */
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
    return this.collected.filter(
      // Only settled tool parts are a durable history representation. A
      // provider failure after tool.requested leaves the request in the
      // event log, while avoiding an invalid UI tool-part snapshot.
      (part): part is MessagePart => part.type !== 'pending-tool',
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
  readonly permission?: PermissionDecision;
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
 * The opaque provider metadata a `reasoning.delta` event carries (design
 * D15). Stored jsonb is untrusted on the way back in, so only a record is
 * accepted; llame never reads inside it.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- reads one field off the raw `run_events.payload` JSONB value, validating with `isRecord` before the value is trusted; mirrors `eventPayloadString` above.
function eventProviderMetadata(payload: unknown): ProviderMetadata | undefined {
  const value = eventPayloadField(payload, 'providerMetadata');
  if (!isRecord(value)) return undefined;
  // SAFETY: the value is the adapter's own provider-metadata object as
  // Postgres jsonb stored and returned it; the check above only rules out a
  // malformed or legacy payload shape, and nothing reads inside it.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const metadata = value as ProviderMetadata;
  return metadata;
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
  readonly permission?: PermissionDecision;
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

function isPermissionRejectionReason(
  value: unknown,
): value is Exclude<PermissionDecisionReason, 'matched_allow'> {
  return isPermissionReason(value) && value !== 'matched_allow';
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
): PermissionDecision | undefined {
  const permission = eventPayloadField(payload, 'permission');
  if (!isRecord(permission)) return undefined;
  const policyId = permission['policyId'];
  const decision = permission['decision'];
  const reason = permission['reason'];
  if (!isString(policyId)) return undefined;
  const reference = permissionClauseFromPayload(permission['reference']);
  if (decision === 'allow') {
    return reason === 'matched_allow'
      ? { policyId, decision: 'allow', reason: 'matched_allow', reference }
      : undefined;
  }
  if (decision !== 'reject' || !isPermissionRejectionReason(reason)) {
    return undefined;
  }
  return { policyId, decision: 'reject', reason, reference };
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
          eventPayloadString(event.payload, 'partId'),
          eventProviderMetadata(event.payload),
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
    // System-origin activity never becomes an assistant tool part, so it takes
    // no collector slot and — because it also never enters `openToolCalls` — no
    // synthesized settlement on recovery. Leaving it out here is what keeps a
    // skill activation from being replayed as a call the model made.
    if (isSystemOriginPayload(event.payload)) return;
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
