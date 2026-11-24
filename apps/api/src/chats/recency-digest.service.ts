import { Inject, Injectable } from '@nestjs/common';
import { visibleMessageText } from './conversation-evidence';
import { type Chat, type Message } from '../db/schema';
import {
  TenantDbService,
  type Db,
  type TenantRunner,
} from '../db/tenant-db.service';
import {
  type ChatRow,
  canonicalWorkspaceLocator,
  formatChatExcerpt,
} from './chat-row';
import { ChatsRepository } from './chats-repository';
import {
  countEligiblePerOwnedChat,
  findEarliestUserMessagePerChat,
  findLatestAssistantPerOwnedChat,
} from './recency-digest-message-projections';
import {
  type DigestAnnouncedEntry,
  renderRecencyDigestBaseline,
} from './recency-digest-item';

export const RECENCY_DIGEST_LIST_LIMIT = 10;

function announcedEntry(row: ChatRow, pinned: boolean): DigestAnnouncedEntry {
  return {
    chatId: row.chatId,
    pinned,
    ...(row.title !== null && { title: row.title }),
    workspace: row.workspace,
  };
}

export type RecencyDigestResolution = {
  readonly rows: ReadonlyArray<ChatRow>;
  readonly announced: ReadonlyArray<DigestAnnouncedEntry>;
  readonly pinnedShown: number;
  readonly pinnedTotal: number;
  readonly recentShown: number;
  readonly recentTotal: number;
  readonly compiledOn: string;
};

export type RecencyDigestCorrection = {
  readonly chatId: string;
  readonly title: string;
  readonly field: 'pinned' | 'workspace';
  readonly value: string;
};

export type RecencyDigestChange = {
  readonly additions: ReadonlyArray<ChatRow>;
  readonly corrections: ReadonlyArray<RecencyDigestCorrection>;
  readonly announced: ReadonlyArray<DigestAnnouncedEntry>;
};

export type RecencyDigestResolver = Pick<
  RecencyDigestService,
  'resolveCandidate' | 'deriveChanges' | 'renderBaseline'
>;

function digestRow(
  chat: Chat,
  opening: Message | undefined,
  latest: Message | undefined,
  messageCount: number,
): ChatRow {
  const openingExcerpt = formatChatExcerpt(
    visibleMessageText(opening?.parts ?? []),
    100,
  );

  const latestExcerpt = formatChatExcerpt(
    visibleMessageText(latest?.parts ?? []),
    100,
  );

  return {
    chatId: chat.id,
    locator: `chat://${chat.id}`,
    title: chat.title,
    activityAt: chat.updatedAt.toISOString(),
    messageCount,
    workspace: canonicalWorkspaceLocator(
      chat.workspaceRoot,
      chat.workspaceExecutorId,
    ),
    ...(openingExcerpt !== undefined && { openingExcerpt }),
    ...(latestExcerpt !== undefined && { latestExcerpt }),
  };
}

async function hydrateDigestRows(
  tx: Db,
  ownerUserId: string,
  candidates: ReadonlyArray<Chat>,
): Promise<Array<ChatRow>> {
  const ids = candidates.map(({ id }) => id);

  const [openings, latestAssistant, counts] = await Promise.all([
    findEarliestUserMessagePerChat(tx, ids, ownerUserId),
    findLatestAssistantPerOwnedChat(tx, ids, ownerUserId),
    countEligiblePerOwnedChat(tx, ids, ownerUserId),
  ]);

  const openingById = new Map(
    openings.map((message) => [message.chatId, message]),
  );

  const latestById = new Map(
    latestAssistant.map((message) => [message.chatId, message]),
  );

  return candidates.map((chat) =>
    digestRow(
      chat,
      openingById.get(chat.id),
      latestById.get(chat.id),
      counts.get(chat.id) ?? 0,
    ),
  );
}

function changedFields(
  previous: DigestAnnouncedEntry,
  workspace: ChatRow['workspace'],
  pinned: boolean,
): Array<RecencyDigestCorrection> {
  const changes: Array<RecencyDigestCorrection> = [];
  const chatId = previous.chatId;
  const title = previous.title ?? chatId;

  if (previous.pinned !== pinned)
    changes.push({
      chatId,
      title,
      field: 'pinned',
      value: pinned ? 'pinned' : 'not pinned',
    });

  if (previous.workspace !== undefined && previous.workspace !== workspace)
    changes.push({
      chatId,
      title,
      field: 'workspace',
      value: `${previous.workspace} -> ${workspace}`,
    });

  return changes;
}

