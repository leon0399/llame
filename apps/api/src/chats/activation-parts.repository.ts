/**
 * The write that puts a Run's skill activations on its triggering user message,
 * and the read that makes a retried Run reuse what a prior attempt persisted.
 *
 * Its own repository rather than another method on `MessagesRepository`: this
 * write has a distinct concern (an ordered, idempotent, run-keyed insert of
 * server-authored context items) and `MessagesRepository` is already at its
 * file-size limit.
 */

import { and, eq } from 'drizzle-orm';
import { compareCodePoints } from '../canonical-json';
import { isString } from '@workspace/runtime-safety';

import { messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  CONTEXT_ITEM_PRODUCERS,
  isContextItemPart,
  type AuthoredContextItemPart,
  type ContextItemPart,
} from './context-item';

/** The producer whose items this repository places. */
const ACTIVATION_PRODUCER = 'skill-activation';

/**
 * Where the activation producer sits in the rail's fixed precedence, so a new
 * item lands at its declared position rather than merely somewhere before the
 * user's text.
 */
const ACTIVATION_RANK = CONTEXT_ITEM_PRODUCERS.indexOf(ACTIVATION_PRODUCER);

export class ActivationPartsRepository {
  constructor(private readonly db: Db) {}

  /**
   * The skills a prior attempt of this Run already RESOLVED, successfully or
   * as a recorded failure.
   *
   * Recovery uses this to replay completed observations instead of re-reading:
   * a package or policy change between attempts must not turn a completed
   * success into a failure, and the event log must not gain a second identity
   * for a read the first attempt already consumed.
   *
   * A selection the prior attempt never reached is deliberately absent — its
   * omission item named it but recorded no outcome — so recovery retries it.
   */
  async resolvedSkillsForRun(input: {
    id: string;
    chatId: string;
    runId: string;
  }): Promise<ReadonlySet<string>> {
    const [row] = await this.db
      .select({ parts: messages.parts })
      .from(messages)
      .where(
        and(
          eq(messages.id, input.id),
          eq(messages.chatId, input.chatId),
          eq(messages.role, 'user'),
        ),
      );
    const parts = Array.isArray(row?.parts) ? row.parts : [];
    const resolved = new Set<string>();
    for (const part of parts) {
      if (!isContextItemPart(part)) continue;
      if (part.data.producer !== ACTIVATION_PRODUCER) continue;
      if (part.data.runId !== input.runId) continue;
      const kind = part.data.payload['kind'];
      if (kind !== 'activation' && kind !== 'failure') continue;
      const skill: unknown = part.data.payload['skill'];
      if (isString(skill)) resolved.add(skill);
    }
    return resolved;
  }

  /**
   * Insert this Run's activation context items at their rail position, or report
   * that a prior attempt already did.
   *
   * Three properties matter, and each is why this is a row-locked
   * read-modify-write rather than a jsonb concatenation:
   *
   * - **Position.** Items land where the rail's producer precedence places
   *   them — after tool availability and the catalog notice, before the digest,
   *   the temporal anchor, and the user's own text. Appending instead would put
   *   an activation block after the words it responds to.
   * - **Idempotence.** A retry finds its items present and inserts nothing, so
   *   recovery replays the STORED text rather than re-reading a package that
   *   may have changed. The check keys on the producer AND the Run, because
   *   every accepted message already carries this Run's temporal item.
   * - **Serialization.** The row is locked for the read and the write, so two
   *   concurrent attempts at one Run cannot both observe an empty set. Callers
   *   already run this inside the accepted-turn transaction.
   */
  async appendForRun(input: {
    id: string;
    chatId: string;
    runId: string;
    items: ReadonlyArray<AuthoredContextItemPart>;
  }): Promise<{ readonly applied: boolean }> {
    if (input.items.length === 0) return { applied: false };
    const owner = and(
      eq(messages.id, input.id),
      eq(messages.chatId, input.chatId),
      eq(messages.role, 'user'),
    );
    const [row] = await this.db
      .select({ parts: messages.parts })
      .from(messages)
      .where(owner)
      .for('update');
    if (row === undefined) return { applied: false };

    const parts = Array.isArray(row.parts) ? row.parts : [];
    // Per-ITEM idempotence, not per-Run. A retry legitimately produces items the
    // prior attempt did not: a selection its byte budget dropped is reported
    // unattempted and left unpersisted, then read again on the retry. Skipping
    // the whole append because one item already existed would discard those
    // fresh instructions while the stale omission notice stayed effective, so
    // the model would never see them.
    const stored = storedIdentities(parts, input.runId);
    const fresh = input.items.filter(
      (item) => !stored.has(activationIdentity(item)),
    );
    if (fresh.length === 0) return { applied: false };

    const index = railInsertionIndex(parts);
    const [updated] = await this.db
      .update(messages)
      .set({
        parts: [...parts.slice(0, index), ...fresh, ...parts.slice(index)],
      })
      .where(owner)
      .returning({ id: messages.id });
    return { applied: updated !== undefined };
  }
}

/**
 * A producer's index in the rail's precedence, or -1 for a name this revision
 * does not know — which is treated as "after ours" so a newer revision's items
 * keep the position that revision chose.
 */
function producerRank(producer: string): number {
  return CONTEXT_ITEM_PRODUCERS.findIndex((known) => known === producer);
}

/** Whether this Run's ACTIVATION items are already stored. */
/**
 * What identifies one activation item for idempotence.
 *
 * A per-selection item is identified by its selection, so re-reading the same
 * skill is a no-op while a newly resolved one is not. An omission item is
 * identified by the set of names it reports, so a retry that omits exactly the
 * same remainder adds nothing and one that omits a different remainder is
 * recorded.
 */
function activationIdentity(part: ContextItemPart): string {
  const payload = part.data.payload;
  const kind = String(payload['kind']);
  if (kind === 'omission') {
    const skills: unknown = payload['skills'];
    if (!Array.isArray(skills)) return 'omission:';
    const names = skills.filter(isString);
    return `omission:${[...names].sort(compareCodePoints).join(',')}`;
  }
  const skill: unknown = payload['skill'];
  return `${kind}:${isString(skill) ? skill : ''}`;
}

/** The identities this Run's activation items already carry. */
function storedIdentities(
  parts: ReadonlyArray<unknown>,
  runId: string,
): ReadonlySet<string> {
  const identities = new Set<string>();
  for (const part of parts) {
    if (!isContextItemPart(part)) continue;
    if (part.data.producer !== ACTIVATION_PRODUCER) continue;
    if (part.data.runId !== runId) continue;
    identities.add(activationIdentity(part));
  }
  return identities;
}

function railInsertionIndex(parts: ReadonlyArray<unknown>): number {
  for (const [index, part] of parts.entries()) {
    if (!isContextItemPart(part)) return index;
    const rank = producerRank(part.data.producer);
    if (rank === -1 || rank > ACTIVATION_RANK) return index;
  }
  return parts.length;
}
