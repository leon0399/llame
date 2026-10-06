/**
 * Pure owner-fork projection tests. The live database integration suite pins
 * the transaction and RLS behavior; these cases pin boundary selection,
 * identity remapping, and inherited Chat state without a database.
 */

import { type Chat } from '../db/schema';
import {
  copiedMessageRows,
  inheritForkedChatState,
  selectForkMessages,
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
  workspaceRoot: null,
  workspaceExecutorId: null,
  workspaceGeneration: 0,
  workspaceTold: null,
  workspaceToldFrom: null,
  workspaceDetachReason: null,
  ...overrides,
});

const row = (
  id: string,
  seq: number,
  overrides: Partial<CopyableMessage> = {},
): CopyableMessage & { seq: number } => ({
  id,
  seq,
  role: 'user',
  parts: [{ type: 'text', text: id }],
  senderUserId: USER_ID,
  attachments: [],
  inReplyTo: null,
  absorbedThroughSeq: null,
  ...overrides,
});

const checkpoint = (
  id: string,
  seq: number,
  absorbedThroughSeq: number,
): CopyableMessage & { seq: number } =>
  row(id, seq, {
    role: 'checkpoint',
    senderUserId: null,
    parts: [{ type: 'data-context', data: { text: `${id} text` } }],
    absorbedThroughSeq,
  });

describe('selectForkMessages', () => {
  it('selects ordinary rows by anchor but checkpoints by absorbed boundary', () => {
    const rows = [
      row('user-1', 1),
      row('assistant-1', 2, { role: 'assistant', senderUserId: null }),
      row('user-2', 3),
      checkpoint('checkpoint-1', 4, 2),
      checkpoint('checkpoint-2', 5, 4),
      row('tool-1', 6, { role: 'tool', senderUserId: null }),
    ];

    expect(selectForkMessages(rows, 3).map(({ id }) => id)).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'checkpoint-1',
    ]);
  });

  it('selects every valid row for a whole-chat fork and keeps source order', () => {
    const rows = [row('user-1', 7), checkpoint('checkpoint-1', 8, 7)];

    expect(selectForkMessages(rows, undefined)).toEqual(rows);
  });
});

describe('inheritForkedChatState', () => {
  const first = checkpoint('checkpoint-1', 3, 2);
  const latest = checkpoint('checkpoint-2', 6, 5);
  const prefix = [first, latest];

  it('remaps markers naming copied checkpoints to their copied message ids', () => {
    const source = chat({
      recencyDigestRebakedFrom: first.id,
      skillCatalogRebakedFrom: latest.id,
    });

    const { messageIds, inherited } = inheritForkedChatState(source, prefix);

    expect(inherited.recencyDigestRebakedFrom).toBe(messageIds.get(first.id));
    expect(inherited.skillCatalogRebakedFrom).toBe(messageIds.get(latest.id));
    expect(inherited.recencyDigestRebakedFrom).not.toBe(first.id);
    expect(inherited.skillCatalogRebakedFrom).not.toBe(latest.id);
  });

  it('maps an uncopied marker to the copied active checkpoint or null', () => {
    const source = chat({
      recencyDigestRebakedFrom: latest.id,
      skillCatalogRebakedFrom: latest.id,
    });
    const onlyFirst = inheritForkedChatState(source, [first]);
    const firstCopyId = onlyFirst.messageIds.get(first.id);

    expect(onlyFirst.inherited.recencyDigestRebakedFrom).toBe(firstCopyId);
    expect(onlyFirst.inherited.skillCatalogRebakedFrom).toBe(firstCopyId);

    const noCheckpoints = inheritForkedChatState(source, []);
    expect(noCheckpoints.inherited.recencyDigestRebakedFrom).toBeNull();
    expect(noCheckpoints.inherited.skillCatalogRebakedFrom).toBeNull();
  });

  it('keeps null markers null and carries frozen state and the active binding', () => {
    const source = chat({
      recencyDigestBaseline: {
        pinned: [],
        recent: [],
        pinnedShown: 0,
        pinnedTotal: 0,
        recentShown: 0,
        recentTotal: 0,
        compiledOn: '2026-09-14',
      },
      recencyDigestTold: [{ chatId: 'other', pinned: false, title: 'Old' }],
      skillCatalogBaseline: {
        entries: [{ name: 'alpha', description: 'A' }],
        omitted: 0,
      },
      skillCatalogTold: ['alpha'],
      workspaceRoot: '/work/project',
      workspaceExecutorId: 'worker-a',
      workspaceGeneration: 7,
    });

    const { inherited } = inheritForkedChatState(source, prefix);

    expect(inherited).toMatchObject({
      createdAt: source.createdAt,
      recencyDigestBaseline: source.recencyDigestBaseline,
      recencyDigestTold: source.recencyDigestTold,
      skillCatalogBaseline: source.skillCatalogBaseline,
      skillCatalogTold: source.skillCatalogTold,
      workspaceRoot: '/work/project',
      workspaceExecutorId: 'worker-a',
      workspaceGeneration: 7,
      recencyDigestRebakedFrom: null,
      skillCatalogRebakedFrom: null,
    });
    expect(inherited).not.toHaveProperty('workspaceTold');
    expect(inherited).not.toHaveProperty('workspaceToldFrom');
    expect(inherited).not.toHaveProperty('workspaceDetachReason');
  });
});

