/**
 * In-Run context items: items authored between the model steps of one Run.
 *
 * An in-Run item has no user message to carry it, so it is staged while the
 * Run executes and re-spliced into every later step's live messages by
 * `applyToStep` (design D1). `ai` rebuilds a step's messages on every step
 * and may or may not retain an earlier override, so placement is recomputed
 * from scratch each time: remove any earlier copy, then insert after the
 * anchor tool result. The module is pure — it holds only the staged items,
 * never persistence state.
 *
 * The Run boundary is the first step's live messages: everything before it is
 * the Chat's history, which no part of this carrier reads or rewrites.
 */

import type { ModelMessage } from 'ai';

import type { AuthoredContextItemPart } from '../chats/context-item';
import { type KnowledgeInstructionProbe } from '../knowledge/knowledge-instruction-probe';
import type { ReadPage } from '../instructions/instruction-files';
import type { ToolResult } from '../tools/types';

export interface InRunContextItems {
  /**
   * The first call of an attempt records messages.length as the Run boundary:
   * everything before it is chat history the carrier never touches.
   */
  beginStep(messages: ReadonlyArray<ModelMessage>): void;
  /**
   * Binds to the anchor of the latest beginStep; throws Error if beginStep
   * was never called. Emission order is preserved.
   */
  stage(part: AuthoredContextItemPart): void;
  /**
   * undefined when nothing is staged. Otherwise a NEW array: every staged
   * item appears exactly once as `{ role: 'user', content: [{ type: 'text',
   * text: part.data.text }] }`, directly after the `role: 'tool'` message
   * whose content carries `tool-result` with its anchor toolCallId (items
   * sharing an anchor follow each other in emission order); at the Run
   * boundary when the anchor is null; at the end when the anchor is absent from
   * the step. Any earlier copy — a user message
   * whose content is exactly one text part equal to part.data.text — is
   * removed first. Never mutates the input array or any message object in
   * it, and never reads or rewrites chat history before the Run boundary.
   */
  applyToStep(
    messages: ReadonlyArray<ModelMessage>,
  ): Array<ModelMessage> | undefined;
  /** The staged parts in emission order. */
  parts(): ReadonlyArray<AuthoredContextItemPart>;
}

/** One staged item: its part and the anchor of the step it was staged at. */
interface StagedItem {
  readonly part: AuthoredContextItemPart;
  /**
   * toolCallId of the LAST tool-result in the step's live messages at
   * beginStep, searched in the Run region only; null when the region carried
   * none (then the item goes at the Run boundary).
   */
  readonly anchorToolCallId: string | null;
}

/** The toolCallId of the last tool-result part of the last tool message. */
function lastToolCallId(messages: ReadonlyArray<ModelMessage>): string | null {
  const toolMessage = messages.findLast((message) => message.role === 'tool');
  if (toolMessage?.role !== 'tool') return null;
  const result = toolMessage.content.findLast(
    (part) => part.type === 'tool-result',
  );
  return result?.type === 'tool-result' ? result.toolCallId : null;
}

/** Whether `message` is an earlier insertion of one of the staged items. */
function isStagedCopy(
  message: ModelMessage,
  texts: ReadonlySet<string>,
): boolean {
  if (message.role !== 'user' || !Array.isArray(message.content)) return false;
  if (message.content.length !== 1) return false;
  const part = message.content[0];
  return part?.type === 'text' && texts.has(part.text);
}

/**
 * The staged items anchored to a tool-result inside `message`, in emission
 * order, marking each placed item in `placed` so it is emitted only once.
 */
function itemsAnchoredTo(
  message: ModelMessage,
  staged: ReadonlyArray<StagedItem>,
  placed: Set<StagedItem>,
): Array<ModelMessage> {
  if (message.role !== 'tool') return [];
  const toolCallIds = new Set(
    message.content.flatMap((part) =>
      part.type === 'tool-result' ? [part.toolCallId] : [],
    ),
  );
  return staged.flatMap((item) => {
    const anchor = item.anchorToolCallId;
    if (anchor === null || placed.has(item) || !toolCallIds.has(anchor)) {
      return [];
    }
    placed.add(item);
    return [
      { role: 'user', content: [{ type: 'text', text: item.part.data.text }] },
    ];
  });
}

/**
 * Splice every staged item into a step's messages. Only the Run region —
 * everything from the boundary on — is rebuilt; the history prefix is
 * concatenated unchanged.
 */
function spliceStagedItems(
  messages: ReadonlyArray<ModelMessage>,
  runStart: number,
  staged: ReadonlyArray<StagedItem>,
): Array<ModelMessage> {
  const texts = new Set(staged.map((item) => item.part.data.text));
  const region = messages
    .slice(runStart)
    .filter((message) => !isStagedCopy(message, texts));
  const placed = new Set<StagedItem>();
  const spliced = region.flatMap((message) => [
    message,
    ...itemsAnchoredTo(message, staged, placed),
  ]);
  // Staged before any Run tool result: the item belongs at the Run boundary,
  // which is where the transcript stores it and where replay puts it. An item
  // whose anchor is set but absent from this step goes last.
  const leading: Array<ModelMessage> = [];
  const unplaced: Array<ModelMessage> = [];
  for (const item of staged) {
    if (placed.has(item)) continue;
    const target = item.anchorToolCallId === null ? leading : unplaced;
    target.push({
      role: 'user',
      content: [{ type: 'text', text: item.part.data.text }],
    });
  }
  return [...messages.slice(0, runStart), ...leading, ...spliced, ...unplaced];
}

