/**
 * The write that puts a Run's prompt-import item on its triggering user
 * message, and the read that makes a retried Run reuse what a prior attempt
 * persisted.
 *
 * Mirrors `ActivationPartsRepository` for exactly one `prompt-imports` item per
 * Run: a row-locked read-modify-write whose second append for the same Run is a
 * no-op, so recovery replays the stored text instead of re-reading targets.
 */

import { and, eq } from 'drizzle-orm';

import { messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  CONTEXT_ITEM_PRODUCERS,
  isContextItemPart,
  type AuthoredContextItemPart,
  type ContextItemPart,
} from './context-item';
import {
  isPromptImportsPayload,
  type PromptImportsPayload,
} from './prompt-imports-item';

/** The producer whose item this repository places. */
const PROMPT_IMPORTS_PRODUCER = 'prompt-imports';

/** Where the producer sits in the rail's fixed precedence. */
const PROMPT_IMPORTS_RANK = CONTEXT_ITEM_PRODUCERS.indexOf(
  PROMPT_IMPORTS_PRODUCER,
);

/** A stored `prompt-imports` item whose payload passed this producer's validator. */
export type PromptImportsPart = Omit<ContextItemPart, 'data'> & {
  readonly data: Omit<ContextItemPart['data'], 'payload'> & {
    readonly payload: PromptImportsPayload;
  };
};

export class PromptImportPartsRepository {
  constructor(private readonly db: Db) {}

  /**
   * The `prompt-imports` item a prior attempt of this Run persisted, so a
   * retry or worker resumption reuses completed results without rereading.
   * An item that fails the producer's payload validation is treated as absent.
   */
  async findForRun(input: {
    id: string;
    chatId: string;
    runId: string;
  }): Promise<PromptImportsPart | undefined> {
    const [row] = await this.db
      .select({ parts: messages.parts })
      .from(messages)
      .where(messageOwner(input));
    const parts: ReadonlyArray<unknown> = Array.isArray(row?.parts)
      ? row.parts
      : [];
    return parts.find((part): part is PromptImportsPart =>
      isRunPromptImportsPart(part, input.runId),
    );
  }

  /**
   * Insert this Run's item at its rail position — after `skill-activation`
   * items, before the digest, the temporal anchor, and the user's own text — or
   * report that a prior attempt already did.
   *
   * The row is locked for the read and the write so two concurrent attempts at
   * one Run cannot both observe an empty set. The idempotence check keys on the
   * producer AND the Run, because every accepted message already carries other
   * producers' items for this Run.
   */
  async appendForRun(input: {
    id: string;
    chatId: string;
    runId: string;
    item: AuthoredContextItemPart;
  }): Promise<{ readonly applied: boolean }> {
    const parts = await this.lockParts(input);
    if (parts === undefined) return { applied: false };
    const stored = parts.some(
      (part) =>
        isContextItemPart(part) &&
        part.data.producer === PROMPT_IMPORTS_PRODUCER &&
        part.data.runId === input.runId,
    );
    if (stored) return { applied: false };

    const index = railInsertionIndex(parts);
    const [updated] = await this.db
      .update(messages)
      .set({
        parts: [...parts.slice(0, index), input.item, ...parts.slice(index)],
      })
      .where(messageOwner(input))
      .returning({ id: messages.id });
    return { applied: updated !== undefined };
  }

  /** The message's stored parts, with the row locked for this read and write. */
  private async lockParts(input: {
    id: string;
    chatId: string;
  }): Promise<ReadonlyArray<unknown> | undefined> {
    const [row] = await this.db
      .select({ parts: messages.parts })
      .from(messages)
      .where(messageOwner(input))
      .for('update');
    if (row === undefined) return undefined;
    return Array.isArray(row.parts) ? row.parts : [];
  }
}

/** The owner-scoped predicate every read and write here shares. */
function messageOwner(input: { id: string; chatId: string }) {
  return and(
    eq(messages.id, input.id),
    eq(messages.chatId, input.chatId),
    eq(messages.role, 'user'),
  );
}

/** `isContextItemPart` validates the envelope only; the payload is ours to check. */
function isRunPromptImportsPart(
  part: unknown,
  runId: string,
): part is PromptImportsPart {
  return (
    isContextItemPart(part) &&
    part.data.producer === PROMPT_IMPORTS_PRODUCER &&
    part.data.runId === runId &&
    isPromptImportsPayload(part.data.payload)
  );
}

/**
 * The first position whose part is user text, an unrecognized producer (kept
 * "after ours" so a newer revision's items keep the position it chose), or a
 * producer ranked after `prompt-imports`.
 */
function railInsertionIndex(parts: ReadonlyArray<unknown>): number {
  for (const [index, part] of parts.entries()) {
    if (!isContextItemPart(part)) return index;
    const rank = CONTEXT_ITEM_PRODUCERS.findIndex(
      (known) => known === part.data.producer,
    );
    if (rank === -1 || rank > PROMPT_IMPORTS_RANK) return index;
  }
  return parts.length;
}
