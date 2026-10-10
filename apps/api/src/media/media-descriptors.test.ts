import type { ModelMessage } from 'ai';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
import { composeStepMessages } from '../models/step-composer';
import {
  createRunMediaResolver,
  type MediaDescriptor,
} from './media-descriptors';

const ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';
const OTHER = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0f';
const OWNER = 'owner';

/**
 * A real drizzle database over a scripted postgres.js client: each statement
 * answers the next scripted row set (rows as positional values, the shape
 * postgres.js `values()` gives) or rejects with the next scripted error, and
 * every `runAs` is recorded.
 */
function scriptedResolver(
  answers: Array<Array<ReadonlyArray<unknown>> | Error>,
) {
  const db = drizzle.mock({ schema });
  const statements: Array<ReadonlyArray<unknown>> = [];
  Object.assign(db.$client, {
    unsafe(_sql: string, params: ReadonlyArray<unknown>) {
      statements.push(params);
      const answer = answers.shift() ?? [];
      const rows =
        answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(answer);
      return Object.assign(rows, { values: () => rows });
    },
  });
  const owners: Array<string> = [];
  const tenantDb: TenantRunner = {
    runAs: (ownerUserId, work) => {
      owners.push(ownerUserId);
      return work(db);
    },
  };
  return {
    resolver: createRunMediaResolver(tenantDb, OWNER),
    statements,
    owners,
  };
}

const descriptor: MediaDescriptor = {
  id: ID,
  name: 'shot.png',
  mediaType: 'image/png',
  width: 3,
  height: 2,
  modelWidth: 3,
  modelHeight: 2,
  modelByteSize: 90,
  modelMediaType: 'image/png',
};

/** The descriptor select's positional row. */
const descriptorRow = (d: MediaDescriptor): ReadonlyArray<unknown> => [
  d.id,
  d.name,
  d.mediaType,
  d.width,
  d.height,
  d.modelWidth,
  d.modelHeight,
  d.modelByteSize,
  d.modelMediaType,
];

describe('createRunMediaResolver describe', () => {
  it('queries only the canonical ids, once each', async () => {
    const { resolver, statements } = scriptedResolver([
      [descriptorRow(descriptor)],
    ]);

    await expect(resolver.describe([ID, 'abc', ID])).resolves.toEqual(
      new Map([[ID, descriptor]]),
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toEqual([ID, OWNER]);
  });

  it('opens no transaction for non-canonical ids alone', async () => {
    const { resolver, statements, owners } = scriptedResolver([]);

    await expect(resolver.describe(['abc', ID.toUpperCase()])).resolves.toEqual(
      new Map(),
    );
    expect(statements).toHaveLength(0);
    expect(owners).toEqual([OWNER]);
  });

  it('caches hits and misses for the attempt', async () => {
    const { resolver, statements, owners } = scriptedResolver([
      [descriptorRow(descriptor)],
    ]);

    await resolver.describe([ID, OTHER]);
    await expect(resolver.describe([OTHER, ID])).resolves.toEqual(
      new Map([[ID, descriptor]]),
    );
    expect(statements).toHaveLength(1);
    expect(owners).toEqual([OWNER]);
  });

  it('loads only the ids not yet known', async () => {
    const { resolver, statements } = scriptedResolver([
      [descriptorRow(descriptor)],
      [],
    ]);

    await resolver.describe([ID]);
    await expect(resolver.describe([ID, OTHER])).resolves.toEqual(
      new Map([[ID, descriptor]]),
    );
    expect(statements).toEqual([
      [ID, OWNER],
      [OTHER, OWNER],
    ]);
  });

  it('drops a row whose variant format ingest cannot write', async () => {
    const { resolver } = scriptedResolver([
      [[...descriptorRow(descriptor).slice(0, -1), 'image/gif']],
    ]);

    await expect(resolver.describe([ID])).resolves.toEqual(new Map());
  });
});

describe('createRunMediaResolver loadModelBytes', () => {
  it('reads the model variants of canonical ids as the owner in one statement', async () => {
    const bytes = Buffer.from('model-bytes');
    const { resolver, statements, owners } = scriptedResolver([[[ID, bytes]]]);

    await expect(resolver.loadModelBytes([ID, OTHER, ID])).resolves.toEqual(
      new Map([[ID, bytes]]),
    );
    expect(owners).toEqual([OWNER]);
    expect(statements).toEqual([[ID, OTHER, 'model', OWNER]]);
  });

  it('reads each attached blob once across a four-step loop', async () => {
    const other = { ...descriptor, id: OTHER, name: 'plan.png' };
    const { resolver, statements } = scriptedResolver([
      [descriptorRow(descriptor), descriptorRow(other)],
      [
        [ID, Buffer.from('a')],
        [OTHER, Buffer.from('b')],
      ],
    ]);
    const messages: Array<ModelMessage> = [
      {
        role: 'user',
        content: [ID, OTHER].map((id) => ({
          type: 'file',
          data: `media://${id}`,
          mediaType: 'image/png',
        })),
      },
    ];

    for (let step = 0; step < 4; step += 1) {
      const composed = await composeStepMessages(messages, {
        resolver,
        imageInput: true,
      });
      expect(composed[0]?.content).toEqual([
        { type: 'text', text: `Image 1 (media://${ID}):` },
        { type: 'image', image: Buffer.from('a'), mediaType: 'image/png' },
        { type: 'text', text: `Image 2 (media://${OTHER}):` },
        { type: 'image', image: Buffer.from('b'), mediaType: 'image/png' },
      ]);
    }
    // One descriptor read and one byte read for the whole loop.
    expect(statements).toEqual([
      [ID, OTHER, OWNER],
      [ID, OTHER, 'model', OWNER],
    ]);
  });

  it('reads only the ids not yet loaded', async () => {
    const { resolver, statements } = scriptedResolver([
      [[ID, Buffer.from('a')]],
      [[OTHER, Buffer.from('b')]],
    ]);

    await resolver.loadModelBytes([ID]);
    await resolver.loadModelBytes([ID, OTHER]);
    expect(statements).toEqual([
      [ID, 'model', OWNER],
      [OTHER, 'model', OWNER],
    ]);
  });

  it('does not cache a failed read', async () => {
    const bytes = Buffer.from('model-bytes');
    const failure = new Error('connection reset');
    const { resolver, statements } = scriptedResolver([failure, [[ID, bytes]]]);

    await expect(resolver.loadModelBytes([ID])).rejects.toHaveProperty(
      'cause',
      failure,
    );
    await expect(resolver.loadModelBytes([ID])).resolves.toEqual(
      new Map([[ID, bytes]]),
    );
    expect(statements).toHaveLength(2);
  });

  it('resolves a missing row as absent and reads it again next time', async () => {
    const { resolver, statements } = scriptedResolver([[], []]);

    await expect(resolver.loadModelBytes([ID])).resolves.toEqual(new Map());
    await expect(resolver.loadModelBytes([ID])).resolves.toEqual(new Map());
    expect(statements).toHaveLength(2);
  });

  it.each([
    ['upper-case', ID.toUpperCase()],
    ['not a uuid', 'abc'],
  ])('treats a %s id as absent without a transaction', async (_label, id) => {
    const { resolver, owners } = scriptedResolver([[[id, Buffer.from('x')]]]);

    await expect(resolver.loadModelBytes([id])).resolves.toEqual(new Map());
    expect(owners).toEqual([]);
  });
});
