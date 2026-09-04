import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Session } from '../db/schema';
import { isString } from '../unknown-record';
import { SessionsRepository } from './sessions.repository';

type LoggedQuery = { sql: string; params: Array<unknown> };
type QueryCall = { method: string; args: Array<unknown> };

/** The columns this repository writes through `.set()`, recorded verbatim. */
type SessionUpdate = Partial<typeof schema.sessions.$inferInsert>;

const NOW = new Date('2026-09-02T12:00:00.000Z');
const IDLE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const TOUCH_DEBOUNCE_MS = 60_000;

const session: Session = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  tokenHash: 'token-hash',
  userId: 'owner-1',
  expires: new Date('2026-09-30T00:00:00.000Z'),
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  lastSeenAt: new Date('2026-09-02T11:59:30.000Z'),
  userAgent: 'agent',
  ip: '10.0.0.1',
};

function makeLoggedDb(options: { stubSelectWith?: Array<unknown> } = {}) {
  const queries: Array<LoggedQuery> = [];
  const db = drizzle.mock({
    schema,
    logger: {
      logQuery(sql, params) {
        queries.push({ sql, params });
      },
    },
  });
  if (options.stubSelectWith !== undefined) {
    // Stub only the read so the write is still built (and logged) by the real
    // query builder; drizzle.mock rejects on execute, never before logging.
    vi.spyOn(db, 'select').mockImplementation(() =>
      asDbQuery(queryResult(options.stubSelectWith ?? [], [])),
    );
  }

  return { repository: new SessionsRepository(db), queries };
}

/**
 * Drizzle's terminal builders carry private state no structural double can
 * satisfy, so a spy that replaces one hands its fluent Promise back through the
 * `never` bottom type.
 */
function asDbQuery(query: ReturnType<typeof queryResult>): never {
  // SAFETY: queryResult implements exactly the fluent methods this repository
  // calls, and every terminal is a real Promise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return query as never;
}

/** A Promise fluent double covering the exact chains this repository uses. */
function queryResult(value: Array<unknown>, calls: Array<QueryCall>) {
  const terminal = Promise.resolve(value);
  const chain = () => terminal;
  return Object.assign(terminal, {
    from: chain,
    where: chain,
    orderBy: chain,
    limit: chain,
    values: chain,
    set: (setValue: SessionUpdate) => {
      calls.push({ method: 'set', args: [setValue] });
      return terminal;
    },
    returning: () => {
      calls.push({ method: 'returning', args: [] });
      return terminal;
    },
  });
}

function makeStubDb(rows: {
  select?: Array<unknown>;
  update?: Array<unknown>;
}) {
  const db = drizzle.mock({ schema });
  const calls: Array<QueryCall> = [];
  const select = vi.spyOn(db, 'select').mockImplementation(() => {
    calls.push({ method: 'select', args: [] });
    return asDbQuery(queryResult(rows.select ?? [], calls));
  });
  const update = vi.spyOn(db, 'update').mockImplementation(() => {
    calls.push({ method: 'update', args: [] });
    return asDbQuery(queryResult(rows.update ?? [], calls));
  });

  return { repository: new SessionsRepository(db), calls, select, update };
}

