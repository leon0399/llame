/**
 * ChatJobsRepository as compiled SQL: the owner and Chat filters, the
 * settlement, and stop requests. Real RLS is proven in
 * job-store.integration.test.ts.
 */

import { drizzle } from 'drizzle-orm/postgres-js';

import { type Db } from '../db/tenant-db.service';
import { ChatJobsRepository } from './chat-jobs.repository';

function make() {
  const queries: Array<{ sql: string; params: Array<unknown> }> = [];

  const db: Db = drizzle.mock({
    logger: { logQuery: (sql, params) => void queries.push({ sql, params }) },
  });

  const last = () => {
    const query = queries.at(-1);

    if (!query) throw new Error('expected a logged database query');

    return query;
  };

  return { repository: new ChatJobsRepository(db), last };
}

const CHAT = 'chat-1';
const OWNER = 'owner-1';
const JOB = 'job-1';

describe('ChatJobsRepository', () => {
  it('lists one Chat of one owner, oldest first', async () => {
    const { repository, last } = make();

    await repository.listByChat(CHAT, OWNER).catch(() => undefined);

    expect(last().sql).toContain('"chat_jobs"."chat_id" =');
    expect(last().sql).toContain('"chat_jobs"."owner_user_id" =');
    expect(last().sql).toMatch(
      /order by "chat_jobs"\."started_at" asc, "chat_jobs"\."seq" asc/u,
    );
    expect(last().params).toEqual(expect.arrayContaining([CHAT, OWNER]));
  });

  it('settles only a running job of the Chat and owner, and sets the end time', async () => {
    const { repository, last } = make();

    await repository
      .settle(CHAT, OWNER, JOB, { state: 'cancelled', stoppedBy: 'owner' })
      .catch(() => undefined);

    expect(last().sql).toContain('update "chat_jobs"');
    expect(last().sql).toContain('"settled_at" = now()');
    expect(last().sql).toContain('"chat_jobs"."id" =');
    expect(last().sql).toContain('"chat_jobs"."chat_id" =');
    expect(last().sql).toContain('"chat_jobs"."owner_user_id" =');
    expect(last().sql).toContain('"chat_jobs"."state" =');
    expect(last().params).toEqual(
      expect.arrayContaining([
        JOB,
        CHAT,
        OWNER,
        'running',
        'cancelled',
        'owner',
      ]),
    );
  });

  it('clears the stopper, result, and artifact of a settlement that has none', async () => {
    const { repository, last } = make();

    await repository
      .settle(CHAT, OWNER, JOB, { state: 'succeeded' })
      .catch(() => undefined);

    expect(last().params.slice(0, 4)).toEqual(['succeeded', null, null, null]);
  });

  it('keeps the first stop request and touches only a running job', async () => {
    const { repository, last } = make();

    await repository
      .requestStop(CHAT, OWNER, JOB, 'owner')
      .catch(() => undefined);

    expect(last().sql).toContain(
      'coalesce("chat_jobs"."stop_requested_at", now())',
    );
    expect(last().sql).toContain('coalesce("chat_jobs"."stop_requested_by"');
    expect(last().sql).toContain('"chat_jobs"."state" =');
    expect(last().params).toEqual(
      expect.arrayContaining([JOB, CHAT, OWNER, 'running', 'owner']),
    );
  });

});
