/**
 * The pure projection an owner fork applies to its source
 * (complete-owner-forks D2-D3): which storage identities the copy allocates,
 * which Chat-row state travels with it, and what the copied message rows look
 * like. `ChatsService` owns the transaction and the writes; everything decided
 * here is decided without a database.
 *
 * Split out of `chats.service.ts` for the same reason as its siblings
 * (`assistant-completion.ts`, `message-eligibility.ts`): the rule is worth
 * reading on its own, and the service should read as the sequence of writes it
 * performs.
 */

import { type Chat, type Compaction, type MessageRole } from '../db/schema';
import { type ChatInheritedValues } from './chats-repository';

/**
 * A source row either fork path copies. `createdAt`/`usage` are the owner
 * fork's verbatim copy of a turn's time and price; the shared fork omits both,
 * so its rows stay exactly what the public projection describes.
 */
export type CopyableMessage = {
  id: string;
  role: MessageRole;
  parts: Array<unknown>;
  senderUserId: string | null;
  attachments: Array<unknown>;
  inReplyTo: string | null;
  createdAt?: Date;
  usage?: unknown;
};

/**
 * Repoint one of a Chat row's re-bake markers at the fork's copies of the
 * compactions. `baselineMatchesEpoch` reuses a stored baseline only while its
 * marker equals the chat's active (latest) compaction id, so each case is
 * forced:
 *
 * - `null` stays `null` — the source re-resolves that baseline, and the fork
 *   has to re-resolve it the same way rather than pinning a baseline the
 *   source would replace;
 * - a marker naming a COPIED compaction becomes that copy's new id;
 * - a marker naming a compaction OUTSIDE the copied prefix (the anchor stopped
 *   before that checkpoint) becomes the copied active compaction's new id, or
 *   `null` when the prefix copied none. Leaving the stale id in place, or
 *   nulling it beside a copied baseline, would make the fork's first turn
 *   re-resolve the live catalog and change its system prompt.
 */
function remapRebakeMarker(
  marker: string | null,
  copiedCompactionIds: ReadonlyMap<string, string>,
  activeCompactionId: string | null,
): string | null {
  if (marker === null) return null;
  return copiedCompactionIds.get(marker) ?? activeCompactionId;
}

/**
 * The fork's compaction identities and the Chat-row values that reference
 * them, decided together: the destination Chat row must already name the
 * checkpoints its baselines were re-baked at, so the ids are pre-assigned
 * before anything is inserted. `compactions` is the prefix's lineage
 * oldest-first, so its last row is the copied chat's active checkpoint.
 *
 * The frozen baselines and told-sets travel verbatim — the fork continues the
 * disclosure the source made, rather than resolving its own.
 */
export function inheritForkedChatState(
  source: Chat,
  compactions: ReadonlyArray<Compaction>,
) {
  const compactionIds = new Map<string, string>(
    compactions.map((compaction) => [compaction.id, crypto.randomUUID()]),
  );
  const active = compactions.at(-1);
  const activeCompactionId =
    active === undefined ? null : (compactionIds.get(active.id) ?? null);

  return {
    compactionIds,
    inherited: {
      createdAt: source.createdAt,
      recencyDigestBaseline: source.recencyDigestBaseline,
      recencyDigestTold: source.recencyDigestTold,
      recencyDigestRebakedFrom: remapRebakeMarker(
        source.recencyDigestRebakedFrom,
        compactionIds,
        activeCompactionId,
      ),
      skillCatalogBaseline: source.skillCatalogBaseline,
      skillCatalogTold: source.skillCatalogTold,
      skillCatalogRebakedFrom: remapRebakeMarker(
        source.skillCatalogRebakedFrom,
        compactionIds,
        activeCompactionId,
      ),
    } satisfies ChatInheritedValues,
  };
}

/**
 * The copied message rows, in source order with dense sequences from 1. Ids
 * are pre-assigned before any insert — `createMany`'s chunked bulk insert has
 * no per-row RETURNING to learn a new id mid-batch, and a reply's `inReplyTo`
 * only ever points to an earlier row in the same prefix (lower `seq`), so
 * every reference is guaranteed to already be mapped.
 *
 * Only storage identity is rewritten. Nothing inside `parts` or `usage` is
 * touched, so a copied assistant keeps the tool-call ids and the original Run
 * id its history recorded, as values.
 */
export function copiedMessageRows(
  toCopy: ReadonlyArray<CopyableMessage>,
  chatId: string,
): Array<{
  id: string;
  chatId: string;
  seq: number;
  role: MessageRole;
  senderUserId: string | null;
  parts: Array<unknown>;
  attachments: Array<unknown>;
  inReplyTo: string | null;
  createdAt?: Date;
  usage?: unknown;
}> {
  const idMap = new Map(toCopy.map((m) => [m.id, crypto.randomUUID()]));
  return toCopy.map((message, index) => ({
    id: idMap.get(message.id)!,
    chatId,
    seq: index + 1,
    role: message.role,
    senderUserId: message.senderUserId,
    parts: message.parts,
    attachments: message.attachments,
    inReplyTo: message.inReplyTo
      ? (idMap.get(message.inReplyTo) ?? null)
      : null,
    // Both forks pass all-or-nothing: an absent value reaches the INSERT as
    // `undefined` and so takes the column default (`now()` for `createdAt`,
    // NULL for `usage`) rather than an explicit null. The shared fork omits
    // both, which is how its rows keep no time or price of their own.
    createdAt: message.createdAt,
    usage: message.usage,
  }));
}
