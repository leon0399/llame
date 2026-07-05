/**
 * Policy engine RLS + tool-gate integration tests (#45) — same harness
 * contract as the other *.integration suites: TEST_DATABASE_URL,
 * non-superuser owner role, FORCE.
 *
 * Covered:
 * - RLS ENABLED + FORCED on policies / policy_decisions
 * - org_unit scope: ancestor-governance read — a member of a CHILD unit can
 *   read a policy set on an ANCESTOR unit's scope (regression test for the
 *   fail-open this suite caught before shipping: the original
 *   `policies_select` read arm only matched a membership on the scope unit
 *   itself or one of ITS ancestors, so a policy set at an org's root was
 *   invisible to members of its child teams — governance silently failed to
 *   bind descendants; fixed the same way as `configs_select` (#46), by also
 *   matching when the policy's scope unit appears in the CALLER's own unit
 *   path)
 * - the STUB TOOL GATE (acceptance): PolicyService.check() drives a
 *   simulated sandbox.execute gate — default deny, org-path allow with
 *   approval, org deny overriding a user's own allow
 * - decisions are logged with matched policy versions; version bumps on
 *   policy update are reflected in subsequent decisions
 * - cross-tenant invisibility of policies and decisions
 * - a stranger cannot write org-scope policies
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { IdentityService } from '../identity/identity.service';
import { PoliciesRepository } from './policies-repository';
import { PolicyService } from './policy.service';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

type SqlClient = any;

describeIfDb('Policy engine integration — deny-overrides under FORCE', () => {
  let sql: SqlClient;
  let db: Db;
  let tenantDb: TenantDbService;
  let identity: IdentityService;
  let policyService: PolicyService;
  let ownerId: string; // org owner
  let memberId: string; // team member — the tool-gate actor
  let strangerId: string;
  let orgId: string;
  let teamId: string;

  const asUser = (userId: string, fn: (tx: SqlClient) => Promise<any>) =>
    sql.begin(async (tx: SqlClient) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const postgres = require('postgres');
    const connect = postgres.default ?? postgres;
    const ssl = /sslmode=require/.test(TEST_DB_URL!) ? 'require' : false;
    sql = connect(TEST_DB_URL!, { ssl, max: 2 });
    db = drizzle(sql, { schema });
    tenantDb = new TenantDbService(db);
    identity = new IdentityService(tenantDb);
    policyService = new PolicyService(tenantDb);

    ownerId = crypto.randomUUID();
    memberId = crypto.randomUUID();
    strangerId = crypto.randomUUID();
    for (const id of [ownerId, memberId, strangerId]) {
      await sql`INSERT INTO users (id, name, email) VALUES (${id}, 'Pol', ${`pol-${id}@test.com`})`;
    }
    const org = await identity.createRootOrg({
      userId: ownerId,
      name: 'PolOrg',
    });
    orgId = org.id;
    const team = await identity.createChildOrg({
      userId: ownerId,
      parentId: orgId,
      name: 'PolTeam',
      type: 'team',
    });
    teamId = team.id;
    await identity.grantMembership({
      callerId: ownerId,
      userId: memberId,
      orgUnitId: teamId,
      role: 'member',
    });
  });

  afterAll(async () => {
    if (sql) {
      await asUser(ownerId, async (tx) => {
        await tx`DELETE FROM policies WHERE scope_type = 'org_unit'`;
        await tx`DELETE FROM org_units WHERE id = ${teamId}`;
        await tx`DELETE FROM org_units WHERE id = ${orgId}`;
      });
      await sql`DELETE FROM users WHERE id IN (${ownerId}, ${memberId}, ${strangerId})`;
      await sql.end();
    }
  });

  it('RLS is ENABLED + FORCED on policies and policy_decisions', async () => {
    const rows = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class WHERE relname IN ('policies', 'policy_decisions')
      ORDER BY relname`;
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true);
      expect(r.relforcerowsecurity).toBe(true);
    }
  });

  it('org_unit scope: ancestor-governance — a child-unit member reads a policy set on the parent', async () => {
    const rootPolicy = await tenantDb.runAs(ownerId, (tx) =>
      new PoliciesRepository(tx).create({
        scopeType: 'org_unit',
        scopeId: orgId,
        effect: 'deny',
        action: 'connector.invoke',
      }),
    );

    // The bug: a member of the CHILD unit (teamId) had no membership row on
    // `orgId` itself or any of ITS ancestors, so the old read arm (which only
    // walked the POLICY scope unit's own path) denied this — an org-root
    // policy silently failed to bind a team member.
    const childMemberRead = await asUser(
      memberId,
      (tx) =>
        tx`SELECT id, effect FROM policies WHERE scope_type = 'org_unit' AND scope_id = ${orgId} AND action = 'connector.invoke'`,
    );
    expect(childMemberRead.length).toBe(1);
    expect(childMemberRead[0]).toMatchObject({
      id: rootPolicy.id,
      effect: 'deny',
    });

    // Cross-tenant control: an unrelated stranger still sees nothing.
    const strangerRead = await asUser(
      strangerId,
      (tx) =>
        tx`SELECT id FROM policies WHERE scope_type = 'org_unit' AND scope_id = ${orgId} AND action = 'connector.invoke'`,
    );
    expect(strangerRead.length).toBe(0);

    // And a child-unit member still cannot WRITE the ancestor's policy.
    await asUser(
      memberId,
      (tx) =>
        tx`UPDATE policies SET effect = 'allow' WHERE id = ${rootPolicy.id}`,
    );
    const after = await asUser(
      ownerId,
      (tx) => tx`SELECT effect FROM policies WHERE id = ${rootPolicy.id}`,
    );
    expect(after[0].effect).toBe('deny');
  });

  it('stub tool gate: default deny with no policies, decision logged', async () => {
    const decision = await policyService.check({
      userId: memberId,
      action: 'sandbox.execute',
      orgUnitId: teamId,
    });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toContain('default deny');

    const logged = await asUser(
      memberId,
      (tx) =>
        tx`SELECT effect, action FROM policy_decisions WHERE user_id = ${memberId} ORDER BY created_at DESC LIMIT 1`,
    );
    expect(logged[0]).toMatchObject({
      effect: 'deny',
      action: 'sandbox.execute',
    });
  });

  let orgAllowId: string;

  it('an org-root allow (with approval) grants a member acting in the team scope', async () => {
    const created = await tenantDb.runAs(ownerId, (tx) =>
      new PoliciesRepository(tx).create({
        scopeType: 'org_unit',
        scopeId: orgId,
        effect: 'allow',
        action: 'sandbox.*',
        approval: 'ask_once_per_run',
      }),
    );
    orgAllowId = created.id;

    const decision = await policyService.check({
      userId: memberId,
      action: 'sandbox.execute',
      orgUnitId: teamId,
    });
    expect(decision.effect).toBe('allow');
    expect(decision.approval).toBe('ask_once_per_run');
    expect(decision.matched).toEqual([
      expect.objectContaining({ policyId: orgAllowId, version: 1 }),
    ]);
  });

  it("an org deny overrides the member's own user-scope allow", async () => {
    // The member self-allows at their own scope (legal: RLS user arm).
    await tenantDb.runAs(memberId, (tx) =>
      new PoliciesRepository(tx).create({
        scopeType: 'user',
        scopeId: memberId,
        effect: 'allow',
        action: 'sandbox.execute',
      }),
    );
    // The org owner denies it org-wide.
    await tenantDb.runAs(ownerId, (tx) =>
      new PoliciesRepository(tx).create({
        scopeType: 'org_unit',
        scopeId: orgId,
        effect: 'deny',
        action: 'sandbox.execute',
      }),
    );

    const decision = await policyService.check({
      userId: memberId,
      action: 'sandbox.execute',
      orgUnitId: teamId,
    });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toContain('deny overrides allow');
    // All three rules matched and are in the audit trail.
    expect(decision.matched).toHaveLength(3);

    // Outside the org scope the user allow still stands (no org chain).
    const outside = await policyService.check({
      userId: memberId,
      action: 'sandbox.execute',
    });
    expect(outside.effect).toBe('allow');
  });

  it('policy updates bump the version, and decisions record it', async () => {
    await tenantDb.runAs(ownerId, (tx) =>
      new PoliciesRepository(tx).update(orgAllowId, {
        approval: 'always_ask',
      }),
    );
    const decision = await policyService.check({
      userId: memberId,
      action: 'sandbox.read',
      orgUnitId: teamId,
    });
    expect(decision.effect).toBe('allow');
    expect(decision.approval).toBe('always_ask');
    expect(decision.matched).toEqual([
      expect.objectContaining({ policyId: orgAllowId, version: 2 }),
    ]);
  });

  it('cross-tenant: a stranger sees no policies or decisions, cannot write org policies', async () => {
    const visible = await asUser(
      strangerId,
      (tx) => tx`SELECT id FROM policies`,
    );
    expect(visible.length).toBe(0);

    const decisions = await asUser(
      strangerId,
      (tx) => tx`SELECT id FROM policy_decisions`,
    );
    expect(decisions.length).toBe(0);

    await expect(
      asUser(
        strangerId,
        (tx) =>
          tx`INSERT INTO policies (scope_type, scope_id, effect, action) VALUES ('org_unit', ${orgId}, 'allow', '*')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a plain member cannot write org-scope policies (admin write arm)', async () => {
    await expect(
      asUser(
        memberId,
        (tx) =>
          tx`INSERT INTO policies (scope_type, scope_id, effect, action) VALUES ('org_unit', ${teamId}, 'allow', '*')`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
