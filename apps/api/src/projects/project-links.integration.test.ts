/**
 * HTTP-boundary tests for the project repository link routes.
 *
 * Runs against real Postgres (integration project) as the non-superuser `app`
 * role, with two registered owners, so every 404, 409, and read is answered by
 * the real RLS-scoped queries.
 *
 * Covers openspec `projects` — "A project links repositories with an alias and
 * a primary link", "An isolation policy selects the default isolation
 * of a chat start", "The owner reads a project's links", "Project repository
 * links are owner-isolated", and "Project repository links are deleted with the
 * project".
 */

import { type IncomingMessage, Server, type ServerResponse } from 'node:http';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres, { type Sql } from 'postgres';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { cookieOf, expectRegisteredUserId } from '../testing/support';

vi.setConfig({ testTimeout: 60_000 });

const projectSchema = z.looseObject({ id: z.guid(), name: z.string() });
const repositorySchema = z.looseObject({
  id: z.guid(),
  displayName: z.string(),
});
const linkSchema = z.looseObject({
  id: z.guid(),
  projectId: z.guid(),
  repositoryId: z.guid(),
  alias: z.string(),
  isPrimary: z.boolean(),
  isolation: z.enum(['inherit', 'always_worktree', 'never']),
});

type HttpServer = Server<typeof IncomingMessage, typeof ServerResponse>;

function isHttpServer(value: unknown): value is HttpServer {
  return value instanceof Server;
}

type Harness = {
  readonly app: INestApplication;
  readonly http: HttpServer;
  readonly cookie: string;
  readonly userId: string;
};

async function boot(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CanonicalSearchCoverageService)
    .useValue({ assertReady: () => Promise.resolve() })
    .overrideProvider(InstanceConfigService)
    .useValue({ config: BUILT_IN_DEFAULTS })
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  const server: unknown = app.getHttpServer();
  if (!isHttpServer(server)) {
    throw new Error('Expected Nest to expose a Node HTTP server');
  }
  const registered = await request(server)
    .post('/auth/v1/register')
    .send({
      email: `project-links-${crypto.randomUUID()}@test.com`,
      password: 'password123',
      name: 'Project links owner',
    });
  const body: unknown = registered.body;
  expectRegisteredUserId(body);
  return {
    app,
    http: server,
    cookie: cookieOf(registered),
    userId: body.user.id,
  };
}

