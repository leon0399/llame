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
  role: string;
  seq: number;
  parts: unknown[];
};

type DigestSourceChat = Pick<Chat, 'id' | 'title' | 'updatedAt'> & {
  messages: readonly DigestSourceMessage[];
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
  const firstUser = [...chat.messages]
    .sort((a, b) => a.seq - b.seq)
    .find((message) => message.role === 'user');
  const excerpt = firstUser
    ? firstUser.parts
        .filter(isTextPart)
        .map((part) => part.text)
        .join('\n')
    : '';

  return {
    title: chat.title!,
    date: chat.updatedAt.toISOString().slice(0, 10),
    messageCount: chat.messages.length,
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
      const hydrate = async (chat: Chat): Promise<DigestSourceChat> => ({
        ...chat,
        messages: await messages.findByChatId(chat.id, ownerUserId),
      });
      const [hydratedPinned, hydratedRecent] = await Promise.all([
        Promise.all(pinned.map(hydrate)),
        Promise.all(recent.map(hydrate)),
      ]);
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
