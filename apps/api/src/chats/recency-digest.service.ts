import { Inject, Injectable } from '@nestjs/common';

import {
  type Chat,
  type RecencyDigestBaseline as StoredRecencyDigestBaseline,
  type RecencyDigestToldEntry,
} from '../db/schema';
import {
  TenantDbService,
  type Db,
  type TenantRunner,
} from '../db/tenant-db.service';
import { type PromptChatsDisclosure } from '../models/model-catalog';
import { isTextPart } from './context-builder';
import { ChatsRepository, MessagesRepository } from './chats-repository';

export const RECENCY_DIGEST_LIST_LIMIT = 10;
export const RECENCY_DIGEST_EXCERPT_MAX_CODE_POINTS = 200;

type DigestSourceMessage = {
  parts: ReadonlyArray<unknown>;
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
  pinned: ReadonlyArray<StoredRecencyDigestBaseline['pinned'][number]>;
  recent: ReadonlyArray<StoredRecencyDigestBaseline['pinned'][number]>;
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
  /** Candidate identity and rendered entry are one record, never parallel arrays. */
  candidates: ReadonlyArray<RecencyDigestCandidate>;
};

export type RecencyDigestResolver = Pick<
  RecencyDigestService,
  'resolveCandidate'
>;

export type RecencyDigestDelta = {
  entries: Array<RecencyDigestBaseline['pinned'][number] & { pinned: boolean }>;
  pinChanges: Array<{ title: string; pinned: boolean }>;
  told: Array<RecencyDigestToldEntry>;
};

type RecencyDigestEntry = RecencyDigestBaseline['pinned'][number];

/**
 * Whether two entries show the same chat. Last activity and message count are
 * left out: they move with the chat's own activity, which the digest never
 * announces, so they cannot make a chat the model was shown a different one.
 */
function showsSameChat(left: RecencyDigestEntry, right: RecencyDigestEntry) {
  return left.title === right.title && left.excerpt === right.excerpt;
}

/**
 * The chats a request's renders actually told the model about, keyed to the
 * trusted candidates this attempt resolved.
 *
 * Renders report positions in the baseline they were given, because the
 * stored baseline deliberately carries no chat id. A disclosed position pairs
 * first with a candidate in the same list whose entry is identical — every
 * position, when an initializing attempt renders its own candidate baseline —
 * and otherwise with a candidate that `showsSameChat`. A disclosed entry no
 * candidate matches stays untold and can enter through an append; each
 * candidate pairs at most once. The pin state recorded is the list the entry
 * was rendered in: what the model was told.
 */
export function disclosedRecencyDigestEntries(input: {
  baseline: RecencyDigestBaseline;
  disclosures: ReadonlyArray<PromptChatsDisclosure>;
  candidates: ReadonlyArray<RecencyDigestCandidate>;
}): Array<RecencyDigestToldEntry> {
  const disclosed = (['pinned', 'recent'] as const).flatMap((list) =>
    input.baseline[list].flatMap((entry, index) =>
      input.disclosures.some((disclosure) => disclosure[list].has(index))
        ? [{ entry, pinned: list === 'pinned' }]
        : [],
    ),
  );
  const unpaired = [...input.candidates];
  const pair = (
    matches: (candidate: RecencyDigestCandidate) => boolean,
  ): RecencyDigestCandidate | undefined => {
    const index = unpaired.findIndex(matches);
    return index === -1 ? undefined : unpaired.splice(index, 1)[0];
  };
  // Exact pairs are settled before any looser one, so a look-alike chat can
  // never take the candidate a later entry is identical to.
  const exact = disclosed.map(({ entry, pinned }) =>
    pair(
      (candidate) =>
        candidate.pinned === pinned &&
        showsSameChat(candidate.entry, entry) &&
        candidate.entry.date === entry.date &&
        candidate.entry.messageCount === entry.messageCount,
    ),
  );
  return disclosed.flatMap(({ entry, pinned }, index) => {
    const candidate =
      exact[index] ?? pair((each) => showsSameChat(each.entry, entry));
    return candidate === undefined
      ? []
      : [{ chatId: candidate.chatId, pinned, title: entry.title }];
  });
}

/**
 * Capped candidate views control new disclosure; the accumulated told-set
 * controls corrections. Keeping those inputs separate prevents both a corpus
 * dump and fabricated unpins when the cap displaces an still-pinned chat.
 *
 * `told` is everything the model has been told, including what this request's
 * renders disclose, so an entry the prompt already shows is not announced
 * again.
 */
