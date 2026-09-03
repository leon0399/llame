/**
 * Verifies that canonical line qualification uses PostgreSQL's real search
 * predicates rather than a JavaScript approximation. Requires TEST_DATABASE_URL.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../../db/schema';
import { TenantDbService } from '../../db/tenant-db.service';
import {
  evaluateCanonicalLinePredicates,
  type CanonicalLinePredicateCandidate,
} from './canonical-search-matcher';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;
type SqlClient = ReturnType<typeof postgres>;

describeIfDb('canonical search PostgreSQL line predicates', () => {
  let sqlClient: SqlClient;
  let tenantDb: TenantDbService;

  beforeAll(() => {
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sqlClient = postgres(TEST_DB_URL!, { ssl, max: 2 });
    tenantDb = new TenantDbService(drizzle(sqlClient, { schema }));
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  it('qualifies FTS, trigram typo, and escaped substring candidates in one batch', async () => {
    const candidates: ReadonlyArray<CanonicalLinePredicateCandidate> = [
      { id: 1, normalizedText: 'postgres gin index tuning' },
      { id: 2, normalizedText: 'gin_trgm_ops restores fragments' },
      { id: 3, normalizedText: 'unrelated source' },
    ];

    const fts = await tenantDb.runAs(crypto.randomUUID(), (tx) =>
      evaluateCanonicalLinePredicates(tx, 'postgres gin index', candidates),
    );
    expect(fts).toEqual(new Set([1]));

    const typo = await tenantDb.runAs(crypto.randomUUID(), (tx) =>
      evaluateCanonicalLinePredicates(tx, 'postgre gin idex', candidates),
    );
    expect(typo).toEqual(new Set([1]));

    const substring = await tenantDb.runAs(crypto.randomUUID(), (tx) =>
      evaluateCanonicalLinePredicates(tx, 'trgm', candidates),
    );
    expect(substring).toEqual(new Set([2]));
  });

  it('matches literal percent, underscore, and backslash without treating decoys as wildcards', async () => {
    const candidates: ReadonlyArray<CanonicalLinePredicateCandidate> = [
      { id: 1, normalizedText: 'literal percent %' },
      { id: 2, normalizedText: 'literal underscore _' },
      { id: 3, normalizedText: 'literal backslash \\' },
      { id: 4, normalizedText: 'wildcard decoy x' },
    ];

    const percent = await tenantDb.runAs(crypto.randomUUID(), (tx) =>
      evaluateCanonicalLinePredicates(tx, '%', candidates),
    );
    expect(percent).toEqual(new Set([1]));

    const underscore = await tenantDb.runAs(crypto.randomUUID(), (tx) =>
      evaluateCanonicalLinePredicates(tx, '_', candidates),
    );
    expect(underscore).toEqual(new Set([2]));

    const backslash = await tenantDb.runAs(crypto.randomUUID(), (tx) =>
      evaluateCanonicalLinePredicates(tx, '\\', candidates),
    );
    expect(backslash).toEqual(new Set([3]));
  });
});
