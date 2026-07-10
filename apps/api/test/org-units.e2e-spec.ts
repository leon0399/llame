/**
 * Org-units + memberships HTTP e2e (#44, org-units change D5) — a real HTTP
 * consumer (supertest) against the bootstrapped NestJS app and a real
 * Postgres, exercising design.md's D5 endpoint table end to end: happy path
 * plus the 403/404/409/422 semantics the org-units/org-memberships spec
 * scenarios require. Complements identity-{rls,admin,invariants}.integration.spec.ts,
 * which drive the service/repository layer directly — this file proves the
 * SAME guarantees hold through the controller (DTOs, ParseUUIDPipe, status
 * codes).
 *
 * Requires POSTGRES_URL to point at a migrated, non-superuser-owned database
 * with `app_rls` provisioned (see apps/api/AGENTS.md) — scripts/rls-test.sh
 * sets this up and runs this file.
 *
 * A SMALL, FIXED pool of users is registered once in `beforeAll` and reused
 * across every test (a fresh org unit per test, never fresh users) —
 * `/auth/v1/register` is throttled per-IP (`AUTH_RATE_LIMIT_PER_MINUTE`,
 * default 10/min, #68) and this suite has no override for it (unlike the
 * Playwright e2e harness). Registering per-test would blow through that
 * ceiling well before the suite finishes.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

import { cookieOf } from './support';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

d('org-units + memberships e2e — real HTTP + Postgres', () => {
  let app: INestApplication;
  let http: import('http').Server;
  const tag = Date.now();

  type TestUser = { id: string; cookie: string };
  // A small reusable pool (see file doc) — each test creates its OWN org
  // unit(s), so reusing the same accounts across tests never bleeds state.
  let a: TestUser, b: TestUser, c: TestUser, e: TestUser, f: TestUser;

  async function registerUser(label: string): Promise<TestUser> {
    const email = `${label}.${tag}@example.com`;
    const res = await request(http)
      .post('/auth/v1/register')
      .send({ email, password: 'password123', name: label });
    expect(res.status).toBe(201);
    return { id: res.body.user.id, cookie: cookieOf(res) };
  }

  async function createRoot(owner: TestUser, name: string) {
    const res = await request(http)
      .post('/api/v1/org-units')
      .set('Cookie', owner.cookie)
      .send({ name });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function createChild(owner: TestUser, parentId: string, name: string) {
    const res = await request(http)
      .post(`/api/v1/org-units/${parentId}/children`)
      .set('Cookie', owner.cookie)
      .send({ name });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function grant(
    caller: TestUser,
    orgUnitId: string,
    userId: string,
    role: string,
  ) {
    return request(http)
      .post(`/api/v1/org-units/${orgUnitId}/memberships`)
      .set('Cookie', caller.cookie)
      .send({ userId, role });
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();

    [a, b, c, e, f] = await Promise.all([
      registerUser('a'),
      registerUser('b'),
      registerUser('c'),
      registerUser('e'),
      registerUser('f'),
    ]);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('create root → creator is owner, sees `/me`, default settings {}', async () => {
    const root = await createRoot(a, 'Acme');
    expect(root.parentId).toBeNull();
    expect(root.path).toBe(root.id);
    expect(root.settings).toEqual({});

    const me = await request(http)
      .get(`/api/v1/org-units/${root.id}/memberships/me`)
      .set('Cookie', a.cookie);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      role: 'owner',
      viaOrgUnitId: root.id,
      inherited: false,
    });
  });

  it('create child materializes the path; GET fetches it', async () => {
    const root = await createRoot(a, 'Acme');
    const team = await createChild(a, root.id, 'Team');
    expect(team.path).toBe(`${root.id}/${team.id}`);

    const fetched = await request(http)
      .get(`/api/v1/org-units/${team.id}`)
      .set('Cookie', a.cookie);
    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(team.id);
  });

  it('GET a malformed id → 400; GET a foreign unit → 404 (visibility, not leaking existence)', async () => {
    const root = await createRoot(a, 'Acme');

    const badId = await request(http)
      .get('/api/v1/org-units/not-a-uuid')
      .set('Cookie', a.cookie);
    expect(badId.status).toBe(400);

    const foreign = await request(http)
      .get(`/api/v1/org-units/${root.id}`)
      .set('Cookie', b.cookie);
    expect(foreign.status).toBe(404);
  });

  it('PATCH rename: owner succeeds, a stranger 404s, a plain member 403s', async () => {
    const root = await createRoot(a, 'Acme');
    await grant(a, root.id, b.id, 'member');

    const byStranger = await request(http)
      .patch(`/api/v1/org-units/${root.id}`)
      .set('Cookie', c.cookie)
      .send({ name: 'Sneaky' });
    expect(byStranger.status).toBe(404);

    const byMember = await request(http)
      .patch(`/api/v1/org-units/${root.id}`)
      .set('Cookie', b.cookie)
      .send({ name: 'Sneaky' });
    expect(byMember.status).toBe(403);

    const byOwner = await request(http)
      .patch(`/api/v1/org-units/${root.id}`)
      .set('Cookie', a.cookie)
      .send({ name: 'Renamed' });
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.name).toBe('Renamed');
    expect(byOwner.body.path).toBe(root.path); // rename never touches paths
  });

  it('PATCH settings round-trips (SPEC: settings persist per node)', async () => {
    const root = await createRoot(a, 'Acme');

    const patched = await request(http)
      .patch(`/api/v1/org-units/${root.id}`)
      .set('Cookie', a.cookie)
      .send({ settings: { theme: 'dark', flags: ['a', 'b'] } });
    expect(patched.status).toBe(200);
    expect(patched.body.settings).toEqual({ theme: 'dark', flags: ['a', 'b'] });

    const refetched = await request(http)
      .get(`/api/v1/org-units/${root.id}`)
      .set('Cookie', a.cookie);
    expect(refetched.body.settings).toEqual({
      theme: 'dark',
      flags: ['a', 'b'],
    });
  });

  it('PATCH move rewrites the path; move-into-own-subtree → 422', async () => {
    const root = await createRoot(a, 'Acme');
    const teamA = await createChild(a, root.id, 'A');
    const teamB = await createChild(a, root.id, 'B');

    const moved = await request(http)
      .patch(`/api/v1/org-units/${teamA.id}`)
      .set('Cookie', a.cookie)
      .send({ parentId: teamB.id });
    expect(moved.status).toBe(200);
    expect(moved.body.parentId).toBe(teamB.id);
    expect(moved.body.path).toBe(`${root.id}/${teamB.id}/${teamA.id}`);

    const intoOwnSubtree = await request(http)
      .patch(`/api/v1/org-units/${root.id}`)
      .set('Cookie', a.cookie)
      .send({ parentId: teamB.id }); // teamB is INSIDE root's subtree
    expect(intoOwnSubtree.status).toBe(422);
  });

  it('PATCH { parentId: null } promotes to root — needs admin-tier ON THE UNIT ITSELF, inherited tier is not enough', async () => {
    const root = await createRoot(a, 'Acme');
    const team = await createChild(a, root.id, 'Team');

    // `a` holds `owner` on root only (inherited admin-tier on `team`). The
    // move's WITH CHECK validates admin-tier on the NEW path — for a
    // promoted unit, that's JUST its own id — so an inherited tier from an
    // ancestor that is about to stop being an ancestor doesn't count; only
    // an explicit membership row on the unit ITSELF does (documented
    // landmine, D5/move-to-root semantics).
    const deniedOnInheritedTierOnly = await request(http)
      .patch(`/api/v1/org-units/${team.id}`)
      .set('Cookie', a.cookie)
      .send({ parentId: null });
    expect(deniedOnInheritedTierOnly.status).toBe(403);

    await grant(a, team.id, a.id, 'admin'); // explicit membership ON team itself
    const promoted = await request(http)
      .patch(`/api/v1/org-units/${team.id}`)
      .set('Cookie', a.cookie)
      .send({ parentId: null });
    expect(promoted.status).toBe(200);
    expect(promoted.body.parentId).toBeNull();
    expect(promoted.body.path).toBe(team.id);
  });

  it('DELETE: a unit with children → 409, leaf-first succeeds → 204, then 404', async () => {
    const root = await createRoot(a, 'Acme');
    const team = await createChild(a, root.id, 'Team');

    const blocked = await request(http)
      .delete(`/api/v1/org-units/${root.id}`)
      .set('Cookie', a.cookie);
    expect(blocked.status).toBe(409);

    const leaf = await request(http)
      .delete(`/api/v1/org-units/${team.id}`)
      .set('Cookie', a.cookie);
    expect(leaf.status).toBe(204);

    const gone = await request(http)
      .get(`/api/v1/org-units/${team.id}`)
      .set('Cookie', a.cookie);
    expect(gone.status).toBe(404);
  });

  it('a non-owner cannot delete (403), even though they can see the unit', async () => {
    const root = await createRoot(a, 'Acme');
    await grant(a, root.id, b.id, 'admin');

    const res = await request(http)
      .delete(`/api/v1/org-units/${root.id}`)
      .set('Cookie', b.cookie);
    expect(res.status).toBe(403);
  });

  it('POST memberships: grant, duplicate → 409, non-admin caller → 403', async () => {
    const root = await createRoot(a, 'Acme');

    const granted = await grant(a, root.id, b.id, 'member');
    expect(granted.status).toBe(204);

    const duplicate = await grant(a, root.id, b.id, 'admin');
    expect(duplicate.status).toBe(409);

    const byNonAdmin = await grant(b, root.id, c.id, 'member');
    expect(byNonAdmin.status).toBe(403);
  });

  it('D3: owner can grant `owner` (co-ownership); an admin cannot', async () => {
    const root = await createRoot(a, 'Acme');
    await grant(a, root.id, b.id, 'admin');

    const adminMintsOwner = await grant(b, root.id, c.id, 'owner');
    expect(adminMintsOwner.status).toBe(403);

    const ownerMintsOwner = await grant(a, root.id, c.id, 'owner');
    expect(ownerMintsOwner.status).toBe(204);
  });

  it('F1: an admin cannot demote or revoke an existing co-owner row, even though another owner remains', async () => {
    const root = await createRoot(a, 'Acme');
    await grant(a, root.id, b.id, 'owner'); // b: co-owner
    await grant(a, root.id, c.id, 'admin'); // c: plain admin, not owner-tier

    const demote = await request(http)
      .patch(`/api/v1/org-units/${root.id}/memberships/${b.id}`)
      .set('Cookie', c.cookie)
      .send({ role: 'member' });
    expect(demote.status).toBe(403);

    const revoke = await request(http)
      .delete(`/api/v1/org-units/${root.id}/memberships/${b.id}`)
      .set('Cookie', c.cookie);
    expect(revoke.status).toBe(403);

    // Sanity: b is still an untouched owner — the 403s above were real denials.
    const stillOwner = await request(http)
      .get(`/api/v1/org-units/${root.id}/memberships/me`)
      .set('Cookie', b.cookie);
    expect(stillOwner.body).toMatchObject({ role: 'owner' });
  });

  it('GrantMembershipDto rejects service_account (no HTTP surface for it yet)', async () => {
    const root = await createRoot(a, 'Acme');
    const res = await grant(a, root.id, b.id, 'service_account');
    expect(res.status).toBe(400);
  });

  it('GET roster: a member sees it, a stranger 404s', async () => {
    const root = await createRoot(a, 'Acme');
    await grant(a, root.id, b.id, 'viewer');

    const seenByMember = await request(http)
      .get(`/api/v1/org-units/${root.id}/memberships`)
      .set('Cookie', b.cookie);
    expect(seenByMember.status).toBe(200);
    const userIds = seenByMember.body.map((m: { userId: string }) => m.userId);
    expect(userIds.sort()).toEqual([a.id, b.id].sort());

    const seenByStranger = await request(http)
      .get(`/api/v1/org-units/${root.id}/memberships`)
      .set('Cookie', c.cookie);
    expect(seenByStranger.status).toBe(404);
  });

  it('PATCH a membership role: admin succeeds, plain member 403s, unknown user 404s', async () => {
    const root = await createRoot(a, 'Acme');
    await grant(a, root.id, b.id, 'member');
    await grant(a, root.id, e.id, 'viewer');

    const notAMember = await request(http)
      .patch(`/api/v1/org-units/${root.id}/memberships/${c.id}`)
      .set('Cookie', a.cookie)
      .send({ role: 'admin' });
    expect(notAMember.status).toBe(404);

    const byPlainMember = await request(http)
      .patch(`/api/v1/org-units/${root.id}/memberships/${b.id}`)
      .set('Cookie', e.cookie)
      .send({ role: 'admin' });
    expect(byPlainMember.status).toBe(403);

    const byOwner = await request(http)
      .patch(`/api/v1/org-units/${root.id}/memberships/${b.id}`)
      .set('Cookie', a.cookie)
      .send({ role: 'admin' });
    expect(byOwner.status).toBe(200);
    expect(byOwner.body).toMatchObject({ userId: b.id, role: 'admin' });
  });

  it('DELETE a membership: self-leave (204), admin revokes another (204), unknown → 404', async () => {
    const root = await createRoot(a, 'Acme');
    await grant(a, root.id, b.id, 'member');
    await grant(a, root.id, c.id, 'member');

    const selfLeave = await request(http)
      .delete(`/api/v1/org-units/${root.id}/memberships/${b.id}`)
      .set('Cookie', b.cookie);
    expect(selfLeave.status).toBe(204);

    const adminRevokes = await request(http)
      .delete(`/api/v1/org-units/${root.id}/memberships/${c.id}`)
      .set('Cookie', a.cookie);
    expect(adminRevokes.status).toBe(204);

    const unknown = await request(http)
      .delete(`/api/v1/org-units/${root.id}/memberships/${c.id}`)
      .set('Cookie', a.cookie);
    expect(unknown.status).toBe(404);
  });

  it('D2: the sole owner of a root cannot leave or be demoted (409) — transfer first, then it works', async () => {
    const root = await createRoot(a, 'Acme');

    const soleLeave = await request(http)
      .delete(`/api/v1/org-units/${root.id}/memberships/${a.id}`)
      .set('Cookie', a.cookie);
    expect(soleLeave.status).toBe(409);

    const soleDemote = await request(http)
      .patch(`/api/v1/org-units/${root.id}/memberships/${a.id}`)
      .set('Cookie', a.cookie)
      .send({ role: 'admin' });
    expect(soleDemote.status).toBe(409);

    // Transfer: mint a co-owner (D3), THEN the original owner can leave.
    const transferred = await grant(a, root.id, b.id, 'owner');
    expect(transferred.status).toBe(204);

    const leaveAfterTransfer = await request(http)
      .delete(`/api/v1/org-units/${root.id}/memberships/${a.id}`)
      .set('Cookie', a.cookie);
    expect(leaveAfterTransfer.status).toBe(204);
  });

  it('GET .../memberships/me: reports nearest-wins + inherited; invisible unit → 404', async () => {
    const root = await createRoot(a, 'Acme');
    const team = await createChild(a, root.id, 'Team');
    await grant(a, team.id, b.id, 'viewer');

    const explicit = await request(http)
      .get(`/api/v1/org-units/${team.id}/memberships/me`)
      .set('Cookie', b.cookie);
    expect(explicit.status).toBe(200);
    expect(explicit.body).toEqual({
      role: 'viewer',
      viaOrgUnitId: team.id,
      inherited: false,
    });

    const inheritedRole = await request(http)
      .get(`/api/v1/org-units/${team.id}/memberships/me`)
      .set('Cookie', a.cookie);
    expect(inheritedRole.body).toEqual({
      role: 'owner',
      viaOrgUnitId: root.id,
      inherited: true,
    });

    const notVisible = await request(http)
      .get(`/api/v1/org-units/${team.id}/memberships/me`)
      .set('Cookie', f.cookie);
    expect(notVisible.status).toBe(404);
  });
});
