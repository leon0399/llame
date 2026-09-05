/**
 * ChatsRepository / MessagesRepository unit tests — owner-scoped defense-in-depth.
 *
 * These assert the owner-scoping is actually present in the compiled SQL and bound
 * parameters, not just that a query was issued. Removing the owner filter fails
 * these.
 *
 * Real RLS enforcement (cross-tenant isolation) is proven against a live Postgres in
 * chats-rls.integration.test.ts.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import {
  ChatsRepository,
  CompactionsRepository,
  type Db,
} from './chats-repository';
import { MessagesRepository } from './messages-repository';
import { RunEventsRepository, RunsRepository } from '../runs/runs-repository';
import * as schema from '../db/schema';
import { isRecord, isString } from '@workspace/runtime-safety';

type LoggedQuery = {
  sql: string;
  params: Array<unknown>;
};

// Use Drizzle's native mock database and its public logger boundary. Queries are
// compiled by real Drizzle builders, then logged before the mock client attempts
// execution. This keeps these unit tests focused on SQL shape without forging a
// Db-compatible fluent builder.
function makeMockDb() {
  const queries: Array<LoggedQuery> = [];
  const db: Db = drizzle.mock({
    schema,
    logger: {
      logQuery(sql, params) {
        queries.push({ sql, params });
      },
    },
  });

  return { db, queries };
}

/**
 * Drizzle's terminal builders (`PgRaw`, `PgDelete`) carry private state no
 * structural double can satisfy, so a spy that replaces one has to hand back a
 * plain thenable through the `never` bottom type.
 */
function asDbQuery<T extends object>(query: T): never {
  // SAFETY: every double passed here implements exactly the fluent methods the
  // repository under test calls, and settles as a real Promise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return query as never;
}

function queryContains(
  queries: Array<LoggedQuery>,
  value: string | number,
): boolean {
  return queries.some((query) => query.params.includes(value));
}

function querySqlContains(
  queries: Array<LoggedQuery>,
  fragment: string,
): boolean {
  return queries.some((query) => query.sql.includes(fragment));
}

function lastQuery(queries: Array<LoggedQuery>): LoggedQuery {
  const query = queries.at(-1);
  if (!query) {
    throw new Error('expected a logged database query');
  }
  return query;
}

function updateSetSql(queries: Array<LoggedQuery>): string {
  const sql = lastQuery(queries).sql;
  return sql.slice(sql.indexOf(' set ') + 5, sql.indexOf(' where '));
}

function whereSql(queries: Array<LoggedQuery>): string {
  const sql = lastQuery(queries).sql;
  const start = sql.indexOf(' where ');
  const end = sql.indexOf(' returning ');
  return sql.slice(start, end === -1 ? undefined : end);
}

