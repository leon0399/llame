import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';

import { type Chat } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { ChatsRepository } from './chats-repository';
import * as digestMessageProjections from './recency-digest-message-projections';
import { RecencyDigestService } from './recency-digest.service';

const ids = Array.from(
  { length: 30 },
  (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);

function chat(id: string, fields: Partial<Chat> = {}): Chat {
  return {
    id,
    ownerUserId: 'owner',
    title: id,
    visibility: 'private',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-12T12:00:00.000Z'),
    archivedAt: null,
    modelSelection: null,
    projectId: null,
    workspaceRoot: null,
    workspaceExecutorId: null,
    workspaceGeneration: 0,
    skillCatalogBaseline: null,
    skillCatalogRebakedFrom: null,
    skillCatalogTold: null,
    workspaceTold: null,
    workspaceToldAvailable: null,
    workspaceToldFrom: null,
    artifactSeq: 0,
    workspaceDetachReason: null,
    ...fields,
  };
}

function serviceDb() {
  const tx: Db = drizzle.mock();
  const tenantDb: TenantRunner = { runAs: (_owner, fn) => fn(tx) };

  return { service: new RecencyDigestService(tenantDb), tx };
}

describe('recency digest candidate resolution', () => {
  it('uses disjoint pinned and recent ten-row views and carries absolute totals', async () => {
    const pinned = ids.slice(0, 10).map((id) => chat(id));
    const recent = ids.slice(10, 20).map((id) => chat(id));

    vi.spyOn(ChatsRepository.prototype, 'findByOwner').mockImplementation(
      (_owner, filter) =>
        Promise.resolve(filter?.pinned === 'only' ? pinned : recent),
    );

    vi.spyOn(ChatsRepository.prototype, 'countByOwner').mockImplementation(
      (_owner, filter) => Promise.resolve(filter.pinned === 'only' ? 27 : 61),
    );

    vi.spyOn(
      digestMessageProjections,
      'findEarliestUserMessagePerChat',
    ).mockResolvedValue([]);
    vi.spyOn(
      digestMessageProjections,
      'findLatestAssistantPerOwnedChat',
    ).mockResolvedValue([]);
    vi.spyOn(
      digestMessageProjections,
      'countEligiblePerOwnedChat',
    ).mockResolvedValue(new Map());
    const { service } = serviceDb();

    const result = await service.resolveCandidate('owner', ids[29]);

    expect(
      result.announced.map(({ chatId, pinned: isPinned }) => [
        chatId,
        isPinned,
      ]),
    ).toEqual([
      ...pinned.map(({ id }) => [id, true]),
      ...recent.map(({ id }) => [id, false]),
    ]);
    expect(new Set(result.announced.map(({ chatId }) => chatId)).size).toBe(20);
    expect(
      result.rows.every(
        (row) => !('openingExcerpt' in row) && !('latestExcerpt' in row),
      ),
    ).toBe(true);
    expect(result).toMatchObject({
      pinnedShown: 10,
      pinnedTotal: 27,
      recentShown: 10,
      recentTotal: 61,
    });
    expect(result.compiledOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const rendered = service.renderBaseline(result);
    expect(rendered).toContain('Pinned Chats (10 of 27 eligible)');
    expect(rendered).toContain('Recent Chats (10 of 61 eligible)');
  });

  it('represents an empty eligible corpus as an empty snapshot', async () => {
    vi.spyOn(ChatsRepository.prototype, 'findByOwner').mockResolvedValue([]);
    vi.spyOn(ChatsRepository.prototype, 'countByOwner').mockResolvedValue(0);
    vi.spyOn(
      digestMessageProjections,
      'findEarliestUserMessagePerChat',
    ).mockResolvedValue([]);
    vi.spyOn(
      digestMessageProjections,
      'findLatestAssistantPerOwnedChat',
    ).mockResolvedValue([]);
    vi.spyOn(
      digestMessageProjections,
      'countEligiblePerOwnedChat',
    ).mockResolvedValue(new Map());
    const { service } = serviceDb();

    const result = await service.resolveCandidate('owner', ids[0]);

    expect(result.announced).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result).toMatchObject({
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 0,
      recentTotal: 0,
    });
  });

  it('renders latest and opening visible excerpts as bounded Unicode code points without status', async () => {
    const source = chat(ids[0], {
      title: 'Shared',
      workspaceRoot: '/workspace',
      workspaceExecutorId: null,
    });

    vi.spyOn(ChatsRepository.prototype, 'findByOwner').mockResolvedValue([
      source,
    ]);
    vi.spyOn(ChatsRepository.prototype, 'countByOwner').mockResolvedValue(1);
    vi.spyOn(
      digestMessageProjections,
      'findEarliestUserMessagePerChat',
    ).mockResolvedValue([
      {
        id: ids[1],
        chatId: ids[0],
        seq: 1,
        role: 'user',
        senderUserId: 'owner',
        parts: [{ type: 'text', text: '😀'.repeat(120) }],
        attachments: [],
        absorbedThroughSeq: null,
        usage: null,
        inReplyTo: null,
        createdAt: new Date(),
        revisedAt: null,
      },
    ]);
    vi.spyOn(
      digestMessageProjections,
      'findLatestAssistantPerOwnedChat',
    ).mockResolvedValue([
      {
        id: ids[2],
        chatId: ids[0],
        seq: 2,
        role: 'assistant',
        senderUserId: null,
        parts: [{ type: 'text', text: 'latest visible text' }],
        attachments: [],
        absorbedThroughSeq: null,
        usage: null,
        inReplyTo: null,
        createdAt: new Date(),
        revisedAt: null,
      },
    ]);
    vi.spyOn(
      digestMessageProjections,
      'countEligiblePerOwnedChat',
    ).mockResolvedValue(new Map([[ids[0], 2]]));
    const { service } = serviceDb();

    const result = await service.resolveCandidate('owner', ids[29]);
    const body = service.renderBaseline(result);

    expect(Array.from(result.rows[0].openingExcerpt ?? '')).toHaveLength(100);
    expect(Array.from(result.rows[0].latestExcerpt ?? '')).toHaveLength(
      'latest visible text'.length,
    );
    expect(result.rows[0]).toMatchObject({
      locator: `chat://${ids[0]}`,
      workspace: 'unbound',
    });
    expect(body).toContain('😀'.repeat(100));
    expect(body).toContain('latest visible text');
    expect(body).not.toMatch(/\b(?:idle|running|status)\b/iu);
  });
});

describe('recency digest change derivation', () => {
  it('preserves each new row pin classification when earlier pinned rows were already announced', async () => {
    const rows = ids.slice(0, 3).map((chatId) => ({
      chatId,
      locator: `chat://${chatId}`,
      title: chatId,
      activityAt: '2026-08-12T00:00:00.000Z',
      messageCount: 1,
      workspace: 'unbound',
    }));

    const announced = rows.map((row, index) => ({
      chatId: row.chatId,
      title: row.title,
      workspace: row.workspace,
      pinned: index < 2,
    }));

    const { service, tx } = serviceDb();
    vi.spyOn(ChatsRepository.prototype, 'findByOwner').mockResolvedValue([
      chat(ids[0]),
    ]);
    vi.spyOn(ChatsRepository.prototype, 'findPinnedChatIds').mockResolvedValue(
      new Set([ids[0]]),
    );

    const result = await service.deriveChanges({
      tx,
      ownerUserId: 'owner',
      currentChatId: ids[29],
      candidate: {
        rows,
        announced,
        pinnedShown: 2,
        pinnedTotal: 2,
        recentShown: 1,
        recentTotal: 1,
        compiledOn: '2026-08-12',
      },
      announced: [announced[0]],
    });

    expect(result.additions).toEqual([
      { row: rows[1], pinned: true },
      { row: rows[2], pinned: false },
    ]);
    expect(result.announced).toEqual(announced);
  });

  it('does not reannounce known candidates and does not infer pin changes from candidate cap displacement', async () => {
    const row = {
      chatId: ids[0],
      locator: `chat://${ids[0]}`,
      title: 'Known',
      activityAt: '2026-08-12T00:00:00.000Z',
      messageCount: 1,
      workspace: 'unbound',
    };

    const { service, tx } = serviceDb();
    vi.spyOn(ChatsRepository.prototype, 'findByOwner').mockResolvedValue([
      chat(ids[0]),
    ]);
    vi.spyOn(ChatsRepository.prototype, 'findPinnedChatIds').mockResolvedValue(
      new Set([ids[0]]),
    );

    const result = await service.deriveChanges({
      tx,
      ownerUserId: 'owner',
      currentChatId: ids[29],
      candidate: {
        rows: [row],
        announced: [
          {
            chatId: ids[0],
            pinned: true,
            title: 'Known',
            workspace: 'unbound',
          },
        ],
        pinnedShown: 0,
        pinnedTotal: 0,
        recentShown: 1,
        recentTotal: 1,
        compiledOn: '2026-08-12',
      },
      announced: [
        { chatId: ids[0], pinned: true, title: 'Known', workspace: 'unbound' },
      ],
    });

    expect(result.additions).toEqual([]);
    expect(result.corrections).toEqual([]);
  });

  it('keeps pin corrections in stable chat-id order and retains unowned known entries', async () => {
    const known = [ids[1], ids[0], ids[2]].map((chatId) => ({
      chatId,
      pinned: true,
      title: chatId,
      workspace: 'unbound',
    }));

    const { service, tx } = serviceDb();
    vi.spyOn(ChatsRepository.prototype, 'findByOwner').mockResolvedValue(
      known.slice(0, 2).map(({ chatId }) => chat(chatId)),
    );
    vi.spyOn(ChatsRepository.prototype, 'findPinnedChatIds').mockResolvedValue(
      new Set(),
    );

    const result = await service.deriveChanges({
      tx,
      ownerUserId: 'owner',
      currentChatId: ids[29],
      candidate: {
        rows: [],
        announced: [],
        pinnedShown: 0,
        pinnedTotal: 0,
        recentShown: 0,
        recentTotal: 0,
        compiledOn: '2026-08-12',
      },
      announced: known,
    });

    expect(result.corrections.map(({ chatId }) => chatId)).toEqual([
      ids[0],
      ids[1],
    ]);
    expect(result.announced).toEqual([
      { ...known[0], pinned: false },
      { ...known[1], pinned: false },
      known[2],
    ]);
  });

  it('emits corrections deterministically with a 20-field budget and advances only included fields', async () => {
    const known = ids.slice(0, 20).map((chatId, index) => ({
      chatId,
      pinned: true,
      title: `Chat ${index}`,
      workspace: index === 19 ? 'machine://old/repo' : 'unbound',
    }));

    const sources = known.map((entry, index) =>
      chat(
        entry.chatId,
        index === 19
          ? { workspaceRoot: '/repo', workspaceExecutorId: 'build' }
          : {},
      ),
    );

    const { service, tx } = serviceDb();
    vi.spyOn(ChatsRepository.prototype, 'findByOwner').mockResolvedValue(
      sources,
    );
    vi.spyOn(ChatsRepository.prototype, 'findPinnedChatIds').mockResolvedValue(
      new Set(),
    );

    const candidate = {
      rows: [],
      announced: [],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-08-12',
    };

    const first = await service.deriveChanges({
      tx,
      ownerUserId: 'owner',
      currentChatId: ids[29],
      candidate,
      announced: known,
    });

    expect(first.corrections).toHaveLength(20);
    expect(first.corrections.slice(0, 19).map(({ chatId }) => chatId)).toEqual(
      ids.slice(0, 19),
    );
    expect(first.corrections[19]).toMatchObject({
      chatId: ids[19],
      field: 'pinned',
      value: 'not pinned',
    });
    expect(
      first.announced.find(({ chatId }) => chatId === ids[19]),
    ).toMatchObject({
      pinned: false,
      workspace: 'machine://old/repo',
    });

    const next = await service.deriveChanges({
      tx,
      ownerUserId: 'owner',
      currentChatId: ids[29],
      candidate,
      announced: first.announced,
    });

    expect(next.corrections).toContainEqual({
      chatId: ids[19],
      title: 'Chat 19',
      field: 'workspace',
      value: 'machine://old/repo -> machine://build/repo',
    });
  });

  it('does not infer unbound affinity from a pin correction for an imported unknown binding', async () => {
    const chatId = ids[0];
    const { service, tx } = serviceDb();
    vi.spyOn(ChatsRepository.prototype, 'findByOwner').mockResolvedValue([
      chat(chatId),
    ]);
    vi.spyOn(ChatsRepository.prototype, 'findPinnedChatIds').mockResolvedValue(
      new Set(),
    );

    const result = await service.deriveChanges({
      tx,
      ownerUserId: 'owner',
      currentChatId: ids[29],
      candidate: {
        rows: [],
        announced: [],
        pinnedShown: 0,
        pinnedTotal: 0,
        recentShown: 0,
        recentTotal: 0,
        compiledOn: '2026-08-12',
      },
      announced: [{ chatId, pinned: true, title: 'Imported' }],
    });

    expect(result.corrections).toEqual([
      { chatId, title: 'Imported', field: 'pinned', value: 'not pinned' },
    ]);
    expect(result.announced).toEqual([
      { chatId, pinned: false, title: 'Imported' },
    ]);
  });
});