function batchCorrections(
  known: ReadonlyMap<string, DigestAnnouncedEntry>,
  owned: ReadonlyMap<string, Chat>,
  pinned: ReadonlySet<string>,
  ids: ReadonlyArray<string>,
) {
  const updated = new Map(known);
  const corrections: Array<RecencyDigestCorrection> = [];

  for (const chatId of ids) {
    if (corrections.length === 20) break;
    const previous = known.get(chatId);
    const source = owned.get(chatId);

    if (previous === undefined || source === undefined)
      throw new Error('Missing announced source Chat');
    const isPinned = pinned.has(chatId);

    const workspace = canonicalWorkspaceLocator(
      source.workspaceRoot,
      source.workspaceExecutorId,
    );

    const included = changedFields(previous, workspace, isPinned).slice(
      0,
      20 - corrections.length,
    );

    if (included.length === 0) continue;
    corrections.push(...included);
    updated.set(chatId, {
      ...previous,
      ...(included.some(({ field }) => field === 'pinned') && {
        pinned: isPinned,
      }),
      ...(included.some(({ field }) => field === 'workspace') && {
        workspace,
      }),
    });
  }

  return { corrections, updated };
}

@Injectable()
export class RecencyDigestService {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
  ) {}

  async resolveCandidate(
    ownerUserId: string,
    currentChatId: string,
  ): Promise<RecencyDigestResolution> {
    return this.tenantDb.runAs(
      ownerUserId,
      (tx) =>
        this.resolveCandidateInTransaction(tx, ownerUserId, currentChatId),
      { isolationLevel: 'repeatable read' },
    );
  }

  private async resolveCandidateInTransaction(
    tx: Db,
    ownerUserId: string,
    currentChatId: string,
  ): Promise<RecencyDigestResolution> {
    const chats = new ChatsRepository(tx);
    const scope = { excludeId: currentChatId };
    const limit = RECENCY_DIGEST_LIST_LIMIT;

    const [pinnedChats, recentChats, pinnedTotal, recentTotal] =
      await Promise.all([
        chats.findByOwner(ownerUserId, { ...scope, pinned: 'only', limit }),
        chats.findByOwner(ownerUserId, { ...scope, pinned: 'exclude', limit }),
        chats.countByOwner(ownerUserId, { ...scope, pinned: 'only' }),
        chats.countByOwner(ownerUserId, { ...scope, pinned: 'exclude' }),
      ]);

    const rows = await hydrateDigestRows(tx, ownerUserId, [
      ...pinnedChats,
      ...recentChats,
    ]);

    const pinnedIds = new Set(pinnedChats.map(({ id }) => id));

    return {
      rows,
      announced: rows.map((row) =>
        announcedEntry(row, pinnedIds.has(row.chatId)),
      ),
      pinnedShown: pinnedChats.length,
      pinnedTotal,
      recentShown: recentChats.length,
      recentTotal,
      compiledOn: new Date().toISOString().slice(0, 10),
    };
  }

  renderBaseline(candidate: RecencyDigestResolution): string {
    return renderRecencyDigestBaseline(candidate.rows, candidate);
  }

  async deriveChanges(input: {
    tx: Db;
    ownerUserId: string;
    currentChatId: string;
    candidate: RecencyDigestResolution;
    announced: ReadonlyArray<DigestAnnouncedEntry>;
  }): Promise<RecencyDigestChange> {
    const known = new Map(
      input.announced.map((entry) => [entry.chatId, entry]),
    );

    const additions = input.candidate.rows.filter(
      (row) => !known.has(row.chatId),
    );

    const chats = new ChatsRepository(input.tx);

    const ownerChats = await chats.findByOwner(input.ownerUserId, {
      excludeId: input.currentChatId,
      ids: [...known.keys()],
    });

    const owned = new Map(ownerChats.map((chat) => [chat.id, chat]));
    const ids = [...known.keys()].filter((id) => owned.has(id)).sort();

    const pinned = await chats.findPinnedChatIds(input.ownerUserId, ids);

    const batch = batchCorrections(known, owned, pinned, ids);
    const updated = batch.updated;

    for (const entry of input.candidate.announced) {
      if (!known.has(entry.chatId)) updated.set(entry.chatId, entry);
    }

    return {
      additions,
      corrections: batch.corrections,
      announced: [...updated.values()],
    };
  }
}
