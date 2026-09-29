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
 */

import type { ModelMessage } from 'ai';

import type { AuthoredContextItemPart } from '../chats/context-item';

export interface StagedInRunContextItem {
  readonly part: AuthoredContextItemPart;
  /**
   * toolCallId of the LAST tool-result in the step's live messages at
   * beginStep; null when none (then the item goes at the end of the
   * messages).
   */
  readonly anchorToolCallId: string | null;
  readonly stepNumber: number;
}

export interface InRunContextItems {
  beginStep(step: {
    messages: ReadonlyArray<ModelMessage>;
    stepNumber: number;
  }): void;
  /**
   * Binds to the anchor of the latest beginStep; throws Error if beginStep
   * was never called. Emission order is preserved.
   */
  stage(part: AuthoredContextItemPart): StagedInRunContextItem;
  /**
   * undefined when nothing is staged. Otherwise a NEW array: every staged
   * item appears exactly once as `{ role: 'user', content: [{ type: 'text',
   * text: part.data.text }] }`, directly after the `role: 'tool'` message
   * whose content carries `tool-result` with its anchor toolCallId (items
   * sharing an anchor follow each other in emission order), or at the end
   * when the anchor is null or absent. Any earlier copy — a user message
   * whose content is exactly one text part equal to part.data.text — is
   * removed first. Never mutates the input array or any message object in
   * it.
   */
  applyToStep(
    messages: ReadonlyArray<ModelMessage>,
  ): Array<ModelMessage> | undefined;
  items(): ReadonlyArray<StagedInRunContextItem>;
}

/** The toolCallId of the last tool-result part of the last tool message. */
function lastToolCallId(messages: ReadonlyArray<ModelMessage>): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      continue;
    }
    for (let part = message.content.length - 1; part >= 0; part -= 1) {
      const content = message.content[part];
      if (content.type === 'tool-result') {
        return content.toolCallId;
      }
    }
    // The last tool message carries no tool-result (e.g. only approval
    // responses): there is no anchor to bind to.
    return null;
  }
  return null;
}

interface StagedInsertions {
  /** Index in the base messages of the message each item follows. */
  readonly afterMessage: Map<number, Array<ModelMessage>>;
  /** Items whose anchor is null or absent from the base messages. */
  readonly tail: Array<ModelMessage>;
}

function groupInsertions(
  base: Array<ModelMessage>,
  staged: ReadonlyArray<StagedInRunContextItem>,
): StagedInsertions {
  const afterMessage = new Map<number, Array<ModelMessage>>();
  const tail: Array<ModelMessage> = [];
  for (const item of staged) {
    const inserted: ModelMessage = {
      role: 'user',
      content: [{ type: 'text', text: item.part.data.text }],
    };
    const anchor = item.anchorToolCallId;
    const anchorIndex =
      anchor === null
        ? -1
        : base.findIndex(
            (message) =>
              message.role === 'tool' &&
              Array.isArray(message.content) &&
              message.content.some(
                (part) =>
                  part.type === 'tool-result' && part.toolCallId === anchor,
              ),
          );
    if (anchorIndex === -1) {
      tail.push(inserted);
      continue;
    }
    const bucket = afterMessage.get(anchorIndex);
    if (bucket) {
      bucket.push(inserted);
    } else {
      afterMessage.set(anchorIndex, [inserted]);
    }
  }
  return { afterMessage, tail };
}

function spliceInsertions(
  base: Array<ModelMessage>,
  insertions: StagedInsertions,
): Array<ModelMessage> {
  const result: Array<ModelMessage> = [];
  for (let index = 0; index < base.length; index += 1) {
    result.push(base[index]);
    const bucket = insertions.afterMessage.get(index);
    if (bucket) {
      result.push(...bucket);
    }
  }
  result.push(...insertions.tail);
  return result;
}

function spliceStagedItems(
  messages: ReadonlyArray<ModelMessage>,
  staged: ReadonlyArray<StagedInRunContextItem>,
): Array<ModelMessage> {
  const texts = new Set(staged.map((item) => item.part.data.text));
  const base = messages.filter((message) => {
    // A prior insertion of a staged item: exactly one text part with its text.
    if (message.role !== 'user' || !Array.isArray(message.content)) {
      return true;
    }
    if (message.content.length !== 1) {
      return true;
    }
    const part = message.content[0];
    return part.type !== 'text' || !texts.has(part.text);
  });
  return spliceInsertions(base, groupInsertions(base, staged));
}

export function createInRunContextItems(): InRunContextItems {
  const staged: Array<StagedInRunContextItem> = [];
  let current: { anchorToolCallId: string | null; stepNumber: number } | null =
    null;

  return {
    beginStep(step): void {
      current = {
        anchorToolCallId: lastToolCallId(step.messages),
        stepNumber: step.stepNumber,
      };
    },

    stage(part): StagedInRunContextItem {
      if (current === null) {
        throw new Error(
          'Cannot stage an in-Run context item before beginStep().',
        );
      }
      const item: StagedInRunContextItem = {
        part,
        anchorToolCallId: current.anchorToolCallId,
        stepNumber: current.stepNumber,
      };
      staged.push(item);
      return item;
    },

    applyToStep(messages): Array<ModelMessage> | undefined {
      if (staged.length === 0) return undefined;
      return spliceStagedItems(messages, staged);
    },

    items(): ReadonlyArray<StagedInRunContextItem> {
      return [...staged];
    },
  };
}

/** In-Run context producers registered with the Run executor. */
export const IN_RUN_CONTEXT_PRODUCERS = Symbol('IN_RUN_CONTEXT_PRODUCERS');

/** Trusted identity of the attempt a producer authors items for. */
export interface InRunAttempt {
  readonly runId: string;
  readonly chatId: string;
  readonly userId: string;
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
}

export interface InRunContextProducer {
  /** Called once per attempt before its first request. */
  beginAttempt(attempt: InRunAttempt): InRunAttemptProducer;
}
