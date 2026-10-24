import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type ChatCreationAttempt } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatCreationRecordRepository } from './chat-creation-record.repository';

/*
 * The owner-only creation record (openspec `chat-start-location`, design D9):
 * one row per Chat holding an append-only list of attempts. The insert-or-
 * append is one statement, so the SQL it builds — the conflict target, the
 * `||` append, and the attempt it carries — is what this suite pins; the row
 * behavior itself is proved against Postgres in
 * `chat-creation.integration.test.ts`.
 */

const OWNER = 'owner-1';
const CHAT_ID = '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10';
const ROOT = '/home/operator/projects/llame';

const DECISION = {
  path: ROOT,
  decision: {
    policyId: 'policy-1',
    decision: 'allow',
    reason: 'matched_allow',
    reference: { groupId: 'enter_workspace', list: 'allow', clauseIndex: 0 },
  },
} as const;

type AttemptsRow = { readonly attempts: ReadonlyArray<ChatCreationAttempt> };
type AttemptValues = {
  readonly ownerUserId: string;
  readonly chatId: string;
  readonly attempts: ReadonlyArray<ChatCreationAttempt>;
};

type InsertCall = {
  values?: AttemptValues;
  onConflict?: {
    target?: ReadonlyArray<unknown>;
    set?: { attempts?: SQL };
  };
};

/**
 * The fluent surface `appendAttempt` uses: `insert().values().onConflictDoUpdate()`.
 * The double records the statement instead of executing it, so an assertion can
 * read the attempt the append carries and the conflict it resolves.
 */
function insertResult(calls: Array<InsertCall>) {
  const terminal = Promise.resolve([]);
  const chain = () => terminal;
  const record: InsertCall = {};
  calls.push(record);
  const builder = Object.assign(terminal, {
    values: (values: AttemptValues) => {
      record.values = values;
      return builder;
    },
    onConflictDoUpdate: (config: InsertCall['onConflict']) => {
      record.onConflict = config;
      return terminal;
    },
    from: chain,
    where: chain,
    limit: chain,
  });
  return builder;
}

function selectResult(rows: ReadonlyArray<AttemptsRow>) {
  const terminal = Promise.resolve(rows);
  const chain = () => terminal;
  return Object.assign(terminal, {
    from: chain,
    where: chain,
    limit: chain,
  });
}

function asQuery<T extends object>(query: T): never {
  // SAFETY: this double implements exactly the fluent methods the repository calls.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return query as never;
}

function makeDb(selects: ReadonlyArray<ReadonlyArray<AttemptsRow>> = []) {
  const db: Db = drizzle.mock({ schema });
  const inserts: Array<InsertCall> = [];
  const queue = [...selects];
  vi.spyOn(db, 'insert').mockImplementation(() =>
    asQuery(insertResult(inserts)),
  );
  vi.spyOn(db, 'select').mockImplementation(() =>
    asQuery(selectResult(queue.shift() ?? [])),
  );
  return { db, inserts };
}

describe('ChatCreationRecordRepository', () => {
  it('appends one attempt with its decisions to an insert-or-append row', async () => {
    const { db, inserts } = makeDb();

    await new ChatCreationRecordRepository(db).appendAttempt({
      ownerUserId: OWNER,
      chatId: CHAT_ID,
      decisions: [DECISION],
    });

    const [call] = inserts;
    expect(call?.values).toMatchObject({
      ownerUserId: OWNER,
      chatId: CHAT_ID,
    });
    const attempt = call?.values?.attempts[0];
    expect(attempt?.createdAt).toEqual(expect.any(String));
    expect(attempt?.decisions).toEqual([DECISION]);
    // The conflict target is the owner + chat pair, so two owners' records for
    // one id stay separate rows.
    expect(call?.onConflict?.target).toEqual([
      schema.chatCreationRecords.ownerUserId,
      schema.chatCreationRecords.chatId,
    ]);
  });

  it('appends with `||` so a second attempt cannot overwrite the first', async () => {
    const { db, inserts } = makeDb();

    await new ChatCreationRecordRepository(db).appendAttempt({
      ownerUserId: OWNER,
      chatId: CHAT_ID,
      decisions: [DECISION],
    });

    const append = inserts[0]?.onConflict?.set?.attempts;
    if (append === undefined) throw new Error('expected the append statement');
    const compiled = new PgDialect().sqlToQuery(append);
    expect(compiled.sql).toContain('||');
    expect(compiled.params.join('')).toContain(ROOT);
  });

  it('answers the stored attempts, and none for a Chat never touched', async () => {
    const { db } = makeDb([
      [
        {
          attempts: [{ createdAt: '2026-10-24T00:00:00.000Z', decisions: [] }],
        },
      ],
      [],
    ]);
    const records = new ChatCreationRecordRepository(db);

    await expect(records.findAttempts(OWNER, CHAT_ID)).resolves.toEqual([
      { createdAt: '2026-10-24T00:00:00.000Z', decisions: [] },
    ]);
    await expect(records.findAttempts(OWNER, CHAT_ID)).resolves.toEqual([]);
  });
});
