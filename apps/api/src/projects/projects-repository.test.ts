import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ProjectsRepository } from './projects-repository';

type LoggedQuery = { sql: string; params: Array<unknown> };

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

function lastQuery(queries: Array<LoggedQuery>): LoggedQuery {
  const query = queries.at(-1);
  if (!query) throw new Error('expected a logged database query');
  return query;
}

describe('ProjectsRepository list ordering', () => {
  it('orders pinned-only projects by the owner pin position', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectsRepository(db)
      .listForUser('owner', { pinned: 'only' })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain('inner join "pins"');
    expect(lastQuery(queries).sql).toContain(
      'order by "pins"."position" asc, "pins"."item_id"',
    );
    expect(lastQuery(queries).sql).not.toContain(
      'order by "projects"."updated_at"',
    );
  });

  it('keeps excluded pins on project activity order', async () => {
    const { db, queries } = makeMockDb();
    await new ProjectsRepository(db)
      .listForUser('owner', { pinned: 'exclude' })
      .catch(() => null);

    expect(lastQuery(queries).sql).toContain(
      'order by "projects"."updated_at" desc',
    );
    expect(lastQuery(queries).sql).not.toContain('inner join "pins"');
  });
});
