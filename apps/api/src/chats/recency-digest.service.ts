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
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
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
        chats.countByOwner(ownerUserId, {
          pinned: 'with',
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
    });
  }
}
