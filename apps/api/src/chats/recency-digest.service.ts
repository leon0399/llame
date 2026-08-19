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

type RecencyDigestCandidate = {
  chatId: string;
  pinned: boolean;
  entry: RecencyDigestBaseline['pinned'][number];
};

export function truncateRecencyDigestExcerpt(value: string): string {
  return Array.from(value)
    .slice(0, RECENCY_DIGEST_EXCERPT_MAX_CODE_POINTS)
    .join('');
}

export function toDigestEntry(
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
    ...(excerpt.length > 0 && {
      excerpt: truncateRecencyDigestExcerpt(excerpt),
    }),
  };
}

/**
 * The single place the rendered baseline shape is assembled.
 *
 * Takes already-rendered entries rather than source chats so the resolver can
 * reuse the very same entry objects for its candidate records — otherwise the
 * baseline gets assembled in two places that can silently drift on a format or
 * field change, and this function ends up production-dead while its tests still
 * claim to cover what ships.
 */
export function buildRecencyDigestBaseline(input: {
  pinned: readonly StoredRecencyDigestBaseline['pinned'][number][];
  recent: readonly StoredRecencyDigestBaseline['pinned'][number][];
  pinnedTotal: number;
  recentTotal: number;
  compiledOn: Date;
}): RecencyDigestBaseline {
  return {
    pinned: [...input.pinned],
    recent: [...input.recent],
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
  /** Candidate identity and rendered entry are one record, never parallel arrays. */
  candidates: readonly RecencyDigestCandidate[];
};

export type RecencyDigestResolver = Pick<
  RecencyDigestService,
  'resolveCandidate'
>;

export type RecencyDigestDelta = {
  entries: Array<RecencyDigestBaseline['pinned'][number] & { pinned: boolean }>;
  pinChanges: Array<{ title: string; pinned: boolean }>;
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
  // Pairing separately-built arrays here could announce one chat with another
  // chat's title/excerpt: an owner-scoped cross-chat content leak.
  const entries = input.candidate.candidates.flatMap((candidate) =>
    toldByChatId.has(candidate.chatId)
      ? []
      : [{ ...candidate.entry, pinned: candidate.pinned }],
  );
  // One pass over the told-set: current pin state is read once per entry and
  // used for both the correction it may emit and the state it carries forward.
  const pinChanges: RecencyDigestDelta['pinChanges'] = [];
  const carriedForward = input.told.map((entry) => {
    const pinned = input.pinnedChatIds.has(entry.chatId);
    // A told entry persisted before titles were recorded cannot name its own
    // chat. Fail closed — say nothing rather than author an un-attributable
    // pin event.
    if (pinned !== entry.pinned && entry.title) {
      pinChanges.push({ title: entry.title, pinned });
    }
    return {
      chatId: entry.chatId,
      pinned,
      ...(entry.title && { title: entry.title }),
    };
  });
  if (entries.length === 0 && pinChanges.length === 0) return null;

  const told = [
    ...carriedForward,
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
    // REPEATABLE READ: the selection queries below must observe ONE database
    // snapshot. Under the default READ COMMITTED each statement takes its own,
    // so a pin added or removed mid-resolution can let the same chat be picked
    // by the pinned query before the change and the recent query after it —
    // freezing a duplicate entry into an immutable baseline with a
    // contradictory told-set — and can leave the counts disagreeing with the
    // lists they are denominators for. This resolver only reads, so the
    // stricter level costs nothing but a retry on the serialization errors it
    // exists to surface.
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
          // its list comes from.
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
        const toCandidate = (chat: DigestSourceChat, pinned: boolean) => ({
          chatId: chat.id,
          pinned,
          entry: toDigestEntry(chat),
        });
        // Kept as two named lists rather than one merged array re-split by the
        // `pinned` flag we just assigned: the partition is already known here,
        // and the same entry objects feed both the baseline and the candidates,
        // so the two cannot disagree.
        const pinnedCandidates = hydratedPinned.map((chat) =>
          toCandidate(chat, true),
        );
        const recentCandidates = hydratedRecent.map((chat) =>
          toCandidate(chat, false),
        );
        const candidates = [...pinnedCandidates, ...recentCandidates];
        return {
          baseline: buildRecencyDigestBaseline({
            pinned: pinnedCandidates.map(({ entry }) => entry),
            recent: recentCandidates.map(({ entry }) => entry),
            pinnedTotal,
            recentTotal,
            compiledOn: new Date(),
          }),
          told: candidates.map(({ chatId, pinned, entry }) => ({
            chatId,
            pinned,
            title: entry.title,
          })),
          candidates,
        };
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}
