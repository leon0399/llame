import { Inject, Injectable } from '@nestjs/common';

import {
  type Chat,
  type RecencyDigestBaseline as StoredRecencyDigestBaseline,
  type RecencyDigestToldEntry,
} from '../db/schema';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import { isTextPart } from './context-builder';
import { ChatsRepository, MessagesRepository } from './chats-repository';

export const RECENCY_DIGEST_LIST_LIMIT = 10;
export const RECENCY_DIGEST_EXCERPT_MAX_CODE_POINTS = 200;

type DigestSourceMessage = {
  parts: readonly unknown[];
};

/**
 * Exactly what an entry is derived from — the chat's earliest user message and
 * its stored message count — rather than its whole history.
 *
 * Naming the two values the digest actually reads keeps the resolver from
 * fetching every row of a long or compacted chat to use its first one, and
 * makes the query shape the type's responsibility rather than the caller's.
 */
type DigestSourceChat = Pick<Chat, 'id' | 'title' | 'updatedAt'> & {
  firstUserMessage: DigestSourceMessage | undefined;
  messageCount: number;
};

export type RecencyDigestBaseline = StoredRecencyDigestBaseline;

export function truncateRecencyDigestExcerpt(value: string): string {
  return Array.from(value)
    .slice(0, RECENCY_DIGEST_EXCERPT_MAX_CODE_POINTS)
    .join('');
}

function toDigestEntry(
  chat: DigestSourceChat,
): StoredRecencyDigestBaseline['pinned'][number] {
  const excerpt = chat.firstUserMessage
    ? chat.firstUserMessage.parts
        .filter(isTextPart)
        .map((part) => part.text)
        .join('\n')
    : '';

  return {
    title: chat.title!,
    date: chat.updatedAt.toISOString().slice(0, 10),
    messageCount: chat.messageCount,
    ...(excerpt.length > 0
      ? { excerpt: truncateRecencyDigestExcerpt(excerpt) }
      : {}),
  };
}

export function buildRecencyDigestBaseline(input: {
  pinned: readonly DigestSourceChat[];
  recent: readonly DigestSourceChat[];
  pinnedTotal: number;
  recentTotal: number;
  compiledOn: Date;
}): RecencyDigestBaseline {
  return {
    pinned: input.pinned.map(toDigestEntry),
    recent: input.recent.map(toDigestEntry),
    pinnedShown: input.pinned.length,
    pinnedTotal: input.pinnedTotal,
    recentShown: input.recent.length,
    recentTotal: input.recentTotal,
    compiledOn: input.compiledOn.toISOString().slice(0, 10),
  };
}

/** Narrow resolver used by the chat turn, never by a public/shared read path. */
export type RecencyDigestResolution = {
  baseline: RecencyDigestBaseline;
  told: RecencyDigestToldEntry[];
};

export type RecencyDigestResolver = Pick<
  RecencyDigestService,
  'resolveCandidate'
>;

export type RecencyDigestDelta = {
  entries: Array<RecencyDigestBaseline['pinned'][number] & { pinned: boolean }>;
  pinChanges: Array<{ pinned: boolean }>;
  told: RecencyDigestToldEntry[];
};

/**
 * Capped candidate views control new disclosure; the accumulated told-set
 * controls corrections. Keeping those inputs separate prevents both a corpus
 * dump and fabricated unpins when the cap displaces an still-pinned chat.
 */
export function deriveRecencyDigestDelta(input: {
  candidate: RecencyDigestResolution;
  told: readonly RecencyDigestToldEntry[];
  pinnedChatIds: ReadonlySet<string>;
}): RecencyDigestDelta | null {
  const toldByChatId = new Map(
    input.told.map((entry) => [entry.chatId, entry]),
  );
  const candidateEntries = [
    ...input.candidate.baseline.pinned,
    ...input.candidate.baseline.recent,
  ];
  const entries = input.candidate.told.flatMap((candidate, index) =>
    toldByChatId.has(candidate.chatId)
      ? []
      : [{ ...candidateEntries[index], pinned: candidate.pinned }],
  );
  const pinChanges = input.told.flatMap((entry) => {
    const pinned = input.pinnedChatIds.has(entry.chatId);
    return pinned === entry.pinned ? [] : [{ pinned }];
  });
  if (entries.length === 0 && pinChanges.length === 0) return null;

  const told = [
    ...input.told.map((entry) => ({
      chatId: entry.chatId,
      pinned: input.pinnedChatIds.has(entry.chatId),
    })),
    ...input.candidate.told.filter((entry) => !toldByChatId.has(entry.chatId)),
  ];
  return { entries, pinChanges, told };
}

