import { type UnknownRecord } from '@workspace/runtime-safety';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ActivationPartsRepository } from './activation-parts.repository';
import {
  createContextItemPart,
  isContextItemPart,
  type AuthoredContextItemPart,
} from './context-item';

const RUN_ID = '11111111-2222-4333-8444-555555555555';
const CHAT_ID = 'chat-1';
const MESSAGE_ID = 'message-1';

type PartsUpdate = { readonly parts: Array<unknown> };

/** A Drizzle-shaped chain whose terminal resolves to the queued rows. */
function queryResult(
  rows: ReadonlyArray<unknown>,
  onSet?: (value: PartsUpdate) => void,
) {
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

function asQuery(value: Promise<ReadonlyArray<unknown>>): never {
  // SAFETY: the repository tests replace Drizzle's fluent terminal with a
  // Promise carrying exactly the chain methods these calls exercise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

/** Append `items` to a message holding `parts`, returning what was written. */
async function append(
  parts: ReadonlyArray<unknown>,
  items: Array<AuthoredContextItemPart>,
) {
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
  const result = await new ActivationPartsRepository(db).appendForRun({
    id: MESSAGE_ID,
    chatId: CHAT_ID,
    runId: RUN_ID,
    items,
  });
  return { ...result, writes };
}

const omission = (payload: UnknownRecord) =>
  createContextItemPart({
    producer: 'skill-activation',
    form: 'notice',
    runId: RUN_ID,
    payload: { kind: 'omission', ...payload },
    text: 'omitted',
  });

const activationOf = (skill: string) =>
  createContextItemPart({
    producer: 'skill-activation',
    form: 'notice',
    runId: RUN_ID,
    payload: { kind: 'activation', skill },
    text: `activation ${skill}`,
  });

function omissionPayloads(parts: ReadonlyArray<unknown> | undefined) {
  return (parts ?? []).flatMap((part) =>
    isContextItemPart(part) && part.data.payload['kind'] === 'omission'
      ? [part.data.payload]
      : [],
  );
}

describe('omission identity', () => {
  it.each([
    {
      name: 'ignores a non-string skill name',
      stored: { skills: ['alpha', 7] },
      fresh: { skills: ['alpha'] },
    },
    {
      name: 'ignores a non-string imported locator',
      stored: { skills: ['alpha'], imports: ['skill://a/x.md', 7] },
      fresh: { skills: ['alpha'], imports: ['skill://a/x.md'] },
    },
    {
      name: 'reads a non-array skill list as empty',
      stored: { skills: 'alpha' },
      fresh: { skills: [] },
    },
    {
      name: 'reads a non-array import list as empty',
      stored: { skills: ['alpha'], imports: 'skill://a/x.md' },
      fresh: { skills: ['alpha'], imports: [] },
    },
  ])('$name', async ({ stored, fresh }) => {
    const { applied } = await append([omission(stored)], [omission(fresh)]);

    expect(applied).toBe(false);
  });

  it.each([
    {
      name: 'a different count of unlisted skills',
      stored: { skills: ['alpha'], beyond: 3 },
      fresh: { skills: ['alpha'], beyond: 4 },
    },
    {
      name: 'a different count of unlisted imports',
      stored: { skills: ['alpha'], importsBeyond: 2 },
      fresh: { skills: ['alpha'], importsBeyond: 3 },
    },
    {
      name: 'skill names that only differ by where they split',
      stored: { skills: ['a', 'bc'] },
      fresh: { skills: ['ab', 'c'] },
    },
    {
      name: 'imported locators that only differ by where they split',
      stored: { skills: ['alpha'], imports: ['a', 'bc'] },
      fresh: { skills: ['alpha'], imports: ['ab', 'c'] },
    },
  ])('records a retry that omits $name', async ({ stored, fresh }) => {
    const { applied, writes } = await append(
      [omission(stored)],
      [omission(fresh)],
    );

    expect(applied).toBe(true);
    expect(omissionPayloads(writes[0])).toHaveLength(2);
  });
});

describe('omission recovery rewrite', () => {
  it('drops a non-string imported locator when it rebuilds the remainder', async () => {
    const { writes } = await append(
      [
        omission({
          skills: ['research', 'writing'],
          imports: ['skill://research/a.md', 7],
        }),
      ],
      [activationOf('research')],
    );

    expect(omissionPayloads(writes[0])).toEqual([
      {
        kind: 'omission',
        skills: ['writing'],
        imports: ['skill://research/a.md'],
      },
    ]);
  });

  it('keeps a notice alive when only its unlisted imports remain', async () => {
    const { writes } = await append(
      [omission({ skills: ['research'], importsBeyond: 2 })],
      [activationOf('research')],
    );

    expect(omissionPayloads(writes[0])).toEqual([
      { kind: 'omission', skills: [], importsBeyond: 2 },
    ]);
  });

  it('stores nothing in place of an omission once every name is resolved', async () => {
    const activation = activationOf('research');

    const { writes } = await append(
      [omission({ skills: ['research'] })],
      [activation],
    );

    expect(writes[0]).toEqual([activation]);
  });
});
