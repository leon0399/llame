import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  AcceptedTurnPartsRepository,
  isModelSwitchItem,
  placeAcceptedTurnItems,
} from './accepted-turn-parts.repository';
import {
  createContextItemPart,
  isContextItemPart,
  type AuthoredContextItemPart,
  type ContextItemProducer,
} from './context-item';

const RUN_ID = '11111111-2222-4333-8444-555555555555';
const USER_TEXT = { type: 'text' as const, text: 'hello' };

/** Each part's producer and text, or `text` for a user-authored part. */
function labelsOf(parts: ReadonlyArray<unknown>): Array<string> {
  return parts.map((part) =>
    isContextItemPart(part)
      ? `${part.data.producer}:${part.data.text ?? ''}`
      : 'text',
  );
}

function item(
  producer: ContextItemProducer,
  text: string = producer,
): AuthoredContextItemPart {
  return createContextItemPart({
    producer,
    form: 'notice',
    runId: RUN_ID,
    payload: {},
    text,
  });
}

describe('placeAcceptedTurnItems', () => {
  it('places a first dispatch at producer rank around the facts stored before it', () => {
    const stored = [
      item('skill-activation'),
      item('prompt-imports'),
      USER_TEXT,
    ];

    const placed = placeAcceptedTurnItems(
      stored,
      [
        item('effective-context-change'),
        item('tool-availability'),
        item('workspace'),
        item('instructions'),
        item('recency-digest'),
        item('temporal'),
      ],
      'rank',
    );

    expect(labelsOf(placed)).toEqual([
      'effective-context-change:effective-context-change',
      'tool-availability:tool-availability',
      'workspace:workspace',
      'instructions:instructions',
      'skill-activation:skill-activation',
      'prompt-imports:prompt-imports',
      'recency-digest:recency-digest',
      'temporal:temporal',
      'text',
    ]);
  });

  it('keeps emission order for items of the same producer', () => {
    const placed = placeAcceptedTurnItems(
      [USER_TEXT],
      [item('workspace', 'snapshot'), item('workspace', 'detach')],
      'rank',
    );

    expect(labelsOf(placed)).toEqual([
      'workspace:snapshot',
      'workspace:detach',
      'text',
    ]);
  });

  it('appends a retry after the last stored item and before the user text, in emission order', () => {
    const stored = [
      item('tool-availability', 'first'),
      item('prompt-imports'),
      item('temporal'),
      USER_TEXT,
    ];

    const placed = placeAcceptedTurnItems(
      stored,
      [item('tool-availability', 'second'), item('workspace', 'detach')],
      'append',
    );

    expect(labelsOf(placed)).toEqual([
      'tool-availability:first',
      'prompt-imports:prompt-imports',
      'temporal:temporal',
      'tool-availability:second',
      'workspace:detach',
      'text',
    ]);
  });

  it('stores a repeated item again rather than treating it as already present', () => {
    const repeated = item('tool-availability', 'Unavailable tools: a');
    const placed = placeAcceptedTurnItems(
      [repeated, item('tool-availability', 'Now available: a'), USER_TEXT],
      [repeated],
      'append',
    );

    expect(labelsOf(placed)).toEqual([
      'tool-availability:Unavailable tools: a',
      'tool-availability:Now available: a',
      'tool-availability:Unavailable tools: a',
      'text',
    ]);
  });

  it('leaves the input unchanged', () => {
    const stored = [USER_TEXT];
    placeAcceptedTurnItems(stored, [item('temporal')], 'rank');
    expect(stored).toEqual([USER_TEXT]);
  });
});

/** A stored `effective-context-change` item whose only cause is `model`. */
function switchItem(
  text = 'The active model changed.',
): AuthoredContextItemPart {
  return createContextItemPart({
    producer: 'effective-context-change',
    form: 'notice',
    runId: RUN_ID,
    payload: { cause: 'model' },
    text,
  });
}

describe('isModelSwitchItem', () => {
  it('recognizes the model-switch item', () => {
    expect(isModelSwitchItem(switchItem())).toBe(true);
  });

  it('rejects an item of another producer', () => {
    expect(isModelSwitchItem(item('tool-availability'))).toBe(false);
    // The cause alone does not make a switch item: the producer must be the
    // one that owns that cause.
    expect(
      isModelSwitchItem(
        createContextItemPart({
          producer: 'temporal',
          form: 'snapshot',
          runId: RUN_ID,
          payload: { cause: 'model' },
          text: 'another producer',
        }),
      ),
    ).toBe(false);
  });

  it('rejects an effective-context item with another cause', () => {
    expect(
      isModelSwitchItem(
        createContextItemPart({
          producer: 'effective-context-change',
          form: 'notice',
          runId: RUN_ID,
          payload: { cause: 'tool-availability' },
          text: 'another cause',
        }),
      ),
    ).toBe(false);
  });

  it('rejects a part that is not a context item', () => {
    expect(isModelSwitchItem(USER_TEXT)).toBe(false);
    expect(isModelSwitchItem(null)).toBe(false);
  });
});

