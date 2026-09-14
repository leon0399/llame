import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import { ActivationPartsRepository } from './activation-parts.repository';
import {
  createContextItemPart,
  isContextItemPart,
  type AuthoredContextItemPart,
} from './context-item';
import { type Db } from '../db/tenant-db.service';

const RUN_ID = '11111111-2222-4333-8444-555555555555';
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

type QueryValue = ReadonlyArray<unknown>;

/** The one update payload these tests make: the row's replacement parts. */
type PartsUpdate = { readonly parts: Array<unknown> };

/**
 * A Drizzle-shaped chain whose terminal resolves to the queued rows — the same
 * substitution `messages-repository.behavior.test.ts` uses, so a repository read
 * can be answered without a database.
 */
function queryResult(rows: QueryValue, onSet?: (value: PartsUpdate) => void) {
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
    returning: () => terminal,
  });
}

function asQuery(value: ReturnType<typeof queryResult>): never {
  // SAFETY: the repository tests replace Drizzle's fluent terminal with a
  // Promise carrying exactly the chain methods these calls exercise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

/**
 * A `Db` serving one stored parts array per read and recording writes, so the
 * idempotency guard and the insertion position can be asserted without a
 * database.
 *
 * `rows` covers the two states a caller cannot produce by hand: the message is
 * gone, and the update matches nothing.
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
  items: Array<AuthoredContextItemPart>,
  rows?: { readonly selected?: QueryValue; readonly updated?: QueryValue },
) => {
  const { db, writes, reads } = fakeDb(parts, rows);
  return new ActivationPartsRepository(db)
    .appendForRun({
      id: MESSAGE_ID,
      chatId: CHAT_ID,
      runId: RUN_ID,
      items,
    })
    .then((result) => ({ ...result, writes, reads }));
};

describe('ActivationPartsRepository.appendForRun', () => {
  it('inserts activations even though this Run already has a temporal item', async () => {
    // The P1 this guards: every accepted message carries this Run's temporal
    // item, so a guard keyed on the Run alone would never insert anything.
    const { applied, writes } = await append(
      [item('temporal', RUN_ID), { type: 'text', text: 'user words' }],
      [item('skill-activation', RUN_ID)],
    );

    expect(applied).toBe(true);
    expect(writes).toHaveLength(1);
    // `temporal` follows `skill-activation` in the rail's precedence, so the
    // activation goes BEFORE it — and, in both cases, before the user's text.
    expect(producersOf(writes[0])).toEqual([
      'skill-activation',
      'temporal',
      'text',
    ]);
  });

  it('inserts at the rail position, never after the user text', async () => {
    const { writes } = await append(
      [item('temporal', RUN_ID), { type: 'text', text: 'user words' }],
      [item('skill-activation', RUN_ID)],
    );

    const parts = producersOf(writes[0]);
    expect(parts.indexOf('skill-activation')).toBeLessThan(
      parts.indexOf('text'),
    );
  });

  it('goes after a higher-precedence rail item already stored', async () => {
    // Tool availability precedes activations in the rail's order, so the
    // activation lands after it and before the lower-precedence temporal item.
    const { writes } = await append(
      [item('tool-availability', RUN_ID), item('temporal', RUN_ID)],
      [item('skill-activation', RUN_ID)],
    );

    expect(producersOf(writes[0])).toEqual([
      'tool-availability',
      'skill-activation',
      'temporal',
    ]);
  });

  it('is idempotent for the same Run', async () => {
    const { applied, writes } = await append(
      [item('skill-activation', RUN_ID)],
      [item('skill-activation', RUN_ID)],
    );

    expect(applied).toBe(false);
    expect(writes).toEqual([]);
  });

  it('inserts again for a different Run on the same message', async () => {
    const otherRun = '22222222-3333-4444-8555-666666666666';
    const { applied } = await append(
      [item('skill-activation', otherRun)],
      [item('skill-activation', RUN_ID)],
    );

    expect(applied).toBe(true);
  });

  it('persists a selection the prior attempt never stored', async () => {
    // The retry case: attempt 1 stored `pdf` and reported `research` as omitted
    // because its byte budget dropped it. Attempt 2 reads `research` for real, so
    // the fresh item MUST persist — skipping the whole append because some
    // activation item already existed for the Run would lose the instructions.
    const activation = (skill: string) =>
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId: RUN_ID,
        payload: { kind: 'activation', skill },
        text: `activation ${skill}`,
      });

    const { applied, writes } = await append(
      [activation('pdf'), item('temporal', RUN_ID)],
      [activation('research')],
    );

    expect(applied).toBe(true);
    expect(producersOf(writes[0])).toContain('skill-activation');
  });

  it('does not duplicate an already-stored selection', async () => {
    const activation = (skill: string) =>
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId: RUN_ID,
        payload: { kind: 'activation', skill },
        text: `activation ${skill}`,
      });

    const { applied, writes } = await append(
      [activation('pdf')],
      [activation('pdf')],
    );

    expect(applied).toBe(false);
    expect(writes).toEqual([]);
  });

  it('inserts only the fresh selections from a mixed retry', async () => {
    const activation = (skill: string) =>
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId: RUN_ID,
        payload: { kind: 'activation', skill },
        text: `activation ${skill}`,
      });

    const { applied, writes } = await append(
      [activation('pdf')],
      [activation('pdf'), activation('research')],
    );

    expect(applied).toBe(true);
    // Exactly one row appended, carrying only the selection that was missing.
    expect(writes[0]).toHaveLength(2);
    const appended = writes[0].filter(
      (part) =>
        isContextItemPart(part) && part.data.payload['skill'] === 'research',
    );
    expect(appended).toHaveLength(1);
    expect(
      writes[0].filter(
        (part) =>
          isContextItemPart(part) && part.data.payload['skill'] === 'pdf',
      ),
    ).toHaveLength(1);
  });

  it('drops a resolved name from the stale omission item', async () => {
    // Attempt 1 reported `research` (and `writing`) as unattempted. Attempt 2
    // resolved `research`. Leaving the omission text intact would contradict the
    // instructions now sitting beside it.
    const omission = createContextItemPart({
      producer: 'skill-activation',
      form: 'notice',
      runId: RUN_ID,
      payload: { kind: 'omission', skills: ['research', 'writing'] },
      text: 'omitted research, writing',
    });
    const activation = createContextItemPart({
      producer: 'skill-activation',
      form: 'notice',
      runId: RUN_ID,
      payload: { kind: 'activation', skill: 'research' },
      text: 'activation research',
    });

    const { applied, writes } = await append([omission], [activation]);

    expect(applied).toBe(true);
    const omissions = writes[0].filter(
      (part) =>
        isContextItemPart(part) && part.data.payload['kind'] === 'omission',
    );
    expect(omissions).toHaveLength(1);
    expect(
      omissions.flatMap((part) =>
        isContextItemPart(part) ? [part.data.payload['skills']] : [],
      ),
    ).toEqual([['writing']]);
  });

  it('removes the omission item once every name is resolved', async () => {
    const omission = createContextItemPart({
      producer: 'skill-activation',
      form: 'notice',
      runId: RUN_ID,
      payload: { kind: 'omission', skills: ['research'] },
      text: 'omitted research',
    });
    const activation = createContextItemPart({
      producer: 'skill-activation',
      form: 'notice',
      runId: RUN_ID,
      payload: { kind: 'activation', skill: 'research' },
      text: 'activation research',
    });

    const { writes } = await append([omission], [activation]);

    expect(
      writes[0].filter(
        (part) =>
          isContextItemPart(part) && part.data.payload['kind'] === 'omission',
      ),
    ).toEqual([]);
  });

  it('does nothing when there is nothing to insert, without reading the row', () => {
    // The row lock is the expensive part of this write, and an empty batch has
    // no reason to take it. Asserting only the outcome would pass either way:
    // reaching the read and finding nothing fresh returns the same result.
    return append([item('temporal', RUN_ID)], []).then(
      ({ applied, writes, reads }) => {
        expect(applied).toBe(false);
        expect(writes).toEqual([]);
        expect(reads).toEqual([]);
      },
    );
  });

  it('applies nothing when the message is gone', async () => {
    const { applied, writes } = await append(
      [],
      [item('skill-activation', RUN_ID)],
      { selected: [] },
    );

    expect(applied).toBe(false);
    expect(writes).toEqual([]);
  });

  it('reports no application when the owner-scoped update matches nothing', async () => {
    // The read saw the row, the write did not: another transaction moved it out
    // of this owner's reach. Reporting `applied` would tell the caller the
    // items are stored when they are not.
    const { applied, writes } = await append(
      [],
      [item('skill-activation', RUN_ID)],
      { updated: [] },
    );

    expect(applied).toBe(false);
    expect(writes).toHaveLength(1);
  });

  it('treats a non-array parts column as empty rather than failing', async () => {
    const { applied, writes } = await append(
      [],
      [item('skill-activation', RUN_ID)],
      { selected: [{ parts: null }] },
    );

    expect(applied).toBe(true);
    expect(producersOf(writes[0] ?? [])).toEqual(['skill-activation']);
  });

  it('identifies an omission item by its name set, whatever the order', async () => {
    const omission = (skills: ReadonlyArray<string>) =>
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId: RUN_ID,
        payload: { kind: 'omission', skills: [...skills] },
        text: `omitted ${skills.join(' ')}`,
      });

    // A retry rebuilds the remainder from a set, so the order it lists is not
    // stable. Keying on the rendered order would insert a second copy of the
    // same notice.
    const same = await append(
      [omission(['beta', 'alpha'])],
      [omission(['alpha', 'beta'])],
    );
    expect(same.applied).toBe(false);

    // A different set is a different fact and must be stored.
    const wider = await append(
      [omission(['alpha'])],
      [omission(['alpha', 'beta'])],
    );
    expect(wider.applied).toBe(true);
  });

  it('identifies an omission item with an unusable name list', async () => {
    const broken = createContextItemPart({
      producer: 'skill-activation',
      form: 'notice',
      runId: RUN_ID,
      payload: { kind: 'omission', skills: 'alpha' },
      text: 'omitted alpha',
    });

    // Stored by an older or newer revision with a different shape: it still
    // has to compare equal to itself, or a retry duplicates it forever.
    const { applied } = await append([broken], [broken]);

    expect(applied).toBe(false);
  });

  it('does not store a second copy of the remainder the rewrite just produced', async () => {
    // The stored notice names `research, writing`. The retry resolves
    // `research` and emits the notice for `writing`. The rewrite turns the
    // stored one into exactly that notice, so inserting the fresh copy too
    // would leave two - and a third on the next attempt.
    const omission = (skills: ReadonlyArray<string>) =>
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId: RUN_ID,
        payload: { kind: 'omission', skills: [...skills] },
        text: `omitted ${skills.join(' ')}`,
      });

    const { applied, writes } = await append(
      [omission(['research', 'writing'])],
      [
        createContextItemPart({
          producer: 'skill-activation',
          form: 'notice',
          runId: RUN_ID,
          payload: { kind: 'activation', skill: 'research' },
          text: 'research loaded',
        }),
        omission(['writing']),
      ],
    );

    expect(applied).toBe(true);
    const omissions = (writes[0] ?? []).filter(
      (part) =>
        isContextItemPart(part) && part.data.payload['kind'] === 'omission',
    );
    expect(omissions).toHaveLength(1);
    expect(
      isContextItemPart(omissions[0])
        ? omissions[0].data.payload['skills']
        : [],
    ).toEqual(['writing']);
  });

  it('lands after an activation item this message already carries', async () => {
    // Equal precedence, not higher: a second batch belongs after the first, so
    // the rail reads in the order the turn produced it.
    const { writes } = await append(
      [item('skill-activation', '22222222-3333-4444-8555-666666666666')],
      [item('skill-activation', RUN_ID)],
    );

    expect(
      writes[0]?.map((part) =>
        isContextItemPart(part) ? part.data.runId : 'text',
      ),
    ).toEqual(['22222222-3333-4444-8555-666666666666', RUN_ID]);
  });

  it('rewrites only this Run\u2019s omission items and leaves the rest untouched', async () => {
    // A stored list is whatever an older or newer revision wrote: a name array
    // or, as here, a bare string.
    const omission = (runId: string, skills: ReadonlyArray<string> | string) =>
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId,
        payload: { kind: 'omission', skills },
        text: 'omitted',
      });
    const otherRun = '22222222-3333-4444-8555-666666666666';
    const stored = [
      { type: 'text', text: 'user words' },
      item('tool-availability', RUN_ID),
      omission(otherRun, ['pdf']),
      omission(RUN_ID, 'pdf'),
      omission(RUN_ID, ['unrelated']),
      item('temporal', RUN_ID),
    ];

    const { writes } = await append(stored, [
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId: RUN_ID,
        payload: { kind: 'activation', skill: 'pdf' },
        text: 'pdf loaded',
      }),
    ]);

    // Every stored part survives: another producer, another Run's omission
    // naming the same skill, an omission whose list is unusable, and an
    // omission none of whose names were resolved.
    const stillStored = new Set<unknown>(stored);
    const remaining = (writes[0] ?? []).filter((part) => stillStored.has(part));
    expect(remaining).toEqual(stored);
  });

  it('does not treat an unattempted selection as resolved', async () => {
    // A fresh omission item records that a name was NOT read. Counting it as
    // resolved would strip that same name from the stale omission beside it.
    const omission = (skills: ReadonlyArray<string>) =>
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId: RUN_ID,
        payload: { kind: 'omission', skills: [...skills] },
        text: `omitted ${skills.join(' ')}`,
      });

    const { writes } = await append(
      [omission(['pdf', 'research'])],
      [omission(['pdf'])],
    );

    const stale = (writes[0] ?? []).find(
      (part) =>
        isContextItemPart(part) &&
        Array.isArray(part.data.payload['skills']) &&
        part.data.payload['skills'].length === 2,
    );
    expect(stale).toBeDefined();
  });
});

describe('ActivationPartsRepository.resolvedSkillsForRun', () => {
  const activation = (skill: string, kind: 'activation' | 'failure') =>
    createContextItemPart({
      producer: 'skill-activation',
      form: 'notice',
      runId: RUN_ID,
      payload: { kind, skill },
      text: `${kind} ${skill}`,
    });

  it('reports the skills a prior attempt resolved, either way', async () => {
    const { db } = fakeDb([
      activation('pdf', 'activation'),
      activation('absent', 'failure'),
      // An omission item names selections that were never read, so it must NOT
      // count as resolved.
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId: RUN_ID,
        payload: { kind: 'omission', skills: ['unread'] },
        text: 'omitted unread',
      }),
    ]);

    const resolved = await new ActivationPartsRepository(
      db,
    ).resolvedSkillsForRun({
      id: MESSAGE_ID,
      chatId: CHAT_ID,
      runId: RUN_ID,
    });

    expect([...resolved].sort()).toEqual(['absent', 'pdf']);
  });

  const resolve = (parts: ReadonlyArray<unknown>, selected?: QueryValue) =>
    new ActivationPartsRepository(
      fakeDb(parts, selected === undefined ? {} : { selected }).db,
    ).resolvedSkillsForRun({
      id: MESSAGE_ID,
      chatId: CHAT_ID,
      runId: RUN_ID,
    });

  it('ignores another Run and another producer', async () => {
    const resolved = await resolve([
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId: '22222222-3333-4444-8555-666666666666',
        payload: { kind: 'activation', skill: 'other-run' },
        text: 'other run',
      }),
      // Another producer carrying the same payload shape: the producer check is
      // what keeps it out, not the absence of a skill name.
      createContextItemPart({
        producer: 'temporal',
        form: 'notice',
        runId: RUN_ID,
        payload: { kind: 'activation', skill: 'not-ours' },
        text: 'temporal body',
      }),
    ]);

    expect(resolved.size).toBe(0);
  });

  it('ignores a kind outside the resolved pair', async () => {
    // A newer revision may store a kind this one does not know. Counting it as
    // resolved would make recovery skip a read that never happened.
    const resolved = await resolve([
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId: RUN_ID,
        payload: { kind: 'deferred', skill: 'ghost' },
        text: 'deferred ghost',
      }),
    ]);

    expect(resolved.size).toBe(0);
  });

  it('reports nothing when the message is gone or its parts are unusable', async () => {
    expect((await resolve([], [])).size).toBe(0);
    expect((await resolve([], [{ parts: null }])).size).toBe(0);
  });
});
