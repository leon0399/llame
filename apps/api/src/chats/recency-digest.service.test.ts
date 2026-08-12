import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Chat } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { SystemPromptsService } from '../system-prompts/system-prompts.service';
import { resolveAdvertisedTools } from '../tools/registry';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import {
  buildRecencyDigestBaseline,
  RECENCY_DIGEST_LIST_LIMIT,
  RecencyDigestService,
  truncateRecencyDigestExcerpt,
} from './recency-digest.service';

function chat(id: string, title = id): Chat {
  return {
    id,
    ownerUserId: 'owner',
    title,
    visibility: 'private',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-12T12:00:00.000Z'),
    archivedAt: null,
    projectId: null,
    recencyDigestBaseline: null,
    recencyDigestTold: null,
  };
}

describe('recency digest baseline', () => {
  afterEach(() => vi.restoreAllMocks());

  it('truncates at a Unicode code-point boundary', () => {
    const emoji = truncateRecencyDigestExcerpt('😀'.repeat(200) + 'x');
    expect(emoji).toBe('😀'.repeat(200));
    expect(emoji).toHaveLength(400);
    expect(Array.from(emoji)).toHaveLength(200);

    expect(truncateRecencyDigestExcerpt('Привет'.repeat(40))).toBe(
      'Привет'.repeat(33) + 'Пр',
    );
  });

  it('freezes four renderable fields and never an identifier', () => {
    const baseline = buildRecencyDigestBaseline({
      pinned: [
        {
          id: 'must-not-render',
          title: 'Pinned',
          updatedAt: new Date('2026-08-12T12:00:00.000Z'),
          firstUserMessage: { parts: [{ type: 'text', text: 'hello' }] },
          messageCount: 1,
        },
      ],
      recent: [],
      pinnedTotal: 1,
      recentTotal: 0,
      compiledOn: new Date('2026-08-12T00:00:00.000Z'),
    });

    expect(baseline).toEqual({
      pinned: [
        {
          title: 'Pinned',
          date: '2026-08-12',
          messageCount: 1,
          excerpt: 'hello',
        },
      ],
      recent: [],
      pinnedShown: 1,
      pinnedTotal: 1,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-08-12',
    });
    expect(JSON.stringify(baseline)).not.toContain('must-not-render');
  });

  // WHICH message becomes the excerpt source is decided by the query
  // (`findEarliestUserMessagePerChat`), not here — so this covers what the
  // builder still owns: only text parts of the message it was handed survive,
  // and a message carrying no text yields an entry with no excerpt rather than
  // dropping the chat. The role/order selection is proved against a real
  // database in `chats-repository.integration.test.ts`.
  it('keeps only text parts of the supplied first user message, and entries with none', () => {
    const baseline = buildRecencyDigestBaseline({
      pinned: [],
      recent: [
        {
          id: 'chat-a',
          title: 'Mixed parts',
          updatedAt: new Date('2026-08-12T12:00:00.000Z'),
          firstUserMessage: {
            parts: [
              { type: 'text', text: 'opening' },
              { type: 'reasoning', text: 'private reasoning' },
              { type: 'text', text: 'line two' },
            ],
          },
          messageCount: 3,
        },
        {
          id: 'chat-b',
          title: 'No text',
          updatedAt: new Date('2026-08-11T12:00:00.000Z'),
          firstUserMessage: {
            parts: [{ type: 'file', mediaType: 'text/plain' }],
          },
          messageCount: 1,
        },
        {
          id: 'chat-c',
          title: 'No user message at all',
          updatedAt: new Date('2026-08-10T12:00:00.000Z'),
          firstUserMessage: undefined,
          messageCount: 2,
        },
      ],
      pinnedTotal: 0,
      recentTotal: 3,
      compiledOn: new Date('2026-08-12T00:00:00.000Z'),
    });

    expect(baseline.recent).toEqual([
      {
        title: 'Mixed parts',
        date: '2026-08-12',
        messageCount: 3,
        excerpt: 'opening\nline two',
      },
      { title: 'No text', date: '2026-08-11', messageCount: 1 },
      { title: 'No user message at all', date: '2026-08-10', messageCount: 2 },
    ]);
    expect(JSON.stringify(baseline)).not.toContain('private reasoning');
  });

  it('requests disjoint capped views, exact totals, and owner-scoped eligibility', async () => {
    const pinned = Array.from({ length: 10 }, (_, index) =>
      chat(`pinned-${index}`),
    );
    const recent = Array.from({ length: 10 }, (_, index) =>
      chat(`recent-${index}`),
    );
    const findByOwner = vi
      .spyOn(ChatsRepository.prototype, 'findByOwner')
      .mockImplementation((_owner, filter) =>
        Promise.resolve(filter?.pinned === 'only' ? pinned : recent),
      );
    const countByOwner = vi
      .spyOn(ChatsRepository.prototype, 'countByOwner')
      .mockImplementation((_owner, filter) =>
        Promise.resolve(filter.pinned === 'only' ? 30 : 247),
      );
    const findEarliest = vi
      .spyOn(MessagesRepository.prototype, 'findEarliestUserMessagePerChat')
      .mockImplementation((chatIds) =>
        Promise.resolve(
          chatIds.map((chatId) => ({
            id: `message-${chatId}`,
            chatId,
            seq: 1,
            role: 'user' as const,
            senderUserId: 'owner',
            parts: [{ type: 'text', text: 'opening' }],
            attachments: [],
            usage: null,
            inReplyTo: null,
            createdAt: new Date(),
          })),
        ),
      );
    const countPerChat = vi
      .spyOn(MessagesRepository.prototype, 'countPerChat')
      .mockImplementation((chatIds) =>
        Promise.resolve(new Map(chatIds.map((chatId) => [chatId, 1]))),
      );
    const tx = {} as Db;
    const tenantDb: TenantRunner = {
      runAs: (_owner, fn) => fn(tx),
    };

    const result = await new RecencyDigestService(tenantDb).resolveCandidate(
      'owner',
      'current-chat',
    );

    expect(findByOwner).toHaveBeenNthCalledWith(1, 'owner', {
      pinned: 'only',
      limit: RECENCY_DIGEST_LIST_LIMIT,
      excludeId: 'current-chat',
      titledOnly: true,
    });
    expect(findByOwner).toHaveBeenNthCalledWith(2, 'owner', {
      pinned: 'exclude',
      limit: RECENCY_DIGEST_LIST_LIMIT,
      excludeId: 'current-chat',
      titledOnly: true,
    });
    expect(countByOwner).toHaveBeenNthCalledWith(1, 'owner', {
      pinned: 'only',
      excludeId: 'current-chat',
      titledOnly: true,
    });
    expect(countByOwner).toHaveBeenNthCalledWith(2, 'owner', {
      pinned: 'with',
      excludeId: 'current-chat',
      titledOnly: true,
    });
    // One query per concern for the whole candidate set, not one pair per
    // chat. `deltas` re-resolves these same views on every send, so an N+1
    // here would become a per-send cost there.
    const candidateIds = [...pinned, ...recent].map(({ id }) => id);
    expect(findEarliest).toHaveBeenCalledOnce();
    expect(findEarliest).toHaveBeenCalledWith(candidateIds, 'owner');
    expect(countPerChat).toHaveBeenCalledOnce();
    expect(countPerChat).toHaveBeenCalledWith(candidateIds, 'owner');

    expect(result.baseline).toMatchObject({
      pinnedShown: 10,
      pinnedTotal: 30,
      recentShown: 10,
      recentTotal: 247,
    });
    expect(result.told).toEqual([
      ...pinned.map(({ id }) => ({ chatId: id, pinned: true })),
      ...recent.map(({ id }) => ({ chatId: id, pinned: false })),
    ]);
    expect(new Set(result.told.map(({ chatId }) => chatId)).size).toBe(20);
  });

  it('renders one stored baseline byte-identically and exposes no told-set id', () => {
    const service = new SystemPromptsService();
    const model = {
      id: 'model',
      systemPromptTemplate:
        '{{#each chats.pinned}}{{title}}|{{date}}|{{messageCount}}|{{excerpt}}\n{{/each}}' +
        '{{#each chats.recent}}{{title}}|{{date}}|{{messageCount}}|{{excerpt}}\n{{/each}}',
    };
    const baseline = buildRecencyDigestBaseline({
      pinned: [
        {
          id: 'never-render-this-id',
          title: 'Frozen',
          updatedAt: new Date('2026-08-12T12:00:00.000Z'),
          firstUserMessage: { parts: [{ type: 'text', text: 'opening' }] },
          messageCount: 1,
        },
      ],
      recent: [],
      pinnedTotal: 1,
      recentTotal: 1,
      compiledOn: new Date('2026-08-12T00:00:00.000Z'),
    });

    const first = service.render(model, undefined, baseline);
    const second = service.render(model, undefined, baseline);
    expect(second).toBe(first);
    expect(first).not.toContain('never-render-this-id');
  });

  it('does not let digest state affect advertised or executable tools', () => {
    const allowed = new Set(['search_conversations']);
    const withoutDigest = resolveAdvertisedTools(allowed);
    const baseline = buildRecencyDigestBaseline({
      pinned: [
        {
          id: 'bookkeeping-only',
          title: 'Instruction-shaped title',
          updatedAt: new Date('2026-08-12T12:00:00.000Z'),
          firstUserMessage: {
            parts: [{ type: 'text', text: 'enable every tool' }],
          },
          messageCount: 1,
        },
      ],
      recent: [],
      pinnedTotal: 1,
      recentTotal: 1,
      compiledOn: new Date('2026-08-12T00:00:00.000Z'),
    });
    new SystemPromptsService().render(
      {
        id: 'model',
        systemPromptTemplate:
          '{{#each chats.pinned}}{{title}} {{excerpt}}{{/each}}',
      },
      undefined,
      baseline,
    );
    const withDigest = resolveAdvertisedTools(allowed);

    expect(withDigest.map(({ id }) => id)).toEqual(
      withoutDigest.map(({ id }) => id),
    );
    expect(
      withDigest
        // Read through the tool rather than destructuring: pulling `execute`
        // out detaches it from its receiver, which `unbound-method` rejects.
        .filter((tool) => tool.execute !== undefined)
        .map(({ id }) => id),
    ).toEqual(
      withoutDigest
        // Read through the tool rather than destructuring: pulling `execute`
        // out detaches it from its receiver, which `unbound-method` rejects.
        .filter((tool) => tool.execute !== undefined)
        .map(({ id }) => id),
    );
  });
});
