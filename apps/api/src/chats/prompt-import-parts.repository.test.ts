import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  createContextItemPart,
  isContextItemPart,
  type AuthoredContextItemPart,
} from './context-item';
import { PromptImportPartsRepository } from './prompt-import-parts.repository';
import { createPromptImportsItem } from './prompt-imports-item';

const RUN_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_RUN_ID = '22222222-3333-4444-8555-666666666666';
const CHAT_ID = 'chat-1';
const MESSAGE_ID = 'message-1';

/** Each stored part's producer, or `text` for a user-authored part. */
function producersOf(parts: ReadonlyArray<unknown>): Array<string> {
  return parts.map((part) =>
    isContextItemPart(part) ? part.data.producer : 'text',
  );
}

function item(
  producer: 'skill-activation' | 'temporal' | 'tool-availability',
  runId: string,
): AuthoredContextItemPart {
  return createContextItemPart({
    producer,
    form: 'notice',
    runId,
    payload: {},
    text: `${producer} body`,
  });
}

function promptImports(runId: string): AuthoredContextItemPart {
  return createPromptImportsItem({
    runId,
    outcomes: [
      {
        locator: 'notes.md',
        resolved: '/repo/notes.md',
        outcome: 'imported',
        body: 'notes body',
      },
    ],
    omitted: [],
  });
}

type QueryValue = ReadonlyArray<unknown>;

/** The one update payload these tests make: the row's replacement parts. */
type PartsUpdate = { readonly parts: Array<unknown> };

/** The fluent surface these tests fake: every builder step resolves the rows. */
interface FakeQuery extends Promise<QueryValue> {
  from: () => Promise<QueryValue>;
  where: () => Promise<QueryValue>;
  for: () => Promise<QueryValue>;
  limit: () => Promise<QueryValue>;
  set: (value: PartsUpdate) => Promise<QueryValue>;
  returning: () => Promise<QueryValue>;
}

/** A Drizzle-shaped chain whose terminal resolves to the queued rows. */
function queryResult(
  rows: QueryValue,
  onSet?: (value: PartsUpdate) => void,
): FakeQuery {
  const terminal = Promise.resolve(rows);
  const chain = () => terminal;
  return Object.assign(terminal, {
    from: chain,
    where: chain,
    for: chain,
    limit: chain,
    set: (value: PartsUpdate) => {
      onSet?.(value);
      return terminal;
    },
    returning: chain,
  });
}