export function createInRunContextItems(): InRunContextItems {
  const staged: Array<StagedItem> = [];
  let runStart: number | null = null;
  let anchorToolCallId: string | null = null;

  return {
    beginStep(messages): void {
      runStart ??= messages.length;
      anchorToolCallId = lastToolCallId(messages.slice(runStart));
    },

    stage(part): void {
      if (runStart === null) {
        throw new Error(
          'Cannot stage an in-Run context item before beginStep().',
        );
      }
      staged.push({ part, anchorToolCallId });
    },

    applyToStep(messages): Array<ModelMessage> | undefined {
      const start = runStart;
      if (start === null || staged.length === 0) return undefined;
      return spliceStagedItems(messages, start, staged);
    },

    parts(): ReadonlyArray<AuthoredContextItemPart> {
      return staged.map((item) => item.part);
    },
  };
}

/** In-Run context producers registered with the Run executor. */
export const IN_RUN_CONTEXT_PRODUCER = Symbol('IN_RUN_CONTEXT_PRODUCER');

/** One accepted turn offered to a producer for the request it is building. */
export interface InRunTurnContext {
  readonly runId: string;
  /** The bound Workspace root the turn starts from. */
  readonly workspaceRoot: string;
  /**
   * Reads one page under the Run's own permission decision and audit trail.
   * Never a model-visible tool call.
   */
  readonly readPage: ReadPage;
  /** Preview the read permission without recording an audit event. */
  readonly admitsRead: (path: string) => boolean;
  /** Keys already disclosed to the attempt's effective context. */
  readonly seenKeys: ReadonlySet<string>;
  /** The Run's own abort signal; a producer must stop loading once it fires. */
  readonly abortSignal?: AbortSignal;
}

/** One tool call a producer observes. */
export interface InRunToolCall {
  readonly toolName: string;
  /** The AI-SDK-validated tool input, forwarded verbatim. */
  readonly input: unknown;
  /** The Workspace root in effect for the call; undefined when unbound. */
  readonly workspaceRoot: string | undefined;
  /**
   * The call's own result. Present on the settled observation and absent on
   * the admission observation, which happens before anything ran.
   */
  readonly result?: ToolResult;
}

/** Trusted identity of the attempt a producer authors items for. */
export interface InRunAttempt {
  readonly runId: string;
  readonly chatId: string;
  readonly userId: string;
  /** Keys already disclosed to the attempt's effective context. */
  readonly seenKeys?: ReadonlySet<string>;
  /**
   * Reads one audited page for this attempt. Absent when the producer may not
   * load host instruction files — the `read` tool or the native executor is
   * missing.
   */
  readonly readPage?: ReadPage;
  /** Preview the read permission without recording an audit event. */
  readonly admitsRead: (path: string) => boolean;
  /**
   * The Knowledge capability this attempt may load Space candidates with.
   * Absent when it may not: `read` is not allowlisted or no `knowledge.root`
   * is configured. Both halves are present or neither, so a `kb://` trigger
   * loads nothing at all without it.
   */
  readonly knowledge?: {
    /** The same audited page reader as `readPage`. */
    readonly readPage: ReadPage;
    /** The trusted owner-scoped view of one Space. */
    readonly probe: KnowledgeInstructionProbe;
  };
  /** The Run's own abort signal; a producer must stop loading once it fires. */
  readonly abortSignal?: AbortSignal;
}

export interface InRunStepContext {
  readonly messages: ReadonlyArray<ModelMessage>;
  readonly stepNumber: number;
  /**
   * Stages one item for this step: records it, appends it to the assistant
   * transcript, and includes it in the Run record.
   */
  readonly stage: (part: AuthoredContextItemPart) => void;
}

/** Per-attempt state of one producer; discarded with the attempt. */
export interface InRunAttemptProducer {
  prepareStep(step: InRunStepContext): Promise<void> | void;
  /**
   * Optional: observes one tool call. Called with the call's input at
   * admission (allowed calls only) and again with its result at settlement, so
   * a producer can trigger on an input, an outcome, or both.
   */
  observeToolCall?(call: InRunToolCall): void;
}

export interface InRunContextProducer {
  /** Called once per attempt before its first request. */
  beginAttempt(attempt: InRunAttempt): InRunAttemptProducer;
  /**
   * Optional: authors the item the accepted turn stages for its first request,
   * or undefined when the turn adds nothing. Called before that request and
   * whenever its history is rebuilt — with the rebuilt history's `seenKeys` —
   * where the returned item replaces the one before it. A producer must keep
   * no per-attempt state here: only the returned item matters, and the caller
   * derives the turn's seen set from its payload. Called outside any database
   * transaction.
   */
  prepareTurn?(
    context: InRunTurnContext,
  ): Promise<AuthoredContextItemPart | undefined>;
}
