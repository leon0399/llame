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
 */
function fakeDb(parts: ReadonlyArray<unknown>) {
  const writes: Array<Array<unknown>> = [];
  const db: Db = drizzle.mock({ schema });
  vi.spyOn(db, 'select').mockImplementation(() =>
    asQuery(queryResult([{ parts }])),
  );
  vi.spyOn(db, 'update').mockImplementation(() =>
    asQuery(
      queryResult([{ id: MESSAGE_ID }], (update) => {
        writes.push(update.parts);
      }),
    ),
  );
  return { db, writes };
}

const append = (
  parts: ReadonlyArray<unknown>,
  items: Array<AuthoredContextItemPart>,
) => {
  const { db, writes } = fakeDb(parts);
  return new ActivationPartsRepository(db)
    .appendForRun({
      id: MESSAGE_ID,
      chatId: CHAT_ID,
      runId: RUN_ID,
      items,
    })
    .then((result) => ({ ...result, writes }));
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

  it('does nothing when there is nothing to insert', async () => {
    const { applied, writes } = await append([item('temporal', RUN_ID)], []);

    expect(applied).toBe(false);
    expect(writes).toEqual([]);
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

  it('ignores another Run and another producer', async () => {
    const { db } = fakeDb([
      createContextItemPart({
        producer: 'skill-activation',
        form: 'notice',
        runId: '22222222-3333-4444-8555-666666666666',
        payload: { kind: 'activation', skill: 'other-run' },
        text: 'other run',
      }),
      item('temporal', RUN_ID),
    ]);

    const resolved = await new ActivationPartsRepository(
      db,
    ).resolvedSkillsForRun({
      id: MESSAGE_ID,
      chatId: CHAT_ID,
      runId: RUN_ID,
    });

    expect(resolved.size).toBe(0);
  });
});