describe('ChatsRepository — owner-scoped queries (defense-in-depth)', () => {
  const ownerUserId = 'owner-123';
  const chatId = 'chat-abc';

  it('findByOwner filters by ownerUserId', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db).findByOwner(ownerUserId).catch(() => null);
    expect(queries).not.toHaveLength(0);
    expect(queryContains(queries, ownerUserId)).toBe(true);
  });

  it('findByOwner applies the caller cap and filters polymorphic pins to chats', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .findByOwner(ownerUserId, { pinned: 'only', limit: 10 })
      .catch(() => null);

    expect(queryContains(queries, 'chat')).toBe(true);
    expect(querySqlContains(queries, 'limit $')).toBe(true);
    expect(lastQuery(queries).params).toContain(10);
    expect(lastQuery(queries).sql).toContain('inner join "pins"');
    expect(lastQuery(queries).sql).toContain(
      'order by "pins"."position" asc, "pins"."item_id"',
    );
    expect(lastQuery(queries).sql).not.toContain(
      'order by "chats"."updated_at"',
    );
  });

  it('findByOwner keeps non-pinned-only modes on updatedAt descending', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .findByOwner(ownerUserId, { pinned: 'exclude' })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain(
      'order by "chats"."updated_at" desc',
    );
    expect(lastQuery(queries).sql).not.toContain('inner join "pins"');
  });

  it('countByOwner returns an uncapped exact population query', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .countByOwner(ownerUserId, {
        pinned: 'with',
        excludeId: chatId,
        titledOnly: true,
      })
      .catch(() => null);

    expect(querySqlContains(queries, 'limit ')).toBe(false);
  });

  it('findById scopes by chatId AND ownerUserId', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .findById(chatId, ownerUserId)
      .catch(() => null);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
  });

  it('create inserts a row carrying ownerUserId', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .create({ ownerUserId, title: 'Test Chat' })
      .catch(() => null);
    expect(querySqlContains(queries, 'insert into "chats"')).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
  });

  function stubFindById(
    impl: (
      chatId: string,
      ownerUserId: string,
    ) => Promise<
      | {
          id: string;
          ownerUserId: string;
          title: string | null;
          visibility: 'private' | 'public';
          createdAt: Date;
          updatedAt: Date;
          archivedAt: Date | null;
          projectId: string | null;
          recencyDigestBaseline: null;
          recencyDigestTold: null;
          recencyDigestRebakedFrom: null;
        }
      | undefined
    >,
  ) {
    return vi
      .spyOn(ChatsRepository.prototype, 'findById')
      .mockImplementation(impl);
  }

  it('update scopes the update by chatId AND ownerUserId', async () => {
    const { db, queries } = makeMockDb();
    stubFindById(() =>
      Promise.resolve({
        id: chatId,
        ownerUserId,
        title: 'Old',
        visibility: 'private',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        projectId: null,
        recencyDigestBaseline: null,
        recencyDigestTold: null,
        recencyDigestRebakedFrom: null,
      }),
    );
    await new ChatsRepository(db)
      .update(chatId, ownerUserId, { title: 'New Title' })
      .catch(() => null);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, 'New Title')).toBe(true);
  });

  it('update with an empty patch issues no write (reads instead of bumping updatedAt)', async () => {
    const { db, queries } = makeMockDb();
    stubFindById(() =>
      Promise.resolve({
        id: chatId,
        ownerUserId,
        title: 'Old',
        visibility: 'private',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        projectId: null,
        recencyDigestBaseline: null,
        recencyDigestTold: null,
        recencyDigestRebakedFrom: null,
      }),
    );
    await new ChatsRepository(db)
      .update(chatId, ownerUserId, {})
      .catch(() => null);
    // The stubbed owner-scoped read returns the current row, so an empty patch
    // returns it directly and never reaches a write builder.
    expect(queries).toHaveLength(0);
  });

  it('update with a metadata-only change does NOT bump updatedAt', async () => {
    const { db, queries } = makeMockDb();
    stubFindById(() =>
      Promise.resolve({
        id: chatId,
        ownerUserId,
        title: 'Old',
        visibility: 'private',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        projectId: null,
        recencyDigestBaseline: null,
        recencyDigestTold: null,
        recencyDigestRebakedFrom: null,
      }),
    );
    await new ChatsRepository(db)
      .update(chatId, ownerUserId, { visibility: 'public' })
      .catch(() => null);
    // A real write (not the empty-patch no-op path)...
    expect(querySqlContains(queries, 'update "chats"')).toBe(true);
    // ...that changes visibility but leaves updatedAt alone (metadata must not
    // float the chat to "Today" via the recency sort).
    expect(queryContains(queries, 'public')).toBe(true);
    expect(updateSetSql(queries)).toContain('"visibility"');
    expect(updateSetSql(queries)).not.toContain('"updated_at"');
  });

  it('update with a content change DOES bump updatedAt', async () => {
    const { db, queries } = makeMockDb();
    stubFindById(() =>
      Promise.resolve({
        id: chatId,
        ownerUserId,
        title: 'Old',
        visibility: 'private',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        projectId: null,
        recencyDigestBaseline: null,
        recencyDigestTold: null,
        recencyDigestRebakedFrom: null,
      }),
    );
    await new ChatsRepository(db)
      .update(chatId, ownerUserId, { title: 'New Title' })
      .catch(() => null);
    expect(queryContains(queries, 'New Title')).toBe(true);
    expect(lastQuery(queries).sql).toContain('"updated_at"');
  });

  it('update rejects writes on an archived chat (archive guard)', async () => {
    const { db } = makeMockDb();
    stubFindById(() =>
      Promise.resolve({
        id: chatId,
        ownerUserId,
        title: 'Old',
        visibility: 'private',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: new Date(),
        projectId: null,
        recencyDigestBaseline: null,
        recencyDigestTold: null,
        recencyDigestRebakedFrom: null,
      }),
    );
    await expect(
      new ChatsRepository(db).update(chatId, ownerUserId, { title: 'New' }),
    ).rejects.toThrow('archived');
  });

  it('update allows unarchive even when chat is archived', async () => {
    const { db, queries } = makeMockDb();
    stubFindById(() =>
      Promise.resolve({
        id: chatId,
        ownerUserId,
        title: 'Old',
        visibility: 'private',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: new Date(),
        projectId: null,
        recencyDigestBaseline: null,
        recencyDigestTold: null,
        recencyDigestRebakedFrom: null,
      }),
    );
    await new ChatsRepository(db)
      .update(chatId, ownerUserId, { archived: false })
      .catch(() => null);
    expect(querySqlContains(queries, '"archived_at" = $')).toBe(true);
    expect(lastQuery(queries).params).toContain(null);
  });

  it('update allows archive of a non-archived chat', async () => {
    const { db, queries } = makeMockDb();
    stubFindById(() =>
      Promise.resolve({
        id: chatId,
        ownerUserId,
        title: 'Old',
        visibility: 'private',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        projectId: null,
        recencyDigestBaseline: null,
        recencyDigestTold: null,
        recencyDigestRebakedFrom: null,
      }),
    );
    await new ChatsRepository(db)
      .update(chatId, ownerUserId, { archived: true })
      .catch(() => null);
    expect(updateSetSql(queries)).toContain('"archived_at" = $');
  });

  it('deleteById scopes the delete by chatId AND ownerUserId', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .deleteById(chatId, ownerUserId)
      .catch(() => null);
    expect(querySqlContains(queries, 'delete from "chats"')).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
  });

  it('createIfAbsent stores a supplied title and otherwise binds null', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .createIfAbsent({ id: chatId, ownerUserId, title: 'Named' })
      .catch(() => null);
    expect(queryContains(queries, 'Named')).toBe(true);
    expect(querySqlContains(queries, 'on conflict')).toBe(true);

    queries.length = 0;
    await new ChatsRepository(db)
      .createIfAbsent({ id: chatId, ownerUserId })
      .catch(() => null);
    expect(lastQuery(queries).params).toContain(null);
  });

  it('create defaults visibility to private and title to null', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db).create({ ownerUserId }).catch(() => null);
    expect(queryContains(queries, 'private')).toBe(true);
    expect(lastQuery(queries).params).toContain(null);

    queries.length = 0;
    await new ChatsRepository(db)
      .create({ ownerUserId, title: 'Titled', visibility: 'public' })
      .catch(() => null);
    expect(queryContains(queries, 'Titled')).toBe(true);
    expect(queryContains(queries, 'public')).toBe(true);
  });

  it('setRecencyDigestIfAbsent writes only when the baseline is still null', async () => {
    const { db, queries } = makeMockDb();
    const baseline = {
      pinned: [],
      recent: [],
      pinnedShown: 0,
      pinnedTotal: 0,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-09-03',
    };
    await new ChatsRepository(db)
      .setRecencyDigestIfAbsent(chatId, ownerUserId, baseline, [])
      .catch(() => null);
    expect(querySqlContains(queries, 'update "chats"')).toBe(true);
    expect(querySqlContains(queries, '"recency_digest_baseline" is null')).toBe(
      true,
    );
    expect(queryContains(queries, ownerUserId)).toBe(true);
  });

  it('setRecencyDigest replaces baseline, told-set, and rebake marker', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .setRecencyDigest({
        chatId,
        ownerUserId,
        baseline: {
          pinned: [],
          recent: [],
          pinnedShown: 0,
          pinnedTotal: 0,
          recentShown: 0,
          recentTotal: 0,
          compiledOn: '2026-09-03',
        },
        told: [{ chatId: 'other', pinned: true, title: 'Other' }],
        rebakedFrom: 'compaction-1',
      })
      .catch(() => null);
    expect(queryContains(queries, 'compaction-1')).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(updateSetSql(queries)).toContain('"recency_digest_rebaked_from"');
  });

  it('updateRecencyDigestTold writes only the told-set for the owner chat', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .updateRecencyDigestTold(chatId, ownerUserId, [
        { chatId: 'other', pinned: false, title: 'Other' },
      ])
      .catch(() => null);
    expect(updateSetSql(queries)).toContain('"recency_digest_told"');
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
  });

  it('findPinnedChatIds returns an empty set without querying for an empty id list', async () => {
    const { db, queries } = makeMockDb();
    await expect(
      new ChatsRepository(db).findPinnedChatIds(ownerUserId, []),
    ).resolves.toEqual(new Set());
    expect(queries).toHaveLength(0);
  });

  it('findPinnedChatIds scopes pins to the caller and the requested chat ids', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .findPinnedChatIds(ownerUserId, [chatId, 'other'])
      .catch(() => null);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, 'chat')).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
  });

  it('searchByOwner returns no rows for a blank query and does not touch the database', async () => {
    const { db, queries } = makeMockDb();
    await expect(
      new ChatsRepository(db).searchByOwner(ownerUserId, '   ', 10),
    ).resolves.toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it('searchByOwner scopes both legs to the owner and names the hybrid document columns', async () => {
    const { db } = makeMockDb();
    const statements: Array<unknown> = [];
    vi.spyOn(db, 'execute').mockImplementation((statement) => {
      statements.push(statement);
      return asDbQuery(Promise.resolve([]));
    });

    await new ChatsRepository(db).searchByOwner(
      ownerUserId,
      'hello_world%plus',
      5,
    );

    const strings: Array<string> = [];
    const walk = (value: unknown): void => {
      if (isString(value)) {
        strings.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (isRecord(value)) {
        for (const item of Object.values(value)) walk(item);
      }
    };
    walk(statements);
    expect(strings).toEqual(
      expect.arrayContaining([
        'search_chat_documents',
        'normalized_content',
        ownerUserId,
      ]),
    );
    expect(strings.some((value) => value.includes(String.raw`\_`))).toBe(true);
    expect(strings.some((value) => value.includes(String.raw`\%`))).toBe(true);
  });

  it('searchByOwner collapses snippet whitespace and clips at 160 characters', async () => {
    const long = `alpha${'  '.repeat(10)}bravo ${'c'.repeat(200)}`;
    const { db } = makeMockDb();
    vi.spyOn(db, 'execute')
      // searchByOwner issues `SET LOCAL statement_timeout` before the search
      // itself, and ignores its result.
      .mockImplementationOnce(() => asDbQuery(Promise.resolve(undefined)))
      .mockImplementation(() =>
        asDbQuery(
          Promise.resolve([
            {
              id: chatId,
              title: 'Hit',
              snippet: long,
              updatedAt: new Date('2026-09-03T00:00:00.000Z'),
              bestDocumentId: 'doc-1',
            },
          ]),
        ),
      );

    const [hit] = await new ChatsRepository(db).searchByOwner(
      ownerUserId,
      'bravo',
      5,
    );

    expect(hit?.snippet).not.toContain('  ');
    expect(hit?.snippet?.endsWith('…')).toBe(true);
    expect(hit?.snippet?.length).toBeLessThanOrEqual(161);
    expect(hit?.snippet?.startsWith('alpha bravo')).toBe(true);
  });

  it('searchByOwner leaves a missing snippet as null', async () => {
    const { db } = makeMockDb();
    vi.spyOn(db, 'execute')
      .mockImplementationOnce(() => asDbQuery(Promise.resolve(undefined)))
      .mockImplementation(() =>
        asDbQuery(
          Promise.resolve([
            {
              id: chatId,
              title: 'Title only',
              snippet: null,
              updatedAt: new Date('2026-09-03T00:00:00.000Z'),
              bestDocumentId: null,
            },
          ]),
        ),
      );

    await expect(
      new ChatsRepository(db).searchByOwner(ownerUserId, 'title', 5),
    ).resolves.toEqual([
      {
        id: chatId,
        title: 'Title only',
        snippet: null,
        updatedAt: new Date('2026-09-03T00:00:00.000Z'),
        bestDocumentId: null,
      },
    ]);
  });

  it('findByOwner applies project, exclude, titled-only, and archive-only filters', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .findByOwner(ownerUserId, {
        projectId: 'project-1',
        excludeId: chatId,
        titledOnly: true,
        archived: 'only',
      })
      .catch(() => null);
    expect(queryContains(queries, 'project-1')).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
    expect(lastQuery(queries).sql).toContain('btrim');
    expect(lastQuery(queries).sql).toContain('"archived_at" is not null');
  });

  it('findByOwner includes archived chats when asked and defaults to excluding them', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .findByOwner(ownerUserId, { archived: 'with' })
      .catch(() => null);
    expect(lastQuery(queries).sql).not.toContain('"archived_at" is null');
    expect(lastQuery(queries).sql).not.toContain('"archived_at" is not null');

    queries.length = 0;
    await new ChatsRepository(db).findByOwner(ownerUserId).catch(() => null);
    expect(lastQuery(queries).sql).toContain('"archived_at" is null');
  });

  it('update allows a pure re-archive and rejects mixed unarchive-and-edit', async () => {
    const archived = {
      id: chatId,
      ownerUserId,
      title: 'Old',
      visibility: 'private' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: new Date(),
      projectId: null,
      recencyDigestBaseline: null,
      recencyDigestTold: null,
      recencyDigestRebakedFrom: null,
    };
    const { db, queries } = makeMockDb();
    stubFindById(() => Promise.resolve(archived));
    await new ChatsRepository(db)
      .update(chatId, ownerUserId, { archived: true })
      .catch(() => null);
    expect(queries).toHaveLength(0);

    await expect(
      new ChatsRepository(db).update(chatId, ownerUserId, {
        archived: false,
        title: 'Nope',
      }),
    ).rejects.toThrow('archived');
  });

  it('update files a chat without bumping recency', async () => {
    const { db, queries } = makeMockDb();
    stubFindById(() =>
      Promise.resolve({
        id: chatId,
        ownerUserId,
        title: 'Old',
        visibility: 'private',
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
        projectId: null,
        recencyDigestBaseline: null,
        recencyDigestTold: null,
        recencyDigestRebakedFrom: null,
      }),
    );
    await new ChatsRepository(db)
      .update(chatId, ownerUserId, { projectId: 'project-1' })
      .catch(() => null);
    expect(updateSetSql(queries)).toContain('"project_id"');
    expect(updateSetSql(queries)).not.toContain('"updated_at"');
  });

  it('deleteById is true only when a row is actually removed', async () => {
    const { db } = makeMockDb();
    const returning = vi
      .fn()
      .mockResolvedValueOnce([{ id: chatId }])
      .mockResolvedValueOnce([]);
    vi.spyOn(db, 'delete').mockImplementation(() =>
      asDbQuery({ where: () => ({ returning }) }),
    );

    await expect(
      new ChatsRepository(db).deleteById(chatId, ownerUserId),
    ).resolves.toBe(true);
    await expect(
      new ChatsRepository(db).deleteById(chatId, ownerUserId),
    ).resolves.toBe(false);
  });

  it('setGeneratedTitle scopes by chatId, ownerUserId, and untitled state (#78)', async () => {
    const { db, queries } = makeMockDb();
    await new ChatsRepository(db)
      .setGeneratedTitle(chatId, ownerUserId, 'Weather in NYC')
      .catch(() => null);

    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
    // The atomic guard: only a still-untitled chat (title IS NULL) is written, so
    // any title that landed mid-generation (a user rename, or a concurrent
    // generation) is never clobbered.
    expect(querySqlContains(queries, '"title" is null')).toBe(true);
    expect(queryContains(queries, 'Weather in NYC')).toBe(true);
  });
});