/** The bound value of a timestamp parameter, which drizzle encodes as an ISO string. */
function boundTime(value: unknown): number {
  if (!isString(value)) {
    throw new TypeError(
      'expected a bound timestamp parameter, got a non-string',
    );
  }
  return new Date(value).getTime();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SessionsRepository.create', () => {
  it('stores the supplied user agent and ip verbatim', async () => {
    const { repository, queries } = makeLoggedDb();

    await repository
      .create({
        userId: 'owner-1',
        tokenHash: 'hash-1',
        expires: session.expires,
        userAgent: 'Mozilla/5.0',
        ip: '203.0.113.7',
      })
      .catch(() => undefined);

    expect(queries).toHaveLength(1);
    expect(queries[0].params).toContain('Mozilla/5.0');
    expect(queries[0].params).toContain('203.0.113.7');
    expect(queries[0].params).not.toContain(null);
  });

  it('normalizes an omitted user agent and ip to null, never to a falsy value', async () => {
    const { repository, queries } = makeLoggedDb();

    await repository
      .create({
        userId: 'owner-1',
        tokenHash: 'hash-1',
        expires: session.expires,
      })
      .catch(() => undefined);

    // `?? null` must survive: `&& null` would also yield null here, so the
    // discriminating case is the supplied-value test above.
    expect(queries[0].params).toStrictEqual([
      'hash-1',
      'owner-1',
      expect.anything(),
      null,
      null,
    ]);
  });

  it('keeps an explicitly cleared user agent and ip as null', async () => {
    const { repository, queries } = makeLoggedDb();

    await repository
      .create({
        userId: 'owner-1',
        tokenHash: 'hash-1',
        expires: session.expires,
        userAgent: null,
        ip: null,
      })
      .catch(() => undefined);

    expect(queries[0].params.slice(-2)).toStrictEqual([null, null]);
  });
});

describe('SessionsRepository.findActiveAndTouch', () => {
  it('bounds the fast path by the debounce window, looking backwards from now', async () => {
    const { repository, queries } = makeLoggedDb();

    await repository
      .findActiveAndTouch('token-hash', {
        idleTtlMs: IDLE_TTL_MS,
        touchDebounceMs: TOUCH_DEBOUNCE_MS,
      })
      .catch(() => undefined);

    expect(queries[0].sql).toContain('"token_hash" = $');
    expect(queries[0].sql).toContain('"expires" > $');
    expect(queries[0].sql).toContain('"last_seen_at" > $');
    expect(boundTime(queries[0].params[1])).toBe(NOW.getTime());
    // now - debounce, in the past. `now + debounce` would make every session
    // look stale and force a write on every request.
    expect(boundTime(queries[0].params[2])).toBe(
      NOW.getTime() - TOUCH_DEBOUNCE_MS,
    );
  });

  it('returns the debounced session without writing anything', async () => {
    const { repository, calls, update } = makeStubDb({ select: [session] });

    await expect(
      repository.findActiveAndTouch('token-hash', {
        idleTtlMs: IDLE_TTL_MS,
        touchDebounceMs: TOUCH_DEBOUNCE_MS,
      }),
    ).resolves.toBe(session);

    expect(update).not.toHaveBeenCalled();
    expect(calls.map(({ method }) => method)).toStrictEqual(['select']);
  });

  it('touches last_seen_at and returns the updated row when the debounce has lapsed', async () => {
    const touchedRow = { ...session, lastSeenAt: NOW };
    const { repository, calls } = makeStubDb({
      select: [],
      update: [touchedRow],
    });

    await expect(
      repository.findActiveAndTouch('token-hash', {
        idleTtlMs: IDLE_TTL_MS,
        touchDebounceMs: TOUCH_DEBOUNCE_MS,
      }),
    ).resolves.toBe(touchedRow);

    const set = calls.find(({ method }) => method === 'set');
    expect(set?.args[0]).toStrictEqual({ lastSeenAt: NOW });
    expect(calls.some(({ method }) => method === 'returning')).toBe(true);
  });

  it('returns undefined when neither the fast path nor the touch matches', async () => {
    const { repository } = makeStubDb({ select: [], update: [] });

    await expect(
      repository.findActiveAndTouch('token-hash', {
        idleTtlMs: IDLE_TTL_MS,
        touchDebounceMs: TOUCH_DEBOUNCE_MS,
      }),
    ).resolves.toBeUndefined();
  });

  it('re-checks idle validity inside the touching UPDATE, bounded backwards', async () => {
    const { repository, queries } = makeLoggedDb({ stubSelectWith: [] });

    await repository
      .findActiveAndTouch('token-hash', {
        idleTtlMs: IDLE_TTL_MS,
        touchDebounceMs: TOUCH_DEBOUNCE_MS,
      })
      .catch(() => undefined);

    const update = queries.find(({ sql }) => sql.startsWith('update'));
    expect(update?.sql).toContain('"last_seen_at" = $');
    expect(update?.sql).toContain('returning');
    expect(boundTime(update?.params[0])).toBe(NOW.getTime());
    expect(boundTime(update?.params[3])).toBe(NOW.getTime() - IDLE_TTL_MS);
  });
});

