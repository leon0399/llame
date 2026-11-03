/**
 * Assistant transcript building (#48/#49/#50, design D5/D6) — turns the live
 * stream of model/tool events into the exact `MessagePart[]` llame persists
 * on an assistant message, and rebuilds that same transcript from the
 * append-only `run_events` log when execution wasn't the one settling the
 * run.
 *
 * Two producers share this vocabulary: `createAssistantPartCollector` is fed
 * live during `RunExecutionService#executeRun`'s stream callbacks, and
 * `reconstructDurableAssistant` replays a persisted event log (used by the
 * reply finalizer when a run terminalizes without its own in-memory turn, e.g.
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
import { type SdkRefusal } from '../models/model-client';
import { type AuthoredContextItemPart } from '../chats/context-item';
import {
  isHopRejection,
  normalizeToolObservationOutcome,
} from '../chats/tool-observation-part';
import {
  isToolClassification,
  type ToolClassification,
  type ToolResult,
} from '../tools/types';
import { isArtifactLocator } from '../tools/artifacts/locator';
import { type PermissionDecision } from '../tools/permissions/types';
import { type DerivedDecisionRecord } from '../tools/web-read/admission';
import { isSystemOriginPayload } from './tool-activity-origin';
import {
  derivedDecisionsFromPayload,
  permissionFromPayload,
  sdkRefusalFromPayload,
  toolResultFromPayload,
} from './tool-event-payload';
import { TextPartTrack } from './transcript-text-parts';
import {
  eventPayloadField,
  eventPayloadString,
  eventProviderMetadata,
} from './run-event-payload';
import {
  parseRetainedMedia,
  RETAINED_MEDIA_KEY,
  type RetainedMediaJson,
} from '../media/retained-media';

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
  /**
   * The model step that produced this call (design D5), numbered from 0 in a
   * Run and continuing after the kept steps in a Continue Run. Absent on a
   * part stored before this change; replay then falls back to the consecutive
   * rule. The owner history response and owner event stream carry it, because
   * it is neither opaque nor secret.
   */
  step?: number;
  /**
   * What the AI SDK itself put in the live step for a call it refused before
   * llame ran it (design D3, proposal A8): the SDK's exact error text and its
   * form of the input. Model-only, and the marker of a refused call — an
   * executor that returns `not_available` stores the same outcome and error
   * text without it. Its presence never changes the owner-facing `errorText`.
   */
  sdkRefusal?: SdkRefusal;
  /**
   * The artifact locator the call's result names (tool-result-artifacts D6).
   * The replay renders `Artifact: <locator>` from it after payload clearing
   * too (D8), and the web UI reads it from the history response.
   */
  artifact?: string;
  /**
   * The refused redirect target a `permission_denied` hop rejection named in
   * its live result (web-read design D3), kept beside the stored error.
   * Unlike `permission` and `derivedDecisions` this is part of the
   * model-visible result, so it follows `errorText` into replay; it is stored
   * as the tool bounded it — origin and path only, control characters
   * stripped, at most 2,048 characters — and only the native `read` tool's
   * hop rejection records one.
   */
  errorRejectedUrl?: string;
  /** SDK-supported result metadata marking an error produced by run termination
   *  rather than by the tool itself. Persisted so the UI can render
   *  "Cancelled" without parsing error text, and survives the live transport. */
  resultProviderMetadata?: { llame: { cancelled: true } };
  /**
   * The opaque provider metadata the adapter attached to this call (design
   * A7): the Responses item's `itemId`, or a Chat Completions
   * `thoughtSignature`. Stored once, on the call, and replayed unchanged on a
   * later request for the same Chat; llame never reads inside it. Absent when
   * the wire supplied none. The owner history response and owner event stream
   * strip it, and exports, public shares, search, logs, and telemetry never
   * carry it.
   */
  providerMetadata?: ProviderMetadata;
  /**
   * Safe, owner-visible permission decision metadata (openspec/changes/
   * tool-call-permissions D5). Excluded from model replay, public shares,
   * exports, and search; it never contains policy bodies or matched input.
   */
  permission?: PermissionDecision;
  /**
   * The decisions this call's derived locators — redirect hops, announced
   * alternates, suffix and `llms.txt` candidates — received before their
   * requests, each with the kind of locator it judged
   * (openspec/changes/web-read D3). Same exclusion contract as `permission`,
   * and never part of the model-visible result.
   */
  derivedDecisions?: ReadonlyArray<DerivedDecisionRecord>;
  /**
   * The classification of the tool that ran the call, from its `tool.started`
   * event. `null` for a call that never started — the availability gate or the
   * permission policy rejected it — and absent for a call that started before
   * the event recorded the field, where readers fall back to the tool catalog
   * (turn-actions D10, D9). The history response carries it; model replay,
   * public shares, exports, and search never do.
   */
  classification?: ToolClassification | null;
  /**
   * The bytes an unstored `read` keeps beside its result
   * (`media-attachments`): the model variant of an image or the original of a
   * PDF, already base64, or the record of a read past its message bound. Never
   * part of the result, the thumbnail, or any model-facing text.
   */
  retainedMedia?: RetainedMediaJson;
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
  // Text part boundaries and metadata binding (design A7).
  private readonly textParts = new TextPartTrack();

  /**
   * Start the transcript from the parts an earlier Run kept (turn-actions D5),
   * so every terminal writer of a Continue Run persists the kept parts once,
   * ahead of its own. Each seeded call counts as settled, so a duplicate
   * settlement cannot replace it. The kept boundary ends on a settled tool part
   * or an in-Run item, so no later text or reasoning delivery merges into a
   * seeded part.
   */
  seed(parts: ReadonlyArray<MessagePart>): void {
    for (const part of parts) {
      // Stored jsonb is untrusted: an entry that is not an object contributes
      // nothing, and must not break the transcript the Run writes.
      if (!isRecord(part)) continue;
      this.collected.push(part);
      if (isString(part['toolCallId'])) {
        this.settledToolCallIds.add(part['toolCallId']);
      }
    }
  }

  /**
   * A text delivery; boundaries and metadata binding: see `TextPartTrack`
   * (design A7). `step` is stamped on a part this delivery starts (design D5);
   * a part keeps the value it was created with. Reports the metadata this
   * delivery stored on a part, if any.
   */
  text(
    text: string,
    partId?: string,
    providerMetadata?: ProviderMetadata,
    step?: number,
  ): ProviderMetadata | undefined {
    return this.textParts.record(this.collected, text, {
      partId,
      providerMetadata,
      step,
    });
  }

  /**
   * A reasoning delivery: delta `text` (possibly empty — a part's start/end
   * carries none) with the adapter's part id and, when the wire supplied one,
   * the opaque provider metadata bound to that part (design D15/D18).
   *
   * A delivery with text starts or extends a part as before. An empty
   * delivery carrying provider metadata under a defined id no collected part
   * carries starts a reasoning part with empty text and binds the metadata to
   * it: a provider that withholds a block's text (a signed thinking block with
   * `display: omitted`, a redacted one, a Responses item whose summary is
   * empty) still returns a block whose metadata a later request must replay,
   * so the block persists as an empty part rather than being lost. Every other
   * empty delivery behaves as it did: metadata binds to the part its id names
   * (the open part when the wire never supplied ids) and starts nothing.
   */
  reasoning(
    text: string,
    partId?: string,
    providerMetadata?: ProviderMetadata,
    step?: number,
  ): void {
    if (text.length > 0) {
      this.appendReasoning(text, partId, step);
    } else if (this.startsReasoningPart(partId, providerMetadata)) {
      // D18: the block exists, its text was withheld. The empty part becomes
      // the open one, so text the wire still sends under this id lands in it.
      this.openReasoningPartId = partId;
      this.collected.push({
        type: 'reasoning',
        text: '',
        providerMetadata,
        ...(step !== undefined && { step }),
      });
      this.reasoningPartIndexes.set(partId, this.collected.length - 1);
      return;
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

  /** Records reasoning characters on the open part, or a new one (D5/D15). */
  private appendReasoning(
    text: string,
    partId: string | undefined,
    step: number | undefined,
  ): void {
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
      this.collected.push({
        type: 'reasoning',
        text,
        ...(step !== undefined && { step }),
      });
    }
    // A defined id now names the part those characters went into (D15).
    if (partId !== undefined) {
      this.reasoningPartIndexes.set(partId, this.collected.length - 1);
    }
  }

  /**
   * Design D18: whether an empty delivery starts the reasoning part its
   * metadata belongs to — provider metadata under a defined adapter id no
   * collected part carries yet. The block exists even though the provider
   * withheld its text, and the run loop records such a delivery behind any
   * buffered text, so the durable replay keeps the stream's order.
   */
  startsReasoningPart(
    partId: string | undefined,
    providerMetadata: ProviderMetadata | undefined,
  ): partId is string {
    return (
      providerMetadata !== undefined &&
      partId !== undefined &&
      !this.reasoningPartIndexes.has(partId)
    );
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

  /**
   * An in-Run context item (design D3): appended where the transcript had
   * reached when the producing step's results settled, so the reply stores it
   * after that step's last tool part whatever the attempt's outcome.
   */
  contextItem(part: AuthoredContextItemPart): void {
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
  /** The model step that produced this call (design D5). */
  readonly step?: number;
  /**
   * The SDK's own error text and input form for a call it refused (design D3,
   * proposal A8), copied from the refusal seam.
   */
  readonly sdkRefusal?: SdkRefusal;
  /**
   * The call's opaque provider metadata (design A7), stored once on the call:
   * the consumer delivered it before the call executed, and every settlement
   * path carries it here from the event's open call entry.
   */
  readonly providerMetadata?: ProviderMetadata;
  readonly permission?: PermissionDecision;
  readonly derivedDecisions?: ReadonlyArray<DerivedDecisionRecord>;
  /**
   * The executing tool's classification, `null` when the call never started,
   * and absent when the event that started it recorded none.
   */
  readonly classification?: ToolClassification | null;
  /**
   * The retained bytes the call's read keeps, or the record that its message
   * bound is exceeded. Absent for every result that keeps none: a stored
   * `media://` result, a refused read, and a system-origin read such as a
   * prompt import, whose bytes live in the import's own entry.
   */
  readonly retainedMedia?: RetainedMediaJson;
};

/**
 * Exported for `RunExecutionService`'s live-stream path, which shapes tool
 * results the same way the durable reconstructor below does.
 */
export function toolActivityPart(
  call: ToolActivityPartInput,
): ToolActivityPart {
  const part = toolPartBody(call);
  if (call.step !== undefined) part.step = call.step;
  if (call.sdkRefusal !== undefined) part.sdkRefusal = call.sdkRefusal;
  if (call.retainedMedia !== undefined) part.retainedMedia = call.retainedMedia;
  if (call.providerMetadata !== undefined)
    part.providerMetadata = call.providerMetadata;
  if (call.permission !== undefined) part.permission = call.permission;
  if (call.derivedDecisions !== undefined && call.derivedDecisions.length > 0) {
    part.derivedDecisions = call.derivedDecisions;
  }
  // Only the native `read` tool's refused hop names a redirect target, and an
  // absent value must add no property at all.
  const refusedUrl =
    call.result.status === 'error' &&
    isHopRejection(call.toolName, call.result.type)
      ? call.result.rejectedUrl
      : undefined;
  if (refusedUrl !== undefined) part.errorRejectedUrl = refusedUrl;
  const artifact = isRecord(call.result) ? call.result['artifact'] : undefined;
  if (isString(artifact) && isArtifactLocator(artifact))
    part.artifact = artifact;

  return part;
}

/** The settled state a call's result stores, before its decision metadata. */
function toolPartBody(call: ToolActivityPartInput): ToolActivityPart {
  const { toolCallId, toolName, input, result, classification } = call;
  // Absent means the call started before the event recorded a classification;
  // `null` means it never started at all.
  const known = classification === undefined ? {} : { classification };
  return result.status === 'success'
    ? {
        type: `tool-${toolName}`,
        toolCallId,
        state: 'output-available',
        input,
        output: result,
        outcome: 'success',
        ...known,
      }
    : {
        type: `tool-${toolName}`,
        toolCallId,
        state: 'output-error',
        input,
        errorText: result.message,
        outcome: normalizeToolObservationOutcome(result.type, 'error'),
        ...known,
        ...(result.type === 'cancelled' && {
          resultProviderMetadata: {
            llame: { cancelled: true as const },
          },
        }),
      };
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
  /** The model step the `tool.requested` event recorded (design D5). */
  readonly step?: number;
  readonly permission?: PermissionDecision;
  /** The call's opaque provider metadata, from its `tool.requested` (A7). */
  readonly providerMetadata?: ProviderMetadata;
};

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
  /**
   * The event log records the SDK's own step number, which restarts at 0 in
   * every request, while the stored parts of a Continue Run continue after the
   * kept steps (design D5). The caller supplies the offset the run used, so a
   * rebuilt part carries the same step the live collector stamped.
   */
  private readonly stepOffset: number;
  /**
   * The calls that recorded a `tool.started`. A call without one never ran, so
   * its part stores `null`; a call with one but no recorded classification
   * started under an earlier revision, so its part omits the field and readers
   * fall back to the tool catalog (turn-actions D10, D9).
   */
  private readonly startedToolCallIds = new Set<string>();
  /** The classification each started call recorded, when it recorded one. */
  private readonly startedClassifications = new Map<
    string,
    ToolClassification
  >();

  constructor(stepOffset: number) {
    this.stepOffset = stepOffset;
  }

  /**
   * The step number a stored event records, shifted by the Continue offset
   * (design D5). An event without one — a log written before this change —
   * adds nothing to the part it produces.
   */
  private stepFrom(
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- the raw `run_events.payload` JSONB value; `eventPayloadField` and the number guard below parse it before use.
    payload: unknown,
  ): number | undefined {
    const recorded = eventPayloadField(payload, 'stepNumber');
    return isNumber(recorded) ? this.stepOffset + recorded : undefined;
  }

  apply(events: Array<RunEvent>): void {
    for (const event of events) {
      this.applyEvent(event);
    }
  }

  private applyEvent(event: RunEvent): void {
    switch (event.eventType) {
      case 'model.delta':
        this.collector.text(
          eventPayloadString(event.payload, 'text') ?? '',
          eventPayloadString(event.payload, 'partId'),
          eventProviderMetadata(event.payload),
          this.stepFrom(event.payload),
        );
        return;
      case 'reasoning.delta':
        this.collector.reasoning(
          eventPayloadString(event.payload, 'text') ?? '',
          eventPayloadString(event.payload, 'partId'),
          eventProviderMetadata(event.payload),
          this.stepFrom(event.payload),
        );
        return;
      case 'run.step_cap_reached':
        this.applyStepCapReached(event);
        return;
      case 'tool.requested':
        this.applyToolRequested(event);
        return;
      case 'tool.started':
        this.applyToolStarted(event);
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
    this.openToolCalls.set(toolCallId, {
      toolName,
      toolInput,
      step: this.stepFrom(event.payload),
      permission,
      providerMetadata: eventProviderMetadata(event.payload),
    });
    this.collector.toolRequested(toolCallId);
  }

  private applyToolStarted(event: RunEvent): void {
    const toolCallId = eventPayloadString(event.payload, 'toolCallId');
    if (!toolCallId) return;
    this.startedToolCallIds.add(toolCallId);
    const classification = eventPayloadField(event.payload, 'classification');
    if (isToolClassification(classification)) {
      this.startedClassifications.set(toolCallId, classification);
    }
  }

  /**
   * What a completed call's part records: `null` when it never started, the
   * classification it recorded, or nothing when it started without one.
   */
  private recordedClassification(
    toolCallId: string,
  ): ToolClassification | null | undefined {
    return this.startedToolCallIds.has(toolCallId)
      ? this.startedClassifications.get(toolCallId)
      : null;
  }

  private applyToolCompleted(event: RunEvent): void {
    const toolCallId = eventPayloadString(event.payload, 'toolCallId');
    if (!toolCallId || this.completedToolCallIds.has(toolCallId)) {
      return;
    }
    const request = this.openToolCalls.get(toolCallId);
    if (!request) {
      return;
    }
    const result = toolResultFromPayload(
      eventPayloadField(event.payload, 'output'),
      request.toolName,
    );
    if (result === undefined) {
      return;
    }
    this.completedToolCallIds.add(toolCallId);
    this.openToolCalls.delete(toolCallId);
    const retainedMedia = parseRetainedMedia(
      eventPayloadField(event.payload, RETAINED_MEDIA_KEY),
    );
    this.collector.tool(
      toolActivityPart({
        toolCallId,
        toolName: request.toolName,
        input: request.toolInput,
        result,
        step: request.step,
        sdkRefusal: sdkRefusalFromPayload(event.payload),
        permission: request.permission,
        providerMetadata: request.providerMetadata,
        classification: this.recordedClassification(toolCallId),
        // The call decision rides on the request; the derived-locator
        // decisions only exist once the call settled, so they are read from
        // this completion payload, as are the bytes the read keeps.
        derivedDecisions: derivedDecisionsFromPayload(event.payload),
        retainedMedia,
      }),
    );
  }
}

/**
 * The reply's parts and open calls rebuilt from a Run's event log.
 *
 * @param events - The Run's stored events, in sequence order
 * @param stepOffset - The first step number the run used: 0 for a Run that
 *   starts a turn, and the Continue offset for a Run that continues one
 *   (design D5). Old events without a step number keep no step.
 */
export function reconstructDurableAssistant(
  events: Array<RunEvent>,
  stepOffset = 0,
) {
  const reconstructor = new DurableAssistantReconstructor(stepOffset);
  reconstructor.apply(events);
  return {
    collector: reconstructor.collector,
    openToolCalls: reconstructor.openToolCalls,
  };
}