describe('MessagesRepository — owner-scoped + chat-scoped', () => {
  const ownerUserId = 'owner-xyz';
  const chatId = 'chat-1';

  it('findByChatId scopes by chatId AND ownerUserId (join to chats.owner_user_id)', async () => {
    const { db, queries } = makeMockDb();
    await new MessagesRepository(db)
      .findByChatId(chatId, ownerUserId)
      .catch(() => null);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
  });

  it('findByChatId applies the max seq boundary and requested history limit', async () => {
    const { db, queries } = makeMockDb();
    await new MessagesRepository(db)
      .findByChatId(chatId, ownerUserId, { maxSeq: 42, limit: 100 })
      .catch(() => null);

    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, 42)).toBe(true);
    expect(queryContains(queries, 100)).toBe(true);
  });

  it('findByChatId applies the exclusive sinceSeq lower bound (post-compaction reads, #57)', async () => {
    const { db, queries } = makeMockDb();
    await new MessagesRepository(db)
      .findByChatId(chatId, ownerUserId, { sinceSeq: 7 })
      .catch(() => null);

    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, 7)).toBe(true);
  });

  it('findById scopes by messageId, chatId, AND ownerUserId', async () => {
    const { db, queries } = makeMockDb();
    await new MessagesRepository(db)
      .findById(chatId, ownerUserId, 'msg-1')
      .catch(() => null);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, 'msg-1')).toBe(true);
  });

  it.each(['', '   '])(
    'findConversationMessage rejects an empty owner before executing SQL: %j',
    async (emptyOwnerUserId) => {
      const { db } = makeMockDb();
      const executeSpy = vi.spyOn(db, 'execute');

      await expect(
        new MessagesRepository(db).findConversationMessage(
          chatId,
          emptyOwnerUserId,
          7,
        ),
      ).rejects.toThrow(
        'MessagesRepository.findConversationMessage requires a non-empty userId',
      );
      expect(executeSpy).not.toHaveBeenCalled();
    },
  );

  it('createMany issues one INSERT for a batch under the chunk size', async () => {
    const { db, queries } = makeMockDb();
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `copy-${i}`,
      chatId,
      seq: i + 1,
      role: 'user' as const,
      senderUserId: 'user-1',
      parts: [{ type: 'text', text: `q${i}` }],
      attachments: [],
      inReplyTo: null,
    }));

    await new MessagesRepository(db).createMany(rows).catch(() => null);

    // The native Drizzle mock logs the compiled multi-row INSERT before its
    // unavailable transport is reached. Chunking across multiple statements is
    // covered by the live chat-sharing/fork integration tests.
    expect(queries).toHaveLength(1);
    expect(querySqlContains(queries, 'insert into "messages"')).toBe(true);
    expect(lastQuery(queries).params).toHaveLength(24);
  });
});

