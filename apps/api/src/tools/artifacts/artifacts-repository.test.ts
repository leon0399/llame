/**
 * ArtifactsRepository unit tests — the seatbelt filters, the joins, and the
 * aggregates as compiled SQL. Real RLS enforcement is proven against a live
 * Postgres in artifact-store.integration.test.ts.
 */

import { drizzle } from 'drizzle-orm/postgres-js';

import { type Db } from '../../db/tenant-db.service';
import { ArtifactsRepository } from './artifacts-repository';

type LoggedQuery = {
  sql: string;
  params: Array<unknown>;
};

function makeMockDb() {
  const queries: Array<LoggedQuery> = [];

  const db: Db = drizzle.mock({
    logger: {
      logQuery(sql, params) {
        queries.push({ sql, params });
      },
    },
  });

  return { db, queries };
}

function lastQuery(queries: Array<LoggedQuery>): LoggedQuery {
  const query = queries.at(-1);

  if (!query) throw new Error('expected a logged database query');

  return query;
}

const CHAT_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = 'owner-1';

describe('ArtifactsRepository', () => {
  it('takes the next number under the Chat and owner filter', async () => {
    const { db, queries } = makeMockDb();

    await new ArtifactsRepository(db)
      .nextSeq(CHAT_ID, OWNER_ID)
      .catch(() => undefined);

    const query = lastQuery(queries);
    expect(query.sql).toContain('update "chats"');
    expect(query.sql).toContain('"artifact_seq" + 1');
    expect(query.sql).toContain('"chats"."owner_user_id" =');
    expect(query.params).toEqual(expect.arrayContaining([CHAT_ID, OWNER_ID]));
  });

  it('lists one Chat oldest first with summed part sizes', async () => {
    const { db, queries } = makeMockDb();

    await new ArtifactsRepository(db).listChat(CHAT_ID).catch(() => []);

    const query = lastQuery(queries);
    expect(query.sql).toContain('left join "tool_artifact_parts"');
    expect(query.sql).toContain('coalesce(sum(');
    expect(query.sql).toContain('group by "tool_artifacts"."id"');
    expect(query.sql).toContain('order by "tool_artifacts"."seq"');
    expect(query.params).toContain(CHAT_ID);
  });

  it('finds a part set through one joined locator query', async () => {
    const { db, queries } = makeMockDb();

    await new ArtifactsRepository(db)
      .findParts(CHAT_ID, 'bash', 2)
      .catch(() => undefined);

    const query = lastQuery(queries);
    expect(query.sql).toContain('from "tool_artifacts"');
    expect(query.sql).toContain('inner join "tool_artifact_parts"');
    expect(query.sql).toContain('"tool_artifacts"."chat_id" =');
    expect(query.sql).toContain('"tool_artifacts"."tool_name" =');
    expect(query.sql).toContain('"tool_artifacts"."seq" =');
    expect(query.sql).toContain('order by "tool_artifact_parts"."name"');
    expect(query.params).toEqual(expect.arrayContaining([CHAT_ID, 'bash', 2]));
  });

  it('reads one part with the Chat seatbelt and no findings', async () => {
    const { db, queries } = makeMockDb();

    await new ArtifactsRepository(db)
      .findPartContent(CHAT_ID, 'artifact-2', 'stdout')
      .catch(() => []);

    const query = lastQuery(queries);
    expect(query.sql).toContain('from "tool_artifact_parts"');
    expect(query.sql).toContain('inner join "tool_artifacts"');
    expect(query.sql).toContain('"tool_artifacts"."chat_id" =');
    expect(query.sql).toContain('"tool_artifact_parts"."name" =');
    expect(query.sql).not.toContain('"findings"');
    expect(query.params).toEqual(
      expect.arrayContaining([CHAT_ID, 'artifact-2', 'stdout']),
    );
  });

  it('reads one named part through one joined locator query', async () => {
    const { db, queries } = makeMockDb();

    await new ArtifactsRepository(db)
      .readPart(CHAT_ID, 'bash', 2, 'stdout')
      .catch(() => undefined);

    const query = lastQuery(queries);
    expect(query.sql).toContain('from "tool_artifact_parts"');
    expect(query.sql).toContain('inner join "tool_artifacts"');
    expect(query.sql).toContain('"tool_artifact_parts"."name" =');
    expect(query.params).toEqual(
      expect.arrayContaining([CHAT_ID, 'bash', 2, 'stdout']),
    );
  });
});