function asQuery(value: FakeQuery): never {
  // SAFETY: the repository tests replace Drizzle's fluent terminal with a
  // Promise carrying exactly the chain methods these calls exercise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

/**
 * A `Db` serving one stored parts array per read and recording writes, so the
 * idempotency guard and the insertion position can be asserted without a
 * database.
 */
function fakeDb(
  parts: ReadonlyArray<unknown>,
  rows: { readonly selected?: QueryValue; readonly updated?: QueryValue } = {},
) {
  const writes: Array<Array<unknown>> = [];
  const reads: Array<null> = [];
  const db: Db = drizzle.mock({ schema });
  vi.spyOn(db, 'select').mockImplementation(() => {
    reads.push(null);
    return asQuery(queryResult(rows.selected ?? [{ parts }]));
  });
  vi.spyOn(db, 'update').mockImplementation(() =>
    asQuery(
      queryResult(rows.updated ?? [{ id: MESSAGE_ID }], (update) => {
        writes.push(update.parts);
      }),
    ),
  );
  return { db, writes, reads };
}

const append = (
  parts: ReadonlyArray<unknown>,
  rows?: { readonly selected?: QueryValue; readonly updated?: QueryValue },
) => {
  const { db, writes, reads } = fakeDb(parts, rows);
  return new PromptImportPartsRepository(db)
    .appendForRun({
      id: MESSAGE_ID,
      chatId: CHAT_ID,
      runId: RUN_ID,
      item: promptImports(RUN_ID),
    })
    .then((result) => ({ ...result, writes, reads }));
};

describe('PromptImportPartsRepository.appendForRun', () => {
  it('inserts after a skill-activation item and before the user text', async () => {
    const { applied, writes } = await append([
      item('skill-activation', RUN_ID),
      { type: 'text', text: 'user words' },
    ]);

    expect(applied).toBe(true);
    expect(producersOf(writes[0])).toEqual([
      'skill-activation',
      'prompt-imports',
      'text',
    ]);
  });

  it('goes before the lower-precedence temporal item', async () => {
    const { writes } = await append([
      item('tool-availability', RUN_ID),
      item('skill-activation', RUN_ID),
      item('temporal', RUN_ID),
      { type: 'text', text: 'user words' },
    ]);

    expect(producersOf(writes[0])).toEqual([
      'tool-availability',
      'skill-activation',
      'prompt-imports',
      'temporal',
      'text',
    ]);
  });

  it('lands before the user text when no other item is stored', async () => {
    const { writes } = await append([{ type: 'text', text: 'user words' }]);

    expect(producersOf(writes[0])).toEqual(['prompt-imports', 'text']);
  });

  it('is idempotent for the same Run', async () => {
    const { applied, writes } = await append([
      promptImports(RUN_ID),
      { type: 'text', text: 'user words' },
    ]);

    expect(applied).toBe(false);
    expect(writes).toEqual([]);
  });

  it('inserts for a Run whose message carries only another Run item', async () => {
    const { applied, writes } = await append([
      promptImports(OTHER_RUN_ID),
      { type: 'text', text: 'user words' },
    ]);

    expect(applied).toBe(true);
    expect(producersOf(writes[0])).toEqual([
      'prompt-imports',
      'prompt-imports',
      'text',
    ]);
  });

  it('reports not applied when the message is gone', async () => {
    const { applied, writes } = await append([], { selected: [] });

    expect(applied).toBe(false);
    expect(writes).toEqual([]);
  });

  it('reports not applied when the update matches no row', async () => {
    const { applied } = await append([{ type: 'text', text: 'words' }], {
      updated: [],
    });

    expect(applied).toBe(false);
  });
});

describe('PromptImportPartsRepository.findForRun', () => {
  const find = (parts: ReadonlyArray<unknown>) =>
    new PromptImportPartsRepository(fakeDb(parts).db).findForRun({
      id: MESSAGE_ID,
      chatId: CHAT_ID,
      runId: RUN_ID,
    });

  it("returns this Run's stored item", async () => {
    const stored = promptImports(RUN_ID);

    const found = await find([
      item('skill-activation', RUN_ID),
      stored,
      { type: 'text', text: 'user words' },
    ]);

    expect(found).toEqual(stored);
    expect(found?.data.payload?.imports).toEqual([
      {
        locator: 'notes.md',
        resolved: '/repo/notes.md',
        outcome: 'imported',
      },
    ]);
  });

  it("ignores another Run's item", async () => {
    expect(await find([promptImports(OTHER_RUN_ID)])).toBeUndefined();
  });

  it('ignores other producers for this Run', async () => {
    expect(
      await find([item('skill-activation', RUN_ID), item('temporal', RUN_ID)]),
    ).toBeUndefined();
  });

  it("returns this Run's item with an undefined payload when invalid", async () => {
    const malformed = createContextItemPart({
      producer: 'prompt-imports',
      form: 'notice',
      runId: RUN_ID,
      payload: { imports: 'nope' },
      text: 'malformed',
    });

    const found = await find([malformed]);

    expect(found).toEqual({
      ...malformed,
      data: { ...malformed.data, payload: undefined },
    });
    expect(found?.data.payload).toBeUndefined();
  });

  it('returns undefined when the message is gone', async () => {
    const { db } = fakeDb([], { selected: [] });

    expect(
      await new PromptImportPartsRepository(db).findForRun({
        id: MESSAGE_ID,
        chatId: CHAT_ID,
        runId: RUN_ID,
      }),
    ).toBeUndefined();
  });
});

describe('PromptImportPartsRepository owner scoping', () => {
  /** A mock `Db` that logs real compiled SQL and parameters, then fails. */
  function loggingDb() {
    const queries: Array<{ sql: string; params: Array<unknown> }> = [];
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

  const input = { id: MESSAGE_ID, chatId: CHAT_ID, runId: RUN_ID };

  it('findForRun scopes by message, chat, and the user role', async () => {
    const { db, queries } = loggingDb();

    await new PromptImportPartsRepository(db)
      .findForRun(input)
      .catch(() => null);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('"messages"."id" = $');
    expect(queries[0].sql).toContain('"messages"."chat_id" = $');
    expect(queries[0].sql).toContain('"messages"."role" = $');
    expect(queries[0].params).toEqual(
      expect.arrayContaining([MESSAGE_ID, CHAT_ID, 'user']),
    );
  });

  it('appendForRun locks the row it reads, scoped the same way', async () => {
    const { db, queries } = loggingDb();

    await new PromptImportPartsRepository(db)
      .appendForRun({ ...input, item: promptImports(RUN_ID) })
      .catch(() => null);

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('for update');
    expect(queries[0].sql).toContain('"messages"."chat_id" = $');
    expect(queries[0].params).toEqual(
      expect.arrayContaining([MESSAGE_ID, CHAT_ID, 'user']),
    );
  });
});
