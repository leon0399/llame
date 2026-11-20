/**
 * Unit tests for the Project discovery read model's row aggregation
 * (project-discovery D5/D6).
 *
 * The detail read is one batched join: it projects one row per
 * repository-checkout pair, and a repository with no checkout still
 * contributes its single null-checkout row. These tests prove the step
 * between that result and the renderer's view: the repeated rows of one
 * repository collapse into one entry that carries every checkout row in
 * order, a checkout-free link keeps an empty list instead of disappearing,
 * and every projected field reaches the view unchanged. The datastore double
 * returns the batched rows directly, so the query's SQL and its call wiring
 * are not under test here.
 */

import { drizzle } from 'drizzle-orm/postgres-js';

import { type CheckoutKind } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ProjectDiscoveryRepository } from './project-discovery.repository';

const OWNER = 'owner-1';
const PROJECT_ID = '0f8e2c1a-1b2c-4d3e-8f90-a1b2c3d4e5f6';

const LINKED_ID = '2e4c9b7a-1f3d-4e5b-8a6c-0d1e2f3a4b5c';
const CHECKOUT_FREE_ID = '6b1a0f9e-2d3c-4b5a-9e8f-7a6b5c4d3e2f';

/** One projected row: a repository's view fields and its nullable checkout. */
type BatchedRow = {
  readonly id: string;
  readonly alias: string;
  readonly displayName: string;
  readonly canonicalRemote: string | null;
  readonly isPrimary: boolean;
  readonly checkout: {
    readonly id: string;
    readonly kind: CheckoutKind;
    readonly parentCheckoutId: string | null;
    readonly executorId: string;
    readonly locator: string;
  } | null;
};

const MAIN_CHECKOUT = {
  id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  kind: 'main',
  parentCheckoutId: null,
  executorId: 'host-a',
  locator: '/work/api',
} as const satisfies NonNullable<BatchedRow['checkout']>;

const LOCAL_WORKTREE = {
  id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  kind: 'worktree',
  parentCheckoutId: MAIN_CHECKOUT.id,
  executorId: 'host-a',
  locator: '/work/api-feature',
} as const satisfies NonNullable<BatchedRow['checkout']>;

const REMOTE_WORKTREE = {
  id: 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f',
  kind: 'worktree',
  parentCheckoutId: MAIN_CHECKOUT.id,
  executorId: 'host-b',
  locator: '/srv/api-feature',
} as const satisfies NonNullable<BatchedRow['checkout']>;

/** The linked repository's fields, repeated on every row of the join. */
const LINKED_FIELDS = {
  id: LINKED_ID,
  alias: 'api',
  displayName: 'Acme API',
  canonicalRemote: 'github.com/acme/api',
  isPrimary: true,
} as const;

const CHECKOUT_FREE_FIELDS = {
  id: CHECKOUT_FREE_ID,
  alias: 'web',
  displayName: 'Acme web',
  canonicalRemote: null,
  isPrimary: false,
} as const;

function asDbQuery<T extends object>(query: T): never {
  // SAFETY: the double implements exactly the fluent methods this repository
  // calls, and the terminal is a real Promise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return query as never;
}

/** A select double whose joins end in the batched rows themselves. */
function batchedQuery(rows: ReadonlyArray<BatchedRow>) {
  const terminal = Promise.resolve(rows);
  const chain = () => terminal;

  return Object.assign(terminal, {
    from: chain,
    innerJoin: chain,
    leftJoin: chain,
    where: chain,
  });
}

function makeBatchedDb(rows: ReadonlyArray<BatchedRow>): Db {
  const db: Db = drizzle.mock();
  vi.spyOn(db, 'select').mockImplementation(() =>
    asDbQuery(batchedQuery(rows)),
  );

  return db;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProjectDiscoveryRepository repository grouping', () => {
  it('collapses repeated rows into one view per repository, checkout-free link included', async () => {
    // The same repository appears once per checkout row, in the order the
    // join returns them: a main checkout and two worktrees on different
    // Machines; the second link has no checkout row at all.
    const rows: ReadonlyArray<BatchedRow> = [
      { ...LINKED_FIELDS, checkout: MAIN_CHECKOUT },
      { ...LINKED_FIELDS, checkout: LOCAL_WORKTREE },
      { ...LINKED_FIELDS, checkout: REMOTE_WORKTREE },
      { ...CHECKOUT_FREE_FIELDS, checkout: null },
    ];

    const views = await new ProjectDiscoveryRepository(
      makeBatchedDb(rows),
    ).listForProject(OWNER, PROJECT_ID);

    expect(views).toEqual([
      {
        id: LINKED_ID,
        alias: 'api',
        displayName: 'Acme API',
        canonicalRemote: 'github.com/acme/api',
        isPrimary: true,
        checkouts: [MAIN_CHECKOUT, LOCAL_WORKTREE, REMOTE_WORKTREE],
      },
      {
        id: CHECKOUT_FREE_ID,
        alias: 'web',
        displayName: 'Acme web',
        canonicalRemote: null,
        isPrimary: false,
        checkouts: [],
      },
    ]);
  });
});