/** A Drizzle chain answering `rows`, recording the parts a `set` writes. */
function queryResult(
  rows: ReadonlyArray<unknown>,
  onSet?: (values: { parts: Array<unknown> }) => void,
) {
  const terminal = Promise.resolve(rows);
  const chain = Object.assign(terminal, {
    from: () => chain,
    where: () => chain,
    for: () => chain,
    set: (values: { parts: Array<unknown> }) => {
      onSet?.(values);
      return chain;
    },
    returning: () => terminal,
  });
  return chain;
}

function asQuery(value: ReturnType<typeof queryResult>): never {
  // SAFETY: the repository tests replace Drizzle's fluent terminal with a
  // Promise carrying exactly the chain methods these calls exercise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

/**
 * The dispatch write over a fake driver: the locked row's parts in, the parts
 * it wrote out. `updated` decides whether the row still existed for the write.
 */
function dispatchDb(
  stored: ReadonlyArray<unknown> | undefined,
  options: { updated?: boolean } = {},
) {
  const writes: Array<Array<unknown>> = [];
  const db: Db = drizzle.mock({ schema });
  vi.spyOn(db, 'select').mockImplementation(() =>
    asQuery(queryResult(stored === undefined ? [] : [{ parts: stored }])),
  );
  vi.spyOn(db, 'update').mockImplementation(() =>
    asQuery(
      queryResult(
        options.updated === false ? [] : [{ id: 'message-id' }],
        (values) => {
          writes.push(values.parts);
        },
      ),
    ),
  );
  return { db, writes };
}

describe('storeAtDispatch', () => {
  const input = {
    id: 'message-id',
    chatId: 'chat-id',
    placement: 'append' as const,
  };

  it('reports a vanished row and writes nothing', async () => {
    const { db, writes } = dispatchDb(undefined);

    await expect(
      new AcceptedTurnPartsRepository(db).storeAtDispatch({
        ...input,
        items: [item('temporal')],
        removeModelSwitch: false,
      }),
    ).resolves.toEqual({ applied: false });
    expect(writes).toEqual([]);
  });

  it('writes nothing when it has no item to add and nothing to remove', async () => {
    const { db, writes } = dispatchDb([item('temporal'), USER_TEXT]);

    await expect(
      new AcceptedTurnPartsRepository(db).storeAtDispatch({
        ...input,
        items: [],
        removeModelSwitch: true,
      }),
    ).resolves.toEqual({ applied: true });
    expect(writes).toEqual([]);
  });

  it('writes the placed items when it has one, even with nothing to remove', async () => {
    const { db, writes } = dispatchDb([USER_TEXT]);

    await expect(
      new AcceptedTurnPartsRepository(db).storeAtDispatch({
        ...input,
        items: [item('temporal')],
        removeModelSwitch: true,
      }),
    ).resolves.toEqual({ applied: true });
    expect(labelsOf(writes[0] ?? [])).toEqual(['temporal:temporal', 'text']);
  });

  it('writes the row with the model-switch item dropped when it replaces it', async () => {
    const { db, writes } = dispatchDb([
      item('temporal'),
      switchItem('old switch'),
      USER_TEXT,
    ]);

    await expect(
      new AcceptedTurnPartsRepository(db).storeAtDispatch({
        ...input,
        items: [],
        removeModelSwitch: true,
      }),
    ).resolves.toEqual({ applied: true });
    expect(labelsOf(writes[0] ?? [])).toEqual(['temporal:temporal', 'text']);
  });

  it('keeps the model-switch item when the dispatch does not replace it', async () => {
    const { db, writes } = dispatchDb([
      item('temporal'),
      switchItem('old switch'),
      USER_TEXT,
    ]);

    await new AcceptedTurnPartsRepository(db).storeAtDispatch({
      ...input,
      items: [item('workspace')],
      removeModelSwitch: false,
    });

    expect(labelsOf(writes[0] ?? [])).toEqual([
      'temporal:temporal',
      'effective-context-change:old switch',
      'workspace:workspace',
      'text',
    ]);
  });

  it('reports not applied when the write matched no row', async () => {
    const { db } = dispatchDb([USER_TEXT], { updated: false });

    await expect(
      new AcceptedTurnPartsRepository(db).storeAtDispatch({
        ...input,
        items: [item('temporal')],
        removeModelSwitch: false,
      }),
    ).resolves.toEqual({ applied: false });
  });
});
