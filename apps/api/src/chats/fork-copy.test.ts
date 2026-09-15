/**
 * The owner fork's pure projection (complete-owner-forks D2-D3): which storage
 * identities the copy allocates, which Chat-row state travels with it, and what
 * the copied message rows look like.
 *
 * `ChatsService` owns the transaction and the writes, so the cases here drive
 * the decision directly; what the writes then produce is pinned in
 * `fork-chat.integration.test.ts`.
 */

import { type Chat, type Compaction } from '../db/schema';
import {
  copiedMessageRows,
  inheritForkedChatState,
  type CopyableMessage,
} from './fork-copy';

const NOW = new Date('2026-09-14T00:00:00.000Z');
const CHAT_ID = 'chat-id';
const FORK_CHAT_ID = 'fork-chat-id';
const USER_ID = 'user-id';

const chat = (overrides: Partial<Chat> = {}): Chat => ({
  id: CHAT_ID,
  ownerUserId: USER_ID,
  title: 'Fork me',
  visibility: 'private',
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  projectId: null,
  recencyDigestBaseline: null,
  recencyDigestTold: null,
  recencyDigestRebakedFrom: null,
  skillCatalogBaseline: null,
  skillCatalogRebakedFrom: null,
  skillCatalogTold: null,
  ...overrides,
});

const compaction = (
  id: string,
  uptoSeq: number,
  overrides: Partial<Compaction> = {},
): Compaction => ({
  id,
  chatId: CHAT_ID,
  uptoSeq,
  parentId: null,
  summary: `${id} summary`,
  replacementHistory: [
    { role: 'user', parts: [{ type: 'text', text: `${id} replay` }] },
  ],
  usage: null,
  createdAt: NOW,
  ...overrides,
});

/** The shared fork's shape: no time and no price of its own. */
const copyable = (
  id: string,
  overrides: Partial<CopyableMessage> = {},
): CopyableMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: id }],
  senderUserId: USER_ID,
  attachments: [],
  inReplyTo: null,
  ...overrides,
});

describe('inheritForkedChatState', () => {
  // Ascending `uptoSeq`, the order the repository returns the prefix in. Three
  // rows, because the last and the second-to-last must differ for the active
  // checkpoint to be observable.
  const oldest = compaction('compaction-1', 4);
  const middle = compaction('compaction-2', 8);
  const newest = compaction('compaction-3', 12);
  const prefix = [oldest, middle, newest];

  it("re-bakes both baselines at the copied LAST compaction as the fork's active checkpoint", () => {
    const source = chat({
      // Outside the copied prefix, so each marker takes the fallback path.
      recencyDigestRebakedFrom: 'compaction-outside-prefix',
      skillCatalogRebakedFrom: 'compaction-outside-prefix',
    });

    const { compactionIds, inherited } = inheritForkedChatState(source, prefix);

    expect(inherited.recencyDigestRebakedFrom).toBe(
      compactionIds.get(newest.id),
    );
    expect(inherited.skillCatalogRebakedFrom).toBe(
      compactionIds.get(newest.id),
    );
    // The second-to-last copy is a different checkpoint: pointing the markers
    // there would leave the fork's newest checkpoint unaccounted for.
    expect(inherited.recencyDigestRebakedFrom).not.toBe(
      compactionIds.get(middle.id),
    );
  });

  it("remaps a marker naming a copied compaction onto that copy's new id", () => {
    const source = chat({
      recencyDigestRebakedFrom: middle.id,
      skillCatalogRebakedFrom: middle.id,
    });

    const { compactionIds, inherited } = inheritForkedChatState(source, prefix);

    expect(inherited.recencyDigestRebakedFrom).toBe(
      compactionIds.get(middle.id),
    );
    expect(inherited.skillCatalogRebakedFrom).toBe(
      compactionIds.get(middle.id),
    );
    // Neither the source's own id nor the active checkpoint.
    expect(inherited.recencyDigestRebakedFrom).not.toBe(middle.id);
    expect(inherited.recencyDigestRebakedFrom).not.toBe(
      compactionIds.get(newest.id),
    );
  });

  it('keeps a null marker null even though the prefix was copied', () => {
    const { inherited } = inheritForkedChatState(chat(), prefix);

    // The source re-resolves that baseline, so the fork has to re-resolve it
    // the same way rather than pinning one the source would replace.
    expect(inherited.recencyDigestRebakedFrom).toBeNull();
    expect(inherited.skillCatalogRebakedFrom).toBeNull();
  });

  it('nulls a marker naming an uncopied compaction when the prefix copied none', () => {
    const source = chat({
      recencyDigestRebakedFrom: 'compaction-outside-prefix',
      skillCatalogRebakedFrom: 'compaction-outside-prefix',
    });

    const { compactionIds, inherited } = inheritForkedChatState(source, []);

    expect(compactionIds.size).toBe(0);
    expect(inherited.recencyDigestRebakedFrom).toBeNull();
    expect(inherited.skillCatalogRebakedFrom).toBeNull();
  });

  it('carries the frozen baselines, told-sets, and creation time verbatim', () => {
    const sourceAt = new Date('2026-08-01T12:30:00.000Z');
    const source = chat({
      createdAt: sourceAt,
      recencyDigestBaseline: {
        pinned: [],
        recent: [{ title: 'Trip', date: '2026-07-30', messageCount: 4 }],
        pinnedShown: 0,
        pinnedTotal: 0,
        recentShown: 1,
        recentTotal: 1,
        compiledOn: '2026-08-01',
      },
      recencyDigestTold: [
        { chatId: 'other-chat', pinned: false, title: 'Trip' },
      ],
      skillCatalogBaseline: {
        entries: [{ name: 'alpha', description: 'Alpha skill' }],
        omitted: 2,
      },
      skillCatalogTold: ['alpha'],
    });

    const { inherited } = inheritForkedChatState(source, prefix);

    expect(inherited.createdAt).toBe(sourceAt);
    expect(inherited.recencyDigestBaseline).toEqual(
      source.recencyDigestBaseline,
    );
    expect(inherited.recencyDigestTold).toEqual(source.recencyDigestTold);
    expect(inherited.skillCatalogBaseline).toEqual(source.skillCatalogBaseline);
    expect(inherited.skillCatalogTold).toEqual(source.skillCatalogTold);
  });

  it('allocates every copied compaction a distinct new id that is not its source id', () => {
    const { compactionIds } = inheritForkedChatState(chat(), prefix);

    expect([...compactionIds.keys()]).toEqual([
      oldest.id,
      middle.id,
      newest.id,
    ]);
    const newIds = [...compactionIds.values()];
    expect(new Set(newIds).size).toBe(prefix.length);
    for (const sourceId of [oldest.id, middle.id, newest.id]) {
      expect(newIds).not.toContain(sourceId);
    }
  });
});