describe('CompactionsRepository — owner-scoped + chat-scoped (#57)', () => {
  const ownerUserId = 'owner-xyz';
  const chatId = 'chat-1';

  it('findLatestByChatId scopes by chatId AND ownerUserId (join to chats.owner_user_id)', async () => {
    const { db, queries } = makeMockDb();
    await new CompactionsRepository(db)
      .findLatestByChatId(chatId, ownerUserId)
      .catch(() => null);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, 1)).toBe(true);
  });

  it('findLatestByChatId can constrain the latest compaction before a turn seq', async () => {
    const { db, queries } = makeMockDb();
    await new CompactionsRepository(db)
      .findLatestByChatId(chatId, ownerUserId, { beforeSeq: 42 })
      .catch(() => null);

    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, 42)).toBe(true);
  });

  it('findLatestByChatId can constrain the latest compaction inclusively at a target seq', async () => {
    const { db, queries } = makeMockDb();
    await new CompactionsRepository(db)
      .findLatestByChatId(chatId, ownerUserId, { maxSeq: 42 })
      .catch(() => null);

    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, 42)).toBe(true);
    expect(lastQuery(queries).sql).toContain('"upto_seq" <= $');
  });

  it('create inserts chat lineage, raw summary, and required replacement history', async () => {
    const { db, queries } = makeMockDb();
    await new CompactionsRepository(db)
      .create({
        chatId,
        uptoSeq: 42,
        parentId: 'compaction-parent',
        summary: 'earlier turns summarized',
        replacementHistory: [
          {
            role: 'user',
            parts: [
              {
                type: 'text',
                text: '<system-reminder>checkpoint</system-reminder>',
              },
            ],
          },
        ],
        usage: { status: 'completed' },
      })
      .catch(() => null);
    expect(querySqlContains(queries, 'insert into "compactions"')).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, 42)).toBe(true);
    expect(queryContains(queries, 'compaction-parent')).toBe(true);
    expect(queryContains(queries, 'earlier turns summarized')).toBe(true);
    expect(
      queryContains(
        queries,
        '[{"role":"user","parts":[{"type":"text","text":"<system-reminder>checkpoint</system-reminder>"}]}]',
      ),
    ).toBe(true);
  });

  it('createIfCutoffAbsent makes duplicate transition cutoffs a no-op', async () => {
    const { db, queries } = makeMockDb();
    await new CompactionsRepository(db)
      .createIfCutoffAbsent({
        chatId,
        uptoSeq: 42,
        parentId: 'compaction-parent',
        summary: 'transition summary',
        replacementHistory: [
          {
            role: 'user',
            parts: [
              {
                type: 'text',
                text: '<system-reminder>transition</system-reminder>',
              },
            ],
          },
        ],
      })
      .catch(() => null);

    expect(querySqlContains(queries, 'insert into "compactions"')).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, 42)).toBe(true);
    expect(
      queryContains(
        queries,
        '[{"role":"user","parts":[{"type":"text","text":"<system-reminder>transition</system-reminder>"}]}]',
      ),
    ).toBe(true);
    expect(querySqlContains(queries, 'on conflict')).toBe(true);
  });

  it('create rejects an empty replacement history before issuing an insert', async () => {
    const { db, queries } = makeMockDb();

    await expect(
      new CompactionsRepository(db).create({
        chatId,
        uptoSeq: 42,
        summary: 'summary',
        replacementHistory: [],
      }),
    ).rejects.toThrow('replacement history');

    expect(queries).toHaveLength(0);
  });

  it('create rejects a blank summary before issuing an insert', async () => {
    const { db, queries } = makeMockDb();

    await expect(
      new CompactionsRepository(db).create({
        chatId,
        uptoSeq: 42,
        summary: '   ',
        replacementHistory: [
          {
            role: 'user',
            parts: [{ type: 'text', text: 'checkpoint' }],
          },
        ],
      }),
    ).rejects.toThrow('summary');

    expect(queries).toHaveLength(0);
  });

  it('create rejects history without a user checkpoint text part', async () => {
    const { db, queries } = makeMockDb();

    await expect(
      new CompactionsRepository(db).create({
        chatId,
        uptoSeq: 42,
        summary: 'summary',
        replacementHistory: [
          {
            role: 'assistant',
            parts: [{ type: 'text', text: 'not a checkpoint' }],
          },
        ],
      }),
    ).rejects.toThrow('replacement history');

    expect(queries).toHaveLength(0);
  });

  it('create rejects a checkpoint record containing more than one part', async () => {
    const { db, queries } = makeMockDb();

    await expect(
      new CompactionsRepository(db).create({
        chatId,
        uptoSeq: 42,
        summary: 'summary',
        replacementHistory: [
          {
            role: 'user',
            parts: [
              { type: 'text', text: 'checkpoint' },
              { type: 'text', text: 'unexpected second part' },
            ],
          },
        ],
      }),
    ).rejects.toThrow('replacement history');

    expect(queries).toHaveLength(0);
  });

  it.each([
    {
      role: 'assistant' as const,
      parts: [{ type: 'text', text: 'arbitrary assistant text' }],
    },
    {
      role: 'user' as const,
      parts: [{ type: 'text', text: 'later user record' }],
    },
  ])(
    'create rejects an invalid later replacement record: %j',
    async (record) => {
      const { db, queries } = makeMockDb();

      await expect(
        new CompactionsRepository(db).create({
          chatId,
          uptoSeq: 42,
          summary: 'summary',
          replacementHistory: [
            {
              role: 'user',
              parts: [{ type: 'text', text: 'checkpoint' }],
            },
            record,
          ],
        }),
      ).rejects.toThrow('replacement history');

      expect(queries).toHaveLength(0);
    },
  );
});