export function deriveRecencyDigestDelta(input: {
  candidate: RecencyDigestResolution;
  told: ReadonlyArray<RecencyDigestToldEntry>;
  pinnedChatIds: ReadonlySet<string>;
}): RecencyDigestDelta | null {
  const toldByChatId = new Map(
    input.told.map((entry) => [entry.chatId, entry]),
  );
  // Pairing separately-built arrays here could announce one chat with another
  // chat's title/excerpt: an owner-scoped cross-chat content leak.
  const untold = input.candidate.candidates.filter(
    (candidate) => !toldByChatId.has(candidate.chatId),
  );
  const entries = untold.map((candidate) => ({
    ...candidate.entry,
    pinned: candidate.pinned,
  }));
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
    ...untold.map(({ chatId, pinned, entry }) => ({
      chatId,
      pinned,
      title: entry.title,
    })),
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
      (tx) =>
        this.resolveCandidateInTransaction(tx, ownerUserId, currentChatId),
      { isolationLevel: 'repeatable read' },
    );
  }

  /** The pinned/recent candidate lists and their population counts, one round-trip each. */
  private async fetchDigestCandidateLists(
    chats: ChatsRepository,
    ownerUserId: string,
    currentChatId: string,
  ): Promise<{
    pinned: Array<Chat>;
    recent: Array<Chat>;
    pinnedTotal: number;
    recentTotal: number;
  }> {
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
    return { pinned, recent, pinnedTotal, recentTotal };
  }

  /** Two set-scoped queries for every candidate, not one pair per chat. */
  private async hydrateDigestChats(
    messages: MessagesRepository,
    chats: ReadonlyArray<Chat>,
    ownerUserId: string,
  ): Promise<Array<DigestSourceChat>> {
    const candidateIds = chats.map(({ id }) => id);
    const [firstUserMessages, counts] = await Promise.all([
      messages.findEarliestUserMessagePerChat(candidateIds, ownerUserId),
      messages.countPerChat(candidateIds, ownerUserId),
    ]);
    const firstUserByChat = new Map(
      firstUserMessages.map((message) => [message.chatId, message]),
    );
    return chats.map((chat): DigestSourceChat => ({
      ...chat,
      firstUserMessage: firstUserByChat.get(chat.id),
      messageCount: counts.get(chat.id) ?? 0,
    }));
  }

  /**
   * Kept as two named lists rather than one merged array re-split by the
   * `pinned` flag assigned here: the partition is already known by the
   * caller, and the same entry objects feed both the baseline and the
   * candidates, so the two cannot disagree.
   */
  private buildDigestCandidates(
    hydratedPinned: ReadonlyArray<DigestSourceChat>,
    hydratedRecent: ReadonlyArray<DigestSourceChat>,
  ) {
    const toCandidate = (
      chat: DigestSourceChat,
      pinned: boolean,
    ): RecencyDigestCandidate => ({
      chatId: chat.id,
      pinned,
      entry: toDigestEntry(chat),
    });
    const pinnedCandidates = hydratedPinned.map((chat) =>
      toCandidate(chat, true),
    );
    const recentCandidates = hydratedRecent.map((chat) =>
      toCandidate(chat, false),
    );
    return {
      pinnedCandidates,
      recentCandidates,
      candidates: [...pinnedCandidates, ...recentCandidates],
    };
  }

  private async resolveCandidateInTransaction(
    tx: Db,
    ownerUserId: string,
    currentChatId: string,
  ): Promise<RecencyDigestResolution> {
    const chats = new ChatsRepository(tx);
    const messages = new MessagesRepository(tx);
    const { pinned, recent, pinnedTotal, recentTotal } =
      await this.fetchDigestCandidateLists(chats, ownerUserId, currentChatId);

    const hydrated = await this.hydrateDigestChats(
      messages,
      [...pinned, ...recent],
      ownerUserId,
    );
    const hydratedPinned = hydrated.slice(0, pinned.length);
    const hydratedRecent = hydrated.slice(pinned.length);
    const { pinnedCandidates, recentCandidates, candidates } =
      this.buildDigestCandidates(hydratedPinned, hydratedRecent);
    return {
      baseline: buildRecencyDigestBaseline({
        pinned: pinnedCandidates.map(({ entry }) => entry),
        recent: recentCandidates.map(({ entry }) => entry),
        pinnedTotal,
        recentTotal,
        compiledOn: new Date(),
      }),
      candidates,
    };
  }
}