@Injectable()
export class RecencyDigestService {
  constructor(
    // The narrow capability type erases to `Object` at runtime and so carries
    // no DI metadata of its own (#268), which makes the token explicit rather
    // than optional — without it Nest resolves the argument as undefined and
    // the app fails to boot. Same shape as `ChatLoopService`.
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
  ) {}

  async resolveCandidate(
    ownerUserId: string,
    currentChatId: string,
  ): Promise<RecencyDigestResolution> {
    // REPEATABLE READ: the four selection queries below must observe ONE
    // database snapshot. Under the default READ COMMITTED each statement takes
    // its own, so a pin added or removed mid-resolution can let the same chat
    // be picked by the pinned query before the change and the recent query
    // after it — freezing a duplicate entry into an immutable baseline and a
    // contradictory told-set — and can leave the counts disagreeing with the
    // lists they are denominators for. This resolver only reads, so the
    // stricter level costs nothing but a retry on the serialization errors it
    // is designed to surface.
    return this.tenantDb.runAs(
      ownerUserId,
      async (tx) => {
        const chats = new ChatsRepository(tx);
        const messages = new MessagesRepository(tx);
        const [pinned, recent, pinnedTotal, recentTotal] = await Promise.all([
          chats.findByOwner(ownerUserId, {
            pinned: 'only',
            limit: RECENCY_DIGEST_LIST_LIMIT,
            excludeId: currentChatId,
            titledOnly: true,
          }),
          chats.findByOwner(ownerUserId, {
            pinned: 'exclude',
            limit: RECENCY_DIGEST_LIST_LIMIT,
            excludeId: currentChatId,
            titledOnly: true,
          }),
          chats.countByOwner(ownerUserId, {
            pinned: 'only',
            excludeId: currentChatId,
            titledOnly: true,
          }),
          // 'exclude', not 'with': the recent list is drawn from eligible chats
          // that are NOT pinned, and a denominator must describe the population
          // its list comes from. Counting all eligible chats would report a
          // ratio against a set the list is not selected from — 10 of 247 where
          // 30 of those are pinned and unreachable by this list.
          chats.countByOwner(ownerUserId, {
            pinned: 'exclude',
            excludeId: currentChatId,
            titledOnly: true,
          }),
        ]);
        // Two set-scoped queries for every candidate, not one pair per chat.
        const candidateIds = [...pinned, ...recent].map(({ id }) => id);
        const [firstUserMessages, counts] = await Promise.all([
          messages.findEarliestUserMessagePerChat(candidateIds, ownerUserId),
          messages.countPerChat(candidateIds, ownerUserId),
        ]);
        const firstUserByChat = new Map(
          firstUserMessages.map((message) => [message.chatId, message]),
        );
        const hydrate = (chat: Chat): DigestSourceChat => ({
          ...chat,
          firstUserMessage: firstUserByChat.get(chat.id),
          messageCount: counts.get(chat.id) ?? 0,
        });
        const hydratedPinned = pinned.map(hydrate);
        const hydratedRecent = recent.map(hydrate);
        return {
          baseline: buildRecencyDigestBaseline({
            pinned: hydratedPinned,
            recent: hydratedRecent,
            pinnedTotal,
            recentTotal,
            compiledOn: new Date(),
          }),
          told: [
            ...pinned.map(({ id }) => ({ chatId: id, pinned: true })),
            ...recent.map(({ id }) => ({ chatId: id, pinned: false })),
          ],
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}
