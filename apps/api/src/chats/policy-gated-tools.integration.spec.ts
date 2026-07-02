/**
 * Policy-gated tool availability integration test (principle #3, #45).
 *
 * Proves the tool pre-filter against the REAL policy engine + DB: a seeded
 * deny revokes a safe tool, an allow grants a non-safe tool, and an allow that
 * demands human approval stays excluded (no approval flow). Exercises the exact
 * chain run-execution uses: PolicyService.check → toolVerdict → resolveAvailableTools.
 *
 * TEST_DATABASE_URL-gated; run by scripts/rls-test.sh.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { PoliciesRepository } from '../policies/policies-repository';
import { PolicyService } from '../policies/policy.service';
import { getCurrentTimeTool } from './tools/get-current-time';
import { BUILTIN_TOOLS, resolveAvailableTools } from './tools/registry';
import { type BuiltinTool } from './tools/types';
import { toolVerdict } from '../runs/run-execution.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

// A tool NOT in the safe allowlist — only a policy allow can admit it.
const riskyTool: BuiltinTool = {
  name: 'risky_write_thing',
  description: 'x',
  riskClass: 'write_internal',
  inputSchema: getCurrentTimeTool.inputSchema,
  execute: () => ({ status: 'error', type: 'x', message: 'x' }),
};

describeIfDb('policy-gated tool availability', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let policies: PolicyService;
  let userId: string;

  const decideFor = (uid: string) => async (tool: BuiltinTool) => {
    const decision = await policies.check({
      userId: uid,
      action: 'tool.invoke',
      resourceType: 'tool',
      resourceId: tool.name,
    });
    return toolVerdict(decision);
  };

  // resolveAvailableTools wants a SYNC decide; pre-resolve verdicts first.
  async function resolve(
    uid: string,
    candidates: readonly BuiltinTool[],
  ): Promise<string[]> {
    const decide = decideFor(uid);
    const verdicts = new Map(
      await Promise.all(
        candidates.map(async (t) => [t.name, await decide(t)] as const),
      ),
    );
    return resolveAvailableTools(candidates, (t) => verdicts.get(t.name)!).map(
      (t) => t.name,
    );
  }

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    policies = new PolicyService(tenantDb);
    userId = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'P', ${`p-${userId}@t.com`})`;
  });

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      await sql.end();
    }
  });

  it('no policy → the safe allowlist (default behavior preserved)', async () => {
    const names = await resolve(userId, BUILTIN_TOOLS);
    // read-only tools are default-available; the writes (remember, write_todos)
    // are NOT.
    expect(names.sort()).toEqual([
      'get_current_time',
      'list_todos',
      'recall',
      'search_conversations',
    ]);
    expect(await resolve(userId, [riskyTool])).toEqual([]);
  });

  it('a user-scope DENY revokes a safe tool (deny overrides the allowlist)', async () => {
    const denier = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${denier}, 'D', ${`d-${denier}@t.com`})`;
    await tenantDb.runAs(denier, (tx) =>
      new PoliciesRepository(tx).create({
        scopeType: 'user',
        scopeId: denier,
        effect: 'deny',
        action: 'tool.invoke',
        resourceType: 'tool',
        resourceId: 'get_current_time',
      }),
    );

    const names = await resolve(denier, BUILTIN_TOOLS);
    expect(names).not.toContain('get_current_time'); // revoked
    expect(names).toContain('search_conversations'); // untouched

    await sql`DELETE FROM users WHERE id = ${denier}`;
  });

  it('a user-scope ALLOW admits a non-safe tool; approval-demanding allow stays excluded', async () => {
    const granter = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${granter}, 'G', ${`g-${granter}@t.com`})`;

    // auto_allow_low_risk = allow WITHOUT asking → admitted.
    const created = await tenantDb.runAs(granter, (tx) =>
      new PoliciesRepository(tx).create({
        scopeType: 'user',
        scopeId: granter,
        effect: 'allow',
        action: 'tool.invoke',
        resourceType: 'tool',
        resourceId: 'risky_write_thing',
        approval: 'auto_allow_low_risk',
      }),
    );
    expect(await resolve(granter, [riskyTool])).toEqual(['risky_write_thing']);

    // Now switch it to always_ask (demands approval) → excluded, no flow yet.
    await tenantDb.runAs(granter, (tx) =>
      new PoliciesRepository(tx).update(created.id, { approval: 'always_ask' }),
    );
    expect(await resolve(granter, [riskyTool])).toEqual([]);

    await sql`DELETE FROM users WHERE id = ${granter}`;
  });

  it('the real `remember` write tool is default-deny, enabled only by a policy allow', async () => {
    const u = crypto.randomUUID();
    await sql`INSERT INTO users (id, name, email) VALUES (${u}, 'R', ${`r-${u}@t.com`})`;

    // Default (no policy): remember is NOT available; recall (read-only) IS.
    const before = await resolve(u, BUILTIN_TOOLS);
    expect(before).not.toContain('remember');
    expect(before).toContain('recall');

    // An explicit allow grants the write capability (the Tier-B seam).
    await tenantDb.runAs(u, (tx) =>
      new PoliciesRepository(tx).create({
        scopeType: 'user',
        scopeId: u,
        effect: 'allow',
        action: 'tool.invoke',
        resourceType: 'tool',
        resourceId: 'remember',
        approval: 'auto_allow_low_risk',
      }),
    );
    expect(await resolve(u, BUILTIN_TOOLS)).toContain('remember');

    await sql`DELETE FROM users WHERE id = ${u}`;
  });
});