describe('copiedMessageRows', () => {
  it('writes dense sequences from 1 in source order under fresh, distinct ids', () => {
    const rows = copiedMessageRows(
      [
        copyable('message-1'),
        copyable('message-2', { role: 'assistant', senderUserId: null }),
        copyable('message-3'),
      ],
      FORK_CHAT_ID,
    );

    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.chatId)).toEqual([
      FORK_CHAT_ID,
      FORK_CHAT_ID,
      FORK_CHAT_ID,
    ]);
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(rows.length);
    for (const sourceId of ['message-1', 'message-2', 'message-3']) {
      expect(ids).not.toContain(sourceId);
    }
  });

  it('points inReplyTo at the copied predecessor and nulls a row that replied to nothing', () => {
    const rows = copiedMessageRows(
      [
        copyable('message-1'),
        copyable('message-2', {
          role: 'assistant',
          senderUserId: null,
          inReplyTo: 'message-1',
        }),
      ],
      FORK_CHAT_ID,
    );

    expect(rows[1].inReplyTo).toBe(rows[0].id);
    expect(rows[0].inReplyTo).toBeNull();
  });

  it("copies the owner fork's content, time, and price verbatim, keeping a user row's null usage null", () => {
    const userAt = new Date('2026-09-13T10:00:00.000Z');
    const assistantAt = new Date('2026-09-13T10:00:05.000Z');
    const userParts = [{ type: 'text', text: 'question' }];
    const assistantParts = [{ type: 'text', text: 'answer' }];
    const attachments = [{ type: 'file', name: 'notes.txt' }];
    const usage = { status: 'completed', totalTokens: 42 };

    const rows = copiedMessageRows(
      [
        copyable('message-1', {
          parts: userParts,
          attachments,
          createdAt: userAt,
          usage: null,
        }),
        copyable('message-2', {
          role: 'assistant',
          senderUserId: null,
          inReplyTo: 'message-1',
          parts: assistantParts,
          createdAt: assistantAt,
          usage,
        }),
      ],
      FORK_CHAT_ID,
    );

    expect(rows[0]).toMatchObject({
      role: 'user',
      senderUserId: USER_ID,
      parts: userParts,
      attachments,
      createdAt: userAt,
    });
    // Null rather than absent: the copied user turn keeps its own (empty) price.
    expect(rows[0].usage).toBeNull();
    expect(rows[1]).toMatchObject({
      role: 'assistant',
      senderUserId: null,
      parts: assistantParts,
      attachments: [],
      createdAt: assistantAt,
      usage,
    });
  });

  it("leaves createdAt and usage to the column defaults for the shared fork's rows", () => {
    const rows = copiedMessageRows(
      [
        copyable('message-1'),
        copyable('message-2', { role: 'assistant', senderUserId: null }),
      ],
      FORK_CHAT_ID,
    );

    for (const row of rows) {
      expect(row.createdAt).toBeUndefined();
      expect(row.usage).toBeUndefined();
    }
  });
});