describe('SessionsRepository read and delete queries', () => {
  it('deletes a stale session by expiry OR idleness, both looking backwards', async () => {
    const { repository, queries } = makeLoggedDb();

    await repository
      .deleteStaleByTokenHash('token-hash', IDLE_TTL_MS)
      .catch(() => undefined);

    expect(queries[0].sql).toContain('"expires" <= $');
    expect(queries[0].sql).toContain('"last_seen_at" <= $');
    expect(boundTime(queries[0].params[1])).toBe(NOW.getTime());
    expect(boundTime(queries[0].params[2])).toBe(NOW.getTime() - IDLE_TTL_MS);
  });

  it('lists only sessions that would still authenticate, newest first', async () => {
    const { repository, queries } = makeLoggedDb();

    await repository.listForUser('owner-1', IDLE_TTL_MS).catch(() => undefined);

    expect(queries[0].sql).toContain('order by "sessions"."created_at" desc');
    expect(boundTime(queries[0].params[2])).toBe(NOW.getTime() - IDLE_TTL_MS);
  });

  it('applies the same validity filter when reading one owned session', async () => {
    const { repository, queries } = makeLoggedDb();

    await repository
      .findByIdForUser('owner-1', session.id, IDLE_TTL_MS)
      .catch(() => undefined);

    expect(queries[0].params[0]).toBe('owner-1');
    expect(queries[0].params[1]).toBe(session.id);
    expect(boundTime(queries[0].params[3])).toBe(NOW.getTime() - IDLE_TTL_MS);
  });

  it.each([
    [
      'deleteByIdForUser',
      (repository: SessionsRepository) =>
        repository.deleteByIdForUser('owner-1', session.id),
    ],
    [
      'deleteOthersForUser',
      (repository: SessionsRepository) =>
        repository.deleteOthersForUser('owner-1', session.id),
    ],
    [
      'deleteAllForUser',
      (repository: SessionsRepository) =>
        repository.deleteAllForUser('owner-1'),
    ],
    [
      'deleteExpired',
      (repository: SessionsRepository) => repository.deleteExpired(IDLE_TTL_MS),
    ],
  ])('%s returns the deleted ids so the count is real', async (_name, call) => {
    const { repository, queries } = makeLoggedDb();

    await call(repository).catch(() => undefined);

    // Without a returning projection the row count is always 0 and a revoke
    // silently reports "nothing deleted".
    expect(queries[0].sql).toContain('returning "id"');
  });

  it('scopes deleteOthersForUser to the owner while sparing the current session', async () => {
    const { repository, queries } = makeLoggedDb();

    await repository
      .deleteOthersForUser('owner-1', session.id)
      .catch(() => undefined);

    expect(queries[0].sql).toContain('"user_id" = $');
    expect(queries[0].sql).toContain('"id" <> $');
    expect(queries[0].params).toStrictEqual(['owner-1', session.id]);
  });

  it('purges by expiry OR idleness across users, looking backwards from now', async () => {
    const { repository, queries } = makeLoggedDb();

    await repository.deleteExpired(IDLE_TTL_MS).catch(() => undefined);

    expect(queries[0].sql).toContain('"expires" <= $');
    expect(queries[0].sql).toContain('"last_seen_at" <= $');
    expect(boundTime(queries[0].params[0])).toBe(NOW.getTime());
    expect(boundTime(queries[0].params[1])).toBe(NOW.getTime() - IDLE_TTL_MS);
  });

  it('counts the rows the delete actually returned', async () => {
    const db = drizzle.mock({ schema });
    const calls: Array<QueryCall> = [];
    vi.spyOn(db, 'delete').mockImplementation(() =>
      asDbQuery(queryResult([{ id: 'a' }, { id: 'b' }], calls)),
    );

    await expect(
      new SessionsRepository(db).deleteAllForUser('owner-1'),
    ).resolves.toBe(2);
  });
});
