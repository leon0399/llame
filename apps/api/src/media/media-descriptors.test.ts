import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type TenantRunner } from '../db/tenant-db.service';
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
 * postgres.js `values()` gives), and every `runAs` is recorded.
 */
function scriptedResolver(answers: Array<Array<ReadonlyArray<unknown>>>) {
  const db = drizzle.mock({ schema });
  const statements: Array<ReadonlyArray<unknown>> = [];
  Object.assign(db.$client, {
    unsafe(_sql: string, params: ReadonlyArray<unknown>) {
      statements.push(params);
      const rows = Promise.resolve(answers.shift() ?? []);
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
  it('reads the model variant of a canonical id as the owner', async () => {
    const bytes = Buffer.from('model-bytes');
    const { resolver, statements, owners } = scriptedResolver([[[bytes]]]);

    await expect(resolver.loadModelBytes(ID)).resolves.toBe(bytes);
    expect(owners).toEqual([OWNER]);
    expect(statements).toEqual([[ID, 'model', OWNER]]);
  });

  it('resolves a missing row as undefined', async () => {
    const { resolver } = scriptedResolver([[]]);

    await expect(resolver.loadModelBytes(ID)).resolves.toBeUndefined();
  });

  it.each([
    ['upper-case', ID.toUpperCase()],
    ['not a uuid', 'abc'],
  ])('treats a %s id as absent without a transaction', async (_label, id) => {
    const { resolver, owners } = scriptedResolver([[[Buffer.from('x')]]]);

    await expect(resolver.loadModelBytes(id)).resolves.toBeUndefined();
    expect(owners).toEqual([]);
  });
});