describe('RunsRepository / RunEventsRepository — owner-scoped (#48)', () => {
  const ownerUserId = 'owner-xyz';
  const chatId = 'chat-1';
  const runId = 'run-1';

  it('create inserts a run carrying chatId AND userId (tenant boundary)', async () => {
    const { db, queries } = makeMockDb();
    await new RunsRepository(db)
      .create({
        chatId,
        messageId: 'msg-1',
        userId: ownerUserId,
        modelId: 'system:openai:gpt-5.4-mini',
        modelContextSnapshotId: 'snapshot-1',
      })
      .catch(() => null);
    expect(querySqlContains(queries, 'insert into "runs"')).toBe(true);
    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, 'system:openai:gpt-5.4-mini')).toBe(true);
    expect(queryContains(queries, 'snapshot-1')).toBe(true);
  });

  it('findActiveByChatId scopes by chatId AND userId and excludes terminal runs', async () => {
    const { db, queries } = makeMockDb();
    await new RunsRepository(db)
      .findActiveByChatId(chatId, ownerUserId)
      .catch(() => null);
    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, 'expired')).toBe(true);
  });

  it('findMostRecentByChatMessageSequence orders by message seq, then deterministic retry ties, without filtering failed runs', async () => {
    const { db, queries } = makeMockDb();

    await new RunsRepository(db)
      .findMostRecentByChatMessageSequence(chatId, ownerUserId)
      .catch(() => null);

    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, 'failed')).toBe(false);
    expect(lastQuery(queries).sql).toContain(
      'order by "messages"."seq" desc, "runs"."created_at" desc, "runs"."id" desc',
    );
    expect(queryContains(queries, 1)).toBe(true);
  });

  it('findMostRecentByChatMessageSequence with beforeSeq is owner-scoped and excludes the triggering seq', async () => {
    const { db, queries } = makeMockDb();

    await new RunsRepository(db)
      .findMostRecentByChatMessageSequence(chatId, ownerUserId, {
        beforeSeq: 42,
      })
      .catch(() => null);

    expect(queryContains(queries, chatId)).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, 42)).toBe(true);
    expect(querySqlContains(queries, '"messages"."seq" <')).toBe(true);
    expect(lastQuery(queries).sql).toContain(
      'order by "messages"."seq" desc, "runs"."created_at" desc, "runs"."id" desc',
    );
    expect(queryContains(queries, 1)).toBe(true);
  });

  it('markStarted scopes by runId AND userId, stamps startedAt, and refuses terminal or cancel-requested runs', async () => {
    const { db, queries } = makeMockDb();
    await new RunsRepository(db)
      .markStarted(runId, ownerUserId)
      .catch(() => null);
    expect(queryContains(queries, runId)).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    // A superseded/cancelled run must never be resurrected into running_model.
    expect(queryContains(queries, 'expired')).toBe(true);
    expect(
      querySqlContains(queries, '"runs"."cancel_requested_at" is null'),
    ).toBe(true);
    expect(queryContains(queries, 'running_model')).toBe(true);
    expect(updateSetSql(queries)).toContain('"started_at" = $');
  });

  it('markStarted does not reclaim by heartbeat or exclude running_model (durable-run-workers D7)', async () => {
    // Regression test for the liveness collapse: the app-level
    // stale-heartbeat CAS (a COALESCE(heartbeat_at, ...) < now() - interval
    // clause, and a status-based `running_model` exclusion) is gone. The
    // separate cancel-requested guard closes the worker pickup TOCTOU; native
    // job-queue liveness still decides whether a running delivery is a
    // legitimate crash-recovery claim.
    const { db, queries } = makeMockDb();
    await new RunsRepository(db)
      .markStarted(runId, ownerUserId)
      .catch(() => null);
    expect(querySqlContains(queries, 'heartbeat_at')).toBe(false);
    expect(whereSql(queries)).not.toContain('running_model');
    // heartbeatAt is a dropped column — markStarted must not write it.
    expect(querySqlContains(queries, 'heartbeat_at')).toBe(false);
  });

  it('cancelActiveRunsForMessage scopes by messageId AND userId and skips terminal runs', async () => {
    const { db, queries } = makeMockDb();
    await new RunsRepository(db)
      .cancelActiveRunsForMessage('msg-9', ownerUserId)
      .catch(() => null);
    expect(queryContains(queries, 'msg-9')).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, 'expired')).toBe(true);
    expect(queryContains(queries, 'cancelled')).toBe(true);
  });

  it('markFinished scopes by runId AND userId and stamps finishedAt + status', async () => {
    const { db, queries } = makeMockDb();
    await new RunsRepository(db)
      .markFinished(runId, ownerUserId, 'failed', { message: 'boom' })
      .catch(() => null);
    expect(queryContains(queries, runId)).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(querySqlContains(queries, 'finished_at')).toBe(true);
    // Terminal states are immutable: the WHERE excludes already-finished runs,
    // so a late stream callback can never overwrite expired/cancelled.
    expect(queryContains(queries, 'expired')).toBe(true);
    expect(queryContains(queries, 'failed')).toBe(true);
    expect(queryContains(queries, JSON.stringify({ message: 'boom' }))).toBe(
      true,
    );
    expect(updateSetSql(queries)).toContain('"finished_at" = $');
  });

  it('requestCancel scopes by runId AND userId and only touches non-terminal runs', async () => {
    const { db, queries } = makeMockDb();
    await new RunsRepository(db)
      .requestCancel(runId, ownerUserId)
      .catch(() => null);
    expect(queryContains(queries, runId)).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, 'expired')).toBe(true);
    expect(updateSetSql(queries)).toContain('"cancel_requested_at" = $');
  });

  it('append inserts an event carrying runId and eventType', async () => {
    const { db, queries } = makeMockDb();
    await new RunEventsRepository(db)
      .append(runId, 'run.started', { at: 'now' })
      .catch(() => null);
    expect(querySqlContains(queries, 'insert into "run_events"')).toBe(true);
    expect(queryContains(queries, runId)).toBe(true);
    expect(queryContains(queries, 'run.started')).toBe(true);
  });

  it('listByRunId scopes by runId AND userId with the after-sequence cursor', async () => {
    const { db, queries } = makeMockDb();
    await new RunEventsRepository(db)
      .listByRunId(runId, ownerUserId, { afterSequence: 7 })
      .catch(() => null);
    expect(queryContains(queries, runId)).toBe(true);
    expect(queryContains(queries, ownerUserId)).toBe(true);
    expect(queryContains(queries, 7)).toBe(true);
  });
});