describe('project repository links over HTTP', () => {
  let owner: Harness;
  let other: Harness;
  let sql: Sql;
  let projectId: string;
  let repositoryId: string;
  let checkoutId: string;
  let otherRepositoryId: string;

  const asOwner = <T>(userId: string, fn: (tx: Sql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });

  const linksOf = (harness: Harness, id: string) =>
    request(harness.http)
      .get(`/api/v1/projects/${id}/repositories`)
      .set('Cookie', harness.cookie);

  beforeAll(async () => {
    [owner, other] = await Promise.all([boot(), boot()]);
    sql = postgres(process.env.POSTGRES_URL!, { max: 2 });

    const project = await request(owner.http)
      .post('/api/v1/projects')
      .set('Cookie', owner.cookie)
      .send({ name: 'llame development' })
      .expect(201);
    projectId = projectSchema.parse(project.body).id;

    const repository = await request(owner.http)
      .post('/api/v1/repositories')
      .set('Cookie', owner.cookie)
      .send({ displayName: 'llame-core' })
      .expect(201);
    repositoryId = repositorySchema.parse(repository.body).id;

    const second = await request(owner.http)
      .post('/api/v1/repositories')
      .set('Cookie', owner.cookie)
      .send({ displayName: 'notes' })
      .expect(201);
    otherRepositoryId = repositorySchema.parse(second.body).id;

    checkoutId = crypto.randomUUID();
    await asOwner(
      owner.userId,
      (tx) =>
        tx`INSERT INTO checkouts (id, owner_user_id, repository_id, executor_id, path, kind, branch, origin)
         VALUES (${checkoutId}, ${owner.userId}, ${repositoryId}, 'host', '/srv/llame', 'main', 'master', 'registered')`,
    );
  });

  afterAll(async () => {
    await owner?.app.close();
    await other?.app.close();
    await sql?.end();
  });

  it('links a repository with the display name as its alias', async () => {
    const response = await request(owner.http)
      .post(`/api/v1/projects/${projectId}/repositories`)
      .set('Cookie', owner.cookie)
      .send({ repositoryId })
      .expect(201);

    expect(linkSchema.parse(response.body)).toMatchObject({
      projectId,
      repositoryId,
      alias: 'llame-core',
      isPrimary: false,
      isolation: 'inherit',
    });
  });

  it('reads the link with its alias, flags, and policy', async () => {
    const response = await linksOf(owner, projectId).expect(200);
    const links = z.array(linkSchema).parse(response.body);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      repositoryId,
      alias: 'llame-core',
      isPrimary: false,
      isolation: 'inherit',
    });
  });

  it('changes the alias and the isolation policy', async () => {
    const response = await request(owner.http)
      .patch(`/api/v1/projects/${projectId}/repositories/${repositoryId}`)
      .set('Cookie', owner.cookie)
      .send({ alias: 'core', isolation: 'always_worktree' })
      .expect(200);

    expect(linkSchema.parse(response.body)).toMatchObject({
      alias: 'core',
      isolation: 'always_worktree',
    });

    await request(owner.http)
      .patch(`/api/v1/projects/${projectId}/repositories/${repositoryId}`)
      .set('Cookie', owner.cookie)
      .send({ isolation: 'never' })
      .expect(200);
  });

  it('switches the primary link in one request', async () => {
    await request(owner.http)
      .post(`/api/v1/projects/${projectId}/repositories`)
      .set('Cookie', owner.cookie)
      .send({ repositoryId: otherRepositoryId, isPrimary: true })
      .expect(201);

    const links = z
      .array(linkSchema)
      .parse((await linksOf(owner, projectId).expect(200)).body);
    expect(links.filter((link) => link.isPrimary)).toHaveLength(1);
    expect(links.find((link) => link.isPrimary)?.repositoryId).toBe(
      otherRepositoryId,
    );

    await request(owner.http)
      .patch(`/api/v1/projects/${projectId}/repositories/${repositoryId}`)
      .set('Cookie', owner.cookie)
      .send({ isPrimary: true })
      .expect(200);

    const after = z
      .array(linkSchema)
      .parse((await linksOf(owner, projectId).expect(200)).body);
    expect(after.filter((link) => link.isPrimary)).toHaveLength(1);
    expect(after.find((link) => link.isPrimary)?.repositoryId).toBe(
      repositoryId,
    );
  });

  it('answers 404 for another owner and stores no foreign link', async () => {
    await linksOf(other, projectId).expect(404);

    const otherProject = projectSchema.parse(
      (
        await request(other.http)
          .post('/api/v1/projects')
          .set('Cookie', other.cookie)
          .send({ name: 'Other' })
          .expect(201)
      ).body,
    );
    await request(other.http)
      .post(`/api/v1/projects/${otherProject.id}/repositories`)
      .set('Cookie', other.cookie)
      .send({ repositoryId })
      .expect(404);

    expect(
      z
        .array(linkSchema)
        .parse((await linksOf(other, otherProject.id).expect(200)).body),
    ).toEqual([]);
  });

  it('rejects every link write on an archived project with 409', async () => {
    const archived = projectSchema.parse(
      (
        await request(owner.http)
          .post('/api/v1/projects')
          .set('Cookie', owner.cookie)
          .send({ name: 'Archived' })
          .expect(201)
      ).body,
    );
    await request(owner.http)
      .post(`/api/v1/projects/${archived.id}/repositories`)
      .set('Cookie', owner.cookie)
      .send({ repositoryId, alias: 'frozen' })
      .expect(201);
    await request(owner.http)
      .patch(`/api/v1/projects/${archived.id}`)
      .set('Cookie', owner.cookie)
      .send({ archived: true })
      .expect(200);

    const before = z
      .array(linkSchema)
      .parse((await linksOf(owner, archived.id).expect(200)).body);

    await request(owner.http)
      .post(`/api/v1/projects/${archived.id}/repositories`)
      .set('Cookie', owner.cookie)
      .send({ repositoryId: otherRepositoryId })
      .expect(409);
    await request(owner.http)
      .patch(`/api/v1/projects/${archived.id}/repositories/${repositoryId}`)
      .set('Cookie', owner.cookie)
      .send({ alias: 'changed' })
      .expect(409);
    await request(owner.http)
      .delete(`/api/v1/projects/${archived.id}/repositories/${repositoryId}`)
      .set('Cookie', owner.cookie)
      .expect(409);

    expect(
      z
        .array(linkSchema)
        .parse((await linksOf(owner, archived.id).expect(200)).body),
    ).toEqual(before);
  });

  it('unlinks a repository, removing only the link', async () => {
    await request(owner.http)
      .delete(`/api/v1/projects/${projectId}/repositories/${repositoryId}`)
      .set('Cookie', owner.cookie)
      .expect(204);

    const links = z
      .array(linkSchema)
      .parse((await linksOf(owner, projectId).expect(200)).body);
    expect(links.map((link) => link.repositoryId)).toEqual([otherRepositoryId]);

    const [rows] = await asOwner(
      owner.userId,
      (tx) => tx`SELECT
        (SELECT count(*)::int FROM repositories WHERE id = ${repositoryId}) AS repositories,
        (SELECT count(*)::int FROM checkouts WHERE id = ${checkoutId}) AS checkouts`,
    );
    expect(rows).toEqual({ repositories: 1, checkouts: 1 });
  });

  it('a project deletion removes its links and unfiles its chats', async () => {
    const chatId = crypto.randomUUID();
    await asOwner(
      owner.userId,
      (tx) =>
        tx`INSERT INTO chats (id, owner_user_id, project_id)
         VALUES (${chatId}, ${owner.userId}, ${projectId})`,
    );

    await request(owner.http)
      .delete(`/api/v1/projects/${projectId}`)
      .set('Cookie', owner.cookie)
      .expect(204);

    const [rows] = await asOwner(
      owner.userId,
      (tx) => tx`SELECT
        (SELECT count(*)::int FROM project_repositories WHERE project_id = ${projectId}) AS links,
        (SELECT project_id FROM chats WHERE id = ${chatId}) AS chat_project,
        (SELECT count(*)::int FROM repositories WHERE id IN (${repositoryId}, ${otherRepositoryId})) AS repositories`,
    );
    expect(rows).toEqual({
      links: 0,
      chat_project: null,
      repositories: 2,
    });
  });
});