describe('copiedMessageRows', () => {
  it('writes dense sequences and remaps a checkpoint boundary to the copied row', () => {
    const first = row('message-1', 10);
    const second = row('message-2', 20, {
      role: 'assistant',
      senderUserId: null,
      inReplyTo: first.id,
    });
    const checkpointRow = checkpoint('checkpoint-1', 30, second.seq);
    const rows = [first, second, checkpointRow];

    const { messageIds } = inheritForkedChatState(chat(), rows);
    const copied = copiedMessageRows(rows, FORK_CHAT_ID, messageIds);

    expect(copied.map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(copied.map((item) => item.chatId)).toEqual([
      FORK_CHAT_ID,
      FORK_CHAT_ID,
      FORK_CHAT_ID,
    ]);
    expect(copied.map((item) => item.id)).not.toEqual(
      rows.map((item) => item.id),
    );
    expect(copied[1].inReplyTo).toBe(copied[0].id);
    expect(copied[2].absorbedThroughSeq).toBe(2);
    expect(copied[2].parts).toEqual(checkpointRow.parts);
  });

  it('copies owner content, createdAt, usage, and attachments verbatim', () => {
    const createdAt = new Date('2026-09-13T10:00:00.000Z');
    const usage = { status: 'completed', totalTokens: 42 };
    const rows = [
      row('message-1', 1, {
        parts: [{ type: 'text', text: 'question' }],
        attachments: [{ type: 'file', name: 'notes.txt' }],
        createdAt,
        usage: null,
      }),
      row('message-2', 2, {
        role: 'assistant',
        senderUserId: null,
        inReplyTo: 'message-1',
        createdAt,
        usage,
      }),
    ];

    const copied = copiedMessageRows(rows, FORK_CHAT_ID);

    expect(copied[0]).toMatchObject({
      role: 'user',
      parts: rows[0].parts,
      attachments: rows[0].attachments,
      createdAt,
      usage: null,
      absorbedThroughSeq: null,
    });
    expect(copied[1]).toMatchObject({
      role: 'assistant',
      parts: rows[1].parts,
      createdAt,
      usage,
      absorbedThroughSeq: null,
    });
  });

  it('fails closed when a copied checkpoint does not name a copied row', () => {
    const rows = [checkpoint('checkpoint-1', 10, 7)];

    expect(() => copiedMessageRows(rows, FORK_CHAT_ID)).toThrow(
      'names a row outside the copied prefix',
    );
  });
});
