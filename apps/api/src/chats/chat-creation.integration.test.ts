/* eslint-disable typescript/no-unsafe-assignment -- a response body and a JSONB `decisions` array are read as `unknown` and narrowed by the zod schemas below. */
/**
 * `POST /api/v1/chats` and `GET /api/v1/chats/:id/creation-record` over real
 * HTTP, real PostgreSQL with FORCE RLS, and real git (openspec
 * `chat-start-location`, the `chat-creation` delta).
 *
 * The suite is the contract's own matrix: a create with and without a location,
 * with and without a worktree, with and without a message; every Workspace
 * status the create can reach here; the 404, 409, and 422 rules; the resend
 * rules; the creation lock against both routes; the defaults write-back; the
 * creation record; and the RLS negatives between two owners.
 *
 * `TEST_DATABASE_URL`/`POSTGRES_URL`-gated — the integration project provides
 * both. Git runs against throwaway clones under the OS temp directory.
 */
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { type IncomingMessage, Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres, { type Sql } from 'postgres';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { ModelsService } from '../models/models.service';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import {
  FakeModelsService,
  cookieOf,
  expectRegisteredUserId,
  openSseStream,
} from '../testing/support';

// A git hook exports GIT_DIR and friends; clear them so the fixtures' own git
// commands cannot be redirected at this checkout.
for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'])
  .toString()
  .split('\n')) {
  if (name !== '') delete process.env[name];
}

vi.setConfig({ testTimeout: 120_000 });

const MODEL_ID = 'system:openai:gpt-5.4-mini';

/** A real directory the policy rejects in `default` mode; set before boot. */
let deniedPath = '';

const workspaceSchema = z.looseObject({
  status: z.enum([
    'bound',
    'unbound',
    'bind_failed',
    'worktree_failed',
    'machine_unavailable',
    'machine_update_required',
    'outcome_unknown',
  ]),
  root: z.string().optional(),
  executorId: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  leftDirectory: z.string().optional(),
  worktree: z
    .looseObject({
      path: z.string(),
      branch: z.string(),
      baseCommit: z.string(),
    })
    .optional(),
});

const createResponseSchema = z.looseObject({
  chat: z.looseObject({ id: z.guid(), projectId: z.guid().nullable() }),
  workspace: workspaceSchema,
});

const creationRecordSchema = z.looseObject({
  chatId: z.guid(),
  attempts: z.array(
    z.looseObject({
      createdAt: z.string(),
      decisions: z.array(
        z.looseObject({
          path: z.string(),
          policyId: z.string(),
          decision: z.enum(['allow', 'reject']),
          reason: z.string(),
        }),
      ),
    }),
  ),
});

const linkWithDefaultsSchema = z.looseObject({
  id: z.guid(),
  repositoryId: z.guid(),
  defaults: z.array(
    z.looseObject({
      executorId: z.string(),
      checkoutId: z.guid(),
      updatedAt: z.string(),
    }),
  ),
});

type HttpServer = Server<typeof IncomingMessage, typeof ServerResponse>;

function isHttpServer(value: unknown): value is HttpServer {
  return value instanceof Server;
}

type Harness = {
  readonly app: INestApplication;
  readonly http: HttpServer;
  readonly models: FakeModelsService;
};

type Owner = { readonly cookie: string; readonly userId: string };

/** One create body; every field is optional so a test can probe its absence. */
type CreateBody = {
  id?: string;
  projectId?: string;
  repositoryId?: string;
  executorId?: string;
  checkoutId?: string;
  worktree?: { name?: string; baseRef?: string };
  message?: {
    id?: string;
    modelId?: string;
    effort?: string;
    permissionMode?: string;
    parts?: Array<{ type: string; text?: string }>;
  };
};

const created: Array<string> = [];

function tempDirectory(prefix = 'chat-creation-'): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  created.push(directory);
  return directory;
}

function runGit(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  });
}

/** One commit-holding clone with its own origin, in a directory of its own. */
function clone(remote = 'git@github.com:leon0399/llame.git'): string {
  const directory = join(tempDirectory('chat-creation-clone-'), 'llame');
  mkdirSync(directory);
  runGit(directory, ['init', '--quiet', '--initial-branch=main', '.']);
  runGit(directory, ['config', 'user.name', 'llame tests']);
  runGit(directory, ['config', 'user.email', 'llame@test.invalid']);
  runGit(directory, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(directory, 'README.md'), 'readme\n');
  runGit(directory, ['add', 'README.md']);
  runGit(directory, ['commit', '--quiet', '--message', 'first']);
  runGit(directory, ['remote', 'add', 'origin', remote]);
  return realpathSync(directory);
}

function headOf(directory: string): string {
  return runGit(directory, ['rev-parse', 'HEAD']).trim();
}

function configFor(): LlameConfig {
  return {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      allowed: ['enter_workspace'],
      nativeExecutorId: 'creation-host',
      permissionModes: ['default', 'bypass'],
      permissions: {
        enter_workspace: {
          allow: true,
          // One checkout is refused in `default` mode and admitted in `bypass`,
          // so both the rejection and the mode's reach are HTTP-provable.
          reject: [{ field: 'path', literal: deniedPath }],
        },
      },
    },
    machines: {
      ssh: { knownHostsFile: '/dev/null' },
      hosts: { nas: { destination: 'nas.example' } },
    },
  };
}

/**
 * Boots the API. `workers: false` registers no queue consumer: a pool sized
 * for HTTP alone must not also carry the search sweep and the Run worker,
 * which the operator sizing rule forbids (`scaling.md`).
 */
async function boot(
  config: LlameConfig = configFor(),
  { workers = true } = {},
): Promise<Harness> {
  const models = new FakeModelsService();
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CanonicalSearchCoverageService)
    .useValue({ assertReady: () => Promise.resolve() })
    .overrideProvider(InstanceConfigService)
    .useValue({ config })
    .overrideProvider(ModelsService)
    .useValue(models);
  const moduleRef = await (
    workers
      ? builder
      : builder
          .overrideProvider(WorkerProfileService)
          .useValue({ concurrencyFor: () => null })
  ).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  const server: unknown = app.getHttpServer();
  if (!isHttpServer(server)) {
    throw new Error('Expected Nest to expose a Node HTTP server');
  }
  return { app, http: server, models };
}

describe('chat creation over HTTP', () => {
  let harness: Harness;
  let sql: Sql;
  let owner: Owner;
  let other: Owner;

  let projectId = '';
  let otherProjectId = '';
  let archivedProjectId = '';
  let repositoryId = '';
  let secondRepositoryId = '';
  let deniedRepositoryId = '';
  let unlinkedRepositoryId = '';
  let mainCheckoutId = '';
  let secondCheckoutId = '';
  let deniedCheckoutId = '';
  let worktreeCheckoutId = '';
  let machineCheckoutId = '';
  let source = '';
  let secondSource = '';

  const asOwner = <T>(
    userId: string,
    fn: (tx: Sql) => Promise<T>,
  ): Promise<T> =>
    // SAFETY: postgres.js types `begin` as `Promise<any>`; the callback's own
    // result is `T`.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    }) as Promise<T>;

  async function register(label: string): Promise<Owner> {
    const registered = await request(harness.http)
      .post('/auth/v1/register')
      .send({
        email: `chat-creation-${label}-${crypto.randomUUID()}@test.com`,
        password: 'password123',
        name: `Chat creation ${label}`,
      })
      .expect(201);
    const body: unknown = registered.body;
    expectRegisteredUserId(body);
    return { cookie: cookieOf(registered), userId: body.user.id };
  }

  const create = (body: CreateBody, as: Owner = owner) =>
    request(harness.http)
      .post('/api/v1/chats')
      .set('Cookie', as.cookie)
      .send(body);

  const chatOf = (chatId: string, as: Owner = owner) =>
    request(harness.http)
      .get(`/api/v1/chats/${chatId}`)
      .set('Cookie', as.cookie);

  const recordOf = (chatId: string, as: Owner = owner) =>
    request(harness.http)
      .get(`/api/v1/chats/${chatId}/creation-record`)
      .set('Cookie', as.cookie);

  const messagesOf = (chatId: string) =>
    request(harness.http)
      .get(`/api/v1/chats/${chatId}/messages`)
      .set('Cookie', owner.cookie);

  async function seedCheckout(input: {
    readonly repositoryId: string;
    readonly executorId?: string;
    readonly path: string;
    readonly kind?: 'main' | 'worktree';
    readonly parentCheckoutId?: string | null;
  }): Promise<string> {
    const id = crypto.randomUUID();
    await asOwner(
      owner.userId,
      (tx) =>
        tx`INSERT INTO checkouts (id, owner_user_id, repository_id, executor_id, path, kind, parent_checkout_id, branch, origin)
           VALUES (${id}, ${owner.userId}, ${input.repositoryId}, ${input.executorId ?? 'creation-host'}, ${input.path}, ${input.kind ?? 'main'}, ${input.parentCheckoutId ?? null}, 'main', 'registered')`,
    );
    return id;
  }

  async function countRows(
    table:
      | 'messages'
      | 'runs'
      | 'worktree_leases'
      | 'project_repository_defaults',
    where: { readonly chatId?: string } = {},
  ): Promise<number> {
    const rows = await asOwner(owner.userId, (tx) =>
      where.chatId === undefined
        ? tx<
            Array<{ count: number }>
          >`SELECT count(*)::int AS count FROM ${tx(table)}`
        : tx<
            Array<{ count: number }>
          >`SELECT count(*)::int AS count FROM ${tx(table)} WHERE chat_id = ${where.chatId}`,
    );
    return rows[0]?.count ?? -1;
  }

  async function chatRow(chatId: string) {
    const [row] = await asOwner(
      owner.userId,
      (tx) =>
        tx<
          Array<{ workspace_root: string | null; project_id: string | null }>
        >`SELECT project_id, workspace_root, workspace_executor_id, workspace_generation, archived_at
           FROM chats WHERE id = ${chatId}`,
    );
    return row;
  }

  async function defaultsOf(project: string, repository: string) {
    const links = z
      .array(linkWithDefaultsSchema)
      .parse(
        (
          await request(harness.http)
            .get(`/api/v1/projects/${project}/repositories`)
            .set('Cookie', owner.cookie)
            .expect(200)
        ).body,
      );
    return (
      links.find((link) => link.repositoryId === repository)?.defaults ?? []
    );
  }

  /** A client chat id, so each test's rows are its own. */
  const newChatId = () => crypto.randomUUID();

  beforeAll(async () => {
    source = clone();
    secondSource = clone('git@github.com:leon0399/notes.git');
    deniedPath = realpathSync(tempDirectory('chat-creation-denied-'));
    harness = await boot();
    sql = postgres(process.env.POSTGRES_URL!, { max: 2 });
    owner = await register('owner');
    other = await register('other');

    const project = await request(harness.http)
      .post('/api/v1/projects')
      .set('Cookie', owner.cookie)
      .send({ name: 'llame development' })
      .expect(201);
    projectId = z.looseObject({ id: z.guid() }).parse(project.body).id;

    const second = await request(harness.http)
      .post('/api/v1/projects')
      .set('Cookie', owner.cookie)
      .send({ name: 'another project' })
      .expect(201);
    otherProjectId = z.looseObject({ id: z.guid() }).parse(second.body).id;

    const archived = await request(harness.http)
      .post('/api/v1/projects')
      .set('Cookie', owner.cookie)
      .send({ name: 'archived project' })
      .expect(201);
    archivedProjectId = z.looseObject({ id: z.guid() }).parse(archived.body).id;
    await request(harness.http)
      .patch(`/api/v1/projects/${archivedProjectId}`)
      .set('Cookie', owner.cookie)
      .send({ archived: true })
      .expect(200);

    const repository = await request(harness.http)
      .post('/api/v1/repositories')
      .set('Cookie', owner.cookie)
      .send({
        displayName: 'llame',
        remote: 'git@github.com:leon0399/llame.git',
      })
      .expect(201);
    repositoryId = z.looseObject({ id: z.guid() }).parse(repository.body).id;

    const secondRepository = await request(harness.http)
      .post('/api/v1/repositories')
      .set('Cookie', owner.cookie)
      .send({
        displayName: 'notes',
        remote: 'git@github.com:leon0399/notes.git',
      })
      .expect(201);
    secondRepositoryId = z
      .looseObject({ id: z.guid() })
      .parse(secondRepository.body).id;

    const denied = await request(harness.http)
      .post('/api/v1/repositories')
      .set('Cookie', owner.cookie)
      .send({ displayName: 'denied' })
      .expect(201);
    deniedRepositoryId = z.looseObject({ id: z.guid() }).parse(denied.body).id;

    const unlinked = await request(harness.http)
      .post('/api/v1/repositories')
      .set('Cookie', owner.cookie)
      .send({ displayName: 'unlinked' })
      .expect(201);
    unlinkedRepositoryId = z
      .looseObject({ id: z.guid() })
      .parse(unlinked.body).id;

    await request(harness.http)
      .post(`/api/v1/projects/${projectId}/repositories`)
      .set('Cookie', owner.cookie)
      .send({ repositoryId, isPrimary: true })
      .expect(201);
    // A second, non-primary link: naming it overrides the primary, and its own
    // single main checkout keeps the primary link's resolution unambiguous.
    await request(harness.http)
      .post(`/api/v1/projects/${projectId}/repositories`)
      .set('Cookie', owner.cookie)
      .send({ repositoryId: secondRepositoryId })
      .expect(201);
    // The refused path lives in its own linked repository, so the primary
    // link keeps exactly one main checkout and resolves without an explicit id.
    await request(harness.http)
      .post(`/api/v1/projects/${projectId}/repositories`)
      .set('Cookie', owner.cookie)
      .send({ repositoryId: deniedRepositoryId })
      .expect(201);

    const main = await request(harness.http)
      .post('/api/v1/checkouts')
      .set('Cookie', owner.cookie)
      .send({ path: source, repositoryId })
      .expect(201);
    mainCheckoutId = z.looseObject({ id: z.guid() }).parse(main.body).id;

    const secondMain = await request(harness.http)
      .post('/api/v1/checkouts')
      .set('Cookie', owner.cookie)
      .send({ path: secondSource, repositoryId: secondRepositoryId })
      .expect(201);
    secondCheckoutId = z
      .looseObject({ id: z.guid() })
      .parse(secondMain.body).id;

    deniedCheckoutId = await seedCheckout({
      repositoryId: deniedRepositoryId,
      path: deniedPath,
    });
    worktreeCheckoutId = await seedCheckout({
      repositoryId,
      path: join(source, '..', '.llame-worktrees', 'llame', 'seeded'),
      kind: 'worktree',
      parentCheckoutId: mainCheckoutId,
    });
    machineCheckoutId = await seedCheckout({
      repositoryId,
      executorId: 'machine:nas',
      path: 'machine://nas/srv/nas-llame',
    });
  });

  afterEach(() => {
    harness.models.client.delayMs = 0;
  });

  afterAll(async () => {
    // Owner-scoped cleanup: chats cascade their messages, Runs, records, and
    // leases; the catalog rows go explicitly.
    for (const userId of [owner.userId, other.userId]) {
      await asOwner(userId, async (tx) => {
        await tx`DELETE FROM chats WHERE owner_user_id = ${userId}`;
        await tx`DELETE FROM projects WHERE owner_user_id = ${userId}`;
        await tx`DELETE FROM repositories WHERE owner_user_id = ${userId}`;
      }).catch(() => undefined);
    }
    await harness?.app.close();
    await sql?.end();
    for (const directory of created.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  describe('a create without a location', () => {
    it('stores an unfiled Chat with an unbound Workspace and starts nothing', async () => {
      const chatId = newChatId();

      const response = await create({ id: chatId }).expect(201);
      const body = createResponseSchema.parse(response.body);

      expect(body.chat).toMatchObject({ id: chatId, projectId: null });
      expect(body.workspace).toEqual({ status: 'unbound' });
      expect(await chatRow(chatId)).toMatchObject({
        project_id: null,
        workspace_root: null,
        workspace_generation: 0,
      });
      expect(await countRows('messages', { chatId })).toBe(0);
      expect(await countRows('runs', { chatId })).toBe(0);
      // No path decision ran, so the record holds no attempt.
      const record = creationRecordSchema.parse(
        (await recordOf(chatId).expect(200)).body,
      );
      expect(record.attempts).toEqual([]);
    });

    it('stores the message and starts its Run on an unbound start', async () => {
      const chatId = newChatId();
      const messageId = crypto.randomUUID();

      const response = await create({
        id: chatId,
        message: {
          id: messageId,
          modelId: MODEL_ID,
          parts: [{ type: 'text', text: 'Start nowhere in particular.' }],
        },
      }).expect(201);
      expect(createResponseSchema.parse(response.body).workspace).toEqual({
        status: 'unbound',
      });
      expect(await countRows('messages', { chatId })).toBe(1);
      expect(await countRows('runs', { chatId })).toBe(1);
      expect((await chatRow(chatId)).workspace_root).toBeNull();
    });

    it('rejects a malformed body with 400 and stores nothing', async () => {
      await create({}).expect(400);
      await create({ id: 'not-a-uuid' }).expect(400);
      // Only absence means "not given": an explicit null is malformed, never
      // a field the create then reads as present.
      const chatId = newChatId();
      for (const field of ['worktree', 'message', 'checkoutId', 'executorId']) {
        await create({ id: chatId, [field]: null }).expect(400);
      }
      await chatOf(chatId).expect(404);
    });

    it('rejects an unconfigured executor with 422 executor_unknown', async () => {
      const chatId = newChatId();

      const response = await create({
        id: chatId,
        executorId: 'machine:basement',
      }).expect(422);

      expect(response.body).toMatchObject({ code: 'executor_unknown' });
      await chatOf(chatId).expect(404);
    });

    it('rejects an invalid worktree argument before any write', async () => {
      const chatId = newChatId();

      await create({ id: chatId, worktree: { name: '-bad' } }).expect(422);
      await create({ id: chatId, worktree: { baseRef: '--force' } }).expect(
        422,
      );
      await chatOf(chatId).expect(404);
    });
  });

  describe('a create with a project and a location', () => {
    it('binds the resolved checkout, files the Chat, and records the default', async () => {
      const chatId = newChatId();

      const response = await create({
        id: chatId,
        projectId,
        repositoryId,
      }).expect(201);
      const body = createResponseSchema.parse(response.body);

      expect(body.chat).toMatchObject({ id: chatId, projectId });
      expect(body.workspace).toEqual({
        status: 'bound',
        root: source,
        executorId: 'creation-host',
      });
      expect(await chatRow(chatId)).toMatchObject({
        project_id: projectId,
        workspace_root: source,
        workspace_executor_id: 'creation-host',
        workspace_generation: 1,
      });
      expect(await countRows('messages', { chatId })).toBe(0);
      expect(await countRows('runs', { chatId })).toBe(0);

      // The source `main` checkout, never a worktree, stamped for the executor.
      const defaults = await defaultsOf(projectId, repositoryId);
      expect(defaults).toMatchObject([
        {
          executorId: 'creation-host',
          checkoutId: mainCheckoutId,
          updatedAt: expect.any(String),
        },
      ]);

      // One attempt, with the submitted path and its canonical form allowed.
      const record = creationRecordSchema.parse(
        (await recordOf(chatId).expect(200)).body,
      );
      expect(record.attempts).toHaveLength(1);
      expect(record.attempts[0]?.decisions).toMatchObject([
        { path: source, decision: 'allow', reason: 'matched_allow' },
        { path: source, decision: 'allow', reason: 'matched_allow' },
      ]);
    });

    it('starts unbound without location ids, even with a remembered default', async () => {
      const first = newChatId();
      const second = newChatId();
      await create({ id: first, projectId, repositoryId }).expect(201);

      const response = await create({ id: second, projectId }).expect(201);
      const body = createResponseSchema.parse(response.body);

      // The location is opt-in: the project's primary link and its remembered
      // default only pre-fill a client; the server binds nothing unasked.
      expect(body.workspace).toEqual({ status: 'unbound' });
      expect((await chatRow(second)).workspace_root).toBeNull();
    });

    it('lets an explicit repository override the primary link and its default', async () => {
      const chatId = newChatId();
      await create({ id: newChatId(), projectId, repositoryId }).expect(201);

      const response = await create({
        id: chatId,
        projectId,
        repositoryId: secondRepositoryId,
      }).expect(201);
      const body = createResponseSchema.parse(response.body);

      expect(body.workspace).toEqual({
        status: 'bound',
        root: secondSource,
        executorId: 'creation-host',
      });
      // The override becomes that link's default; the primary link's stays.
      expect(await defaultsOf(projectId, secondRepositoryId)).toMatchObject([
        { checkoutId: secondCheckoutId },
      ]);
      expect(await defaultsOf(projectId, repositoryId)).toMatchObject([
        { checkoutId: mainCheckoutId },
      ]);
    });

    it('stores the message and starts its Run on a bound start', async () => {
      const chatId = newChatId();
      const messageId = crypto.randomUUID();

      const response = await create({
        id: chatId,
        projectId,
        repositoryId,
        message: {
          id: messageId,
          modelId: MODEL_ID,
          parts: [{ type: 'text', text: 'Where does this start?' }],
        },
      }).expect(201);
      expect(createResponseSchema.parse(response.body).workspace.status).toBe(
        'bound',
      );

      const messages = await messagesOf(chatId).expect(200);
      expect(
        z
          .looseObject({ messages: z.array(z.looseObject({ id: z.guid() })) })
          .parse(messages.body).messages,
      ).toMatchObject([{ id: messageId }]);
      expect(await countRows('runs', { chatId })).toBe(1);
    });

    it('replays the started Run on the Chat stream', async () => {
      const chatId = newChatId();
      harness.models.client.delayMs = 2000;

      await create({
        id: chatId,
        projectId,
        message: {
          id: crypto.randomUUID(),
          modelId: MODEL_ID,
          parts: [{ type: 'text', text: 'Hold the turn.' }],
        },
      }).expect(201);

      const stream = await openSseStream({
        server: harness.http,
        method: 'GET',
        path: `/api/v1/chats/${chatId}/stream`,
        cookie: owner.cookie,
      });
      try {
        expect(stream.status).toBe(200);
        await expect(
          stream.nextFrame('the replayed Run start'),
        ).resolves.toMatchObject({ type: expect.any(String) });
      } finally {
        stream.close();
      }
    });
  });

  describe('a create that asks for a worktree', () => {
    it('creates it, records the checkout, the lease, and the root, and starts the Run', async () => {
      const chatId = newChatId();
      const base = headOf(source);
      const messageId = crypto.randomUUID();

      const response = await create({
        id: chatId,
        projectId,
        repositoryId,
        worktree: { name: 'creation-one' },
        message: {
          id: messageId,
          modelId: MODEL_ID,
          parts: [{ type: 'text', text: 'Start in a worktree.' }],
        },
      }).expect(201);
      const body = createResponseSchema.parse(response.body);
      const directory = join(
        source,
        '..',
        '.llame-worktrees',
        'llame',
        'creation-one',
      );

      expect(body.workspace).toEqual({
        status: 'bound',
        root: directory,
        executorId: 'creation-host',
        worktree: {
          path: directory,
          branch: 'llame/creation-one',
          baseCommit: base,
        },
      });
      expect(runGit(source, ['worktree', 'list', '--porcelain'])).toContain(
        'branch refs/heads/llame/creation-one',
      );
      expect(await chatRow(chatId)).toMatchObject({
        workspace_root: directory,
        workspace_executor_id: 'creation-host',
        workspace_generation: 1,
      });

      const [worktree] = await asOwner(
        owner.userId,
        (tx) =>
          tx`SELECT id, kind, parent_checkout_id, branch, origin FROM checkouts
             WHERE owner_user_id = ${owner.userId} AND path = ${directory}`,
      );
      expect(worktree).toMatchObject({
        kind: 'worktree',
        parent_checkout_id: mainCheckoutId,
        branch: 'llame/creation-one',
        origin: 'created',
      });
      const [lease] = await asOwner(
        owner.userId,
        (tx) =>
          tx`SELECT chat_id, checkout_id, base_ref, base_commit FROM worktree_leases
             WHERE owner_user_id = ${owner.userId} AND chat_id = ${chatId}`,
      );
      expect(lease).toMatchObject({
        chat_id: chatId,
        checkout_id: worktree.id,
        base_ref: base,
        base_commit: base,
      });
      // The default names the SOURCE main checkout, not the worktree.
      expect(await defaultsOf(projectId, repositoryId)).toMatchObject([
        { executorId: 'creation-host', checkoutId: mainCheckoutId },
      ]);
      expect(await countRows('messages', { chatId })).toBe(1);
      expect(await countRows('runs', { chatId })).toBe(1);
    });

    it('reuses its lease and root on a resend that adds the message', async () => {
      const chatId = newChatId();
      const first = await create({
        id: chatId,
        projectId,
        repositoryId,
        worktree: { name: 'creation-two' },
      }).expect(201);
      const root = createResponseSchema.parse(first.body).workspace.root;
      const checkoutsBefore = await asOwner(
        owner.userId,
        (tx) =>
          tx`SELECT count(*)::int AS count FROM checkouts WHERE owner_user_id = ${owner.userId}`,
      );

      const resent = await create({
        id: chatId,
        projectId,
        repositoryId,
        worktree: { name: 'creation-two' },
        message: {
          id: crypto.randomUUID(),
          modelId: MODEL_ID,
          parts: [{ type: 'text', text: 'Now send it.' }],
        },
      }).expect(201);
      const body = createResponseSchema.parse(resent.body);

      expect(body.workspace).toMatchObject({
        status: 'bound',
        root,
        worktree: { path: root, branch: 'llame/creation-two' },
      });
      expect(await countRows('messages', { chatId })).toBe(1);
      expect(await countRows('runs', { chatId })).toBe(1);
      const checkoutsAfter = await asOwner(
        owner.userId,
        (tx) =>
          tx`SELECT count(*)::int AS count FROM checkouts WHERE owner_user_id = ${owner.userId}`,
      );
      expect(checkoutsAfter[0]?.count).toBe(checkoutsBefore[0]?.count);
      expect(await countRows('worktree_leases', { chatId })).toBe(1);
    });

    it('refuses a resend of a Chat that already holds a message', async () => {
      const chatId = newChatId();
      await create({
        id: chatId,
        projectId,
        message: {
          id: crypto.randomUUID(),
          modelId: MODEL_ID,
          parts: [{ type: 'text', text: 'Sent once.' }],
        },
      }).expect(201);

      await create({
        id: chatId,
        projectId,
        message: {
          id: crypto.randomUUID(),
          modelId: MODEL_ID,
          parts: [{ type: 'text', text: 'Sent twice.' }],
        },
      }).expect(409);
      expect(await countRows('messages', { chatId })).toBe(1);
    });
  });

  describe('the Workspace failure statuses', () => {
    it('refuses a denied path with bind_failed permission_denied and keeps the Chat filed', async () => {
      const chatId = newChatId();
      const defaultsBefore = await defaultsOf(projectId, repositoryId);

      const response = await create({
        id: chatId,
        projectId,
        checkoutId: deniedCheckoutId,
        message: {
          id: crypto.randomUUID(),
          modelId: MODEL_ID,
          parts: [{ type: 'text', text: 'This path is refused.' }],
        },
      }).expect(201);
      const body = createResponseSchema.parse(response.body);

      expect(body.workspace).toMatchObject({
        status: 'bind_failed',
        code: 'permission_denied',
      });
      expect(await chatRow(chatId)).toMatchObject({
        project_id: projectId,
        workspace_root: null,
        workspace_generation: 0,
      });
      expect(await countRows('messages', { chatId })).toBe(0);
      expect(await countRows('runs', { chatId })).toBe(0);
      // A failed start records no default.
      expect(await defaultsOf(projectId, repositoryId)).toEqual(defaultsBefore);
      // The rejection is still recorded as the attempt that earned it.
      const record = creationRecordSchema.parse(
        (await recordOf(chatId).expect(200)).body,
      );
      expect(record.attempts).toHaveLength(1);
      expect(record.attempts[0]?.decisions).toMatchObject([
        { path: deniedPath, decision: 'reject', reason: 'explicit_reject' },
      ]);
    });

    it('applies an enabled bypass to the same path', async () => {
      const chatId = newChatId();

      const response = await create({
        id: chatId,
        projectId,
        checkoutId: deniedCheckoutId,
        message: {
          id: crypto.randomUUID(),
          modelId: MODEL_ID,
          permissionMode: 'bypass',
          parts: [{ type: 'text', text: 'Bypass this path.' }],
        },
      }).expect(201);
      const body = createResponseSchema.parse(response.body);

      expect(body.workspace).toMatchObject({
        status: 'bound',
        root: deniedPath,
      });
      const record = creationRecordSchema.parse(
        (await recordOf(chatId).expect(200)).body,
      );
      expect(record.attempts[0]?.decisions).toMatchObject([
        {
          path: deniedPath,
          decision: 'allow',
          reason: 'permission_mode_bypass',
        },
        {
          path: deniedPath,
          decision: 'allow',
          reason: 'permission_mode_bypass',
        },
      ]);
    });

    it('answers worktree_failed and leaves no row, root, default, or message', async () => {
      const chatId = newChatId();
      // The directory the plan would use already exists, so the add refuses
      // before any transaction.
      mkdirSync(
        join(source, '..', '.llame-worktrees', 'llame', 'creation-taken'),
        { recursive: true },
      );
      const defaultsBefore = await defaultsOf(projectId, repositoryId);

      const response = await create({
        id: chatId,
        projectId,
        repositoryId,
        worktree: { name: 'creation-taken' },
        message: {
          id: crypto.randomUUID(),
          modelId: MODEL_ID,
          parts: [{ type: 'text', text: 'This worktree is taken.' }],
        },
      }).expect(201);
      const body = createResponseSchema.parse(response.body);

      expect(body.workspace).toMatchObject({
        status: 'worktree_failed',
        message: expect.stringContaining('already exists'),
      });
      expect(body.workspace).not.toHaveProperty('code');
      expect(await chatRow(chatId)).toMatchObject({
        workspace_root: null,
        workspace_generation: 0,
      });
      expect(await countRows('messages', { chatId })).toBe(0);
      expect(await countRows('worktree_leases', { chatId })).toBe(0);
      expect(await defaultsOf(projectId, repositoryId)).toEqual(defaultsBefore);
    });

    it('answers machine_unavailable for an explicit offline Machine and stores no message', async () => {
      const chatId = newChatId();

      const response = await create({
        id: chatId,
        projectId,
        checkoutId: machineCheckoutId,
        message: {
          id: crypto.randomUUID(),
          modelId: MODEL_ID,
          parts: [{ type: 'text', text: 'That Machine is offline.' }],
        },
      }).expect(201);
      const body = createResponseSchema.parse(response.body);

      expect(body.workspace).toMatchObject({
        status: 'machine_unavailable',
        message: expect.stringContaining('machine:nas'),
      });
      expect(await chatRow(chatId)).toMatchObject({
        workspace_root: null,
        workspace_generation: 0,
      });
      expect(await countRows('messages', { chatId })).toBe(0);
      expect(await countRows('runs', { chatId })).toBe(0);
    });
  });

  describe('the resend rules', () => {
    it('re-runs the location steps after bind_failed and binds the corrected location', async () => {
      const chatId = newChatId();
      await create({
        id: chatId,
        projectId,
        checkoutId: deniedCheckoutId,
      }).expect(201);

      const resent = await create({
        id: chatId,
        projectId,
        checkoutId: mainCheckoutId,
        message: {
          id: crypto.randomUUID(),
          modelId: MODEL_ID,
          parts: [{ type: 'text', text: 'The corrected location.' }],
        },
      }).expect(201);
      const body = createResponseSchema.parse(resent.body);

      expect(body.workspace).toMatchObject({ status: 'bound', root: source });
      expect(await countRows('messages', { chatId })).toBe(1);
      expect(await countRows('runs', { chatId })).toBe(1);
      // Two attempts: the refusal and the corrected start.
      const record = creationRecordSchema.parse(
        (await recordOf(chatId).expect(200)).body,
      );
      expect(record.attempts).toHaveLength(2);
    });

    it('refuses an archived Chat', async () => {
      const chatId = newChatId();
      await create({ id: chatId, projectId, repositoryId }).expect(201);
      await request(harness.http)
        .patch(`/api/v1/chats/${chatId}`)
        .set('Cookie', owner.cookie)
        .send({ archived: true })
        .expect(200);

      await create({ id: chatId, projectId }).expect(409);
      expect((await chatRow(chatId)).workspace_root).toBe(source);
    });

    it('names a project mismatch with its body code', async () => {
      const chatId = newChatId();
      await create({ id: chatId, projectId }).expect(201);

      const response = await create({
        id: chatId,
        projectId: otherProjectId,
      }).expect(409);

      expect(response.body).toMatchObject({ code: 'project_mismatch' });
      expect((await chatRow(chatId)).project_id).toBe(projectId);
    });

    it('answers 404 for another owner’s chat id and creates nothing', async () => {
      const chatId = newChatId();
      await create({ id: chatId, projectId }).expect(201);

      const response = await create(
        { id: chatId, message: undefined },
        other,
      ).expect(404);
      expect(response.body).not.toHaveProperty('chat');
      expect((await chatRow(chatId)).project_id).toBe(projectId);
    });
  });

  describe('owner isolation', () => {
    it('answers 404 for a foreign project and stores no Chat', async () => {
      const chatId = newChatId();

      await create({ id: chatId, projectId }, other).expect(404);
      expect(await chatRow(chatId)).toBeUndefined();
    });

    it('answers 404 for a foreign checkout and stores no Chat', async () => {
      const chatId = newChatId();

      await create({ id: chatId, checkoutId: mainCheckoutId }, other).expect(
        404,
      );
      expect(await chatRow(chatId)).toBeUndefined();
    });

    it('answers 409 for an archived project and stores no Chat', async () => {
      const chatId = newChatId();

      await create({ id: chatId, projectId: archivedProjectId }).expect(409);
      expect(await chatRow(chatId)).toBeUndefined();
    });

    it('answers 422 for a worktree checkout and a disagreeing id', async () => {
      const worktree = newChatId();
      await create({
        id: worktree,
        projectId,
        checkoutId: worktreeCheckoutId,
      }).expect(422);
      expect(await chatRow(worktree)).toBeUndefined();

      const disagreeingRepository = newChatId();
      await create({
        id: disagreeingRepository,
        checkoutId: mainCheckoutId,
        repositoryId: unlinkedRepositoryId,
      }).expect(422);
      expect(await chatRow(disagreeingRepository)).toBeUndefined();

      const disagreeingExecutor = newChatId();
      await create({
        id: disagreeingExecutor,
        checkoutId: mainCheckoutId,
        executorId: 'machine:nas',
      }).expect(422);
      expect(await chatRow(disagreeingExecutor)).toBeUndefined();
    });

    it('files a chat into a project whose links do not name its repository', async () => {
      // A project and a working directory are separate settings: a named
      // repository outside the project's links still starts in the project.
      const chatId = newChatId();
      const response = await create({
        id: chatId,
        projectId,
        repositoryId: unlinkedRepositoryId,
      }).expect(201);

      expect(createResponseSchema.parse(response.body).chat).toMatchObject({
        id: chatId,
        projectId,
      });
    });

    it('answers 404 for another owner’s creation record', async () => {
      const chatId = newChatId();
      await create({ id: chatId, projectId }).expect(201);

      const response = await recordOf(chatId, other).expect(404);
      expect(response.body).not.toHaveProperty('attempts');
    });
  });

  describe('the creation lock', () => {
    /** Hold the Chat's session lock on one dedicated connection. */
    async function withCreationLock<T>(
      chatId: string,
      run: () => Promise<T>,
    ): Promise<T> {
      const locker = postgres(process.env.POSTGRES_URL!, { max: 1 });
      const reserved = await locker.reserve();
      const key = `chat-creation:${chatId}`;
      await reserved`SELECT pg_advisory_lock(hashtextextended(${key}, 0))`;
      try {
        return await run();
      } finally {
        await reserved`SELECT pg_advisory_unlock(hashtextextended(${key}, 0))`;
        reserved.release();
        await locker.end();
      }
    }

    it('answers 409 creation_in_progress to a create while another holds the id', async () => {
      const chatId = newChatId();

      const response = await withCreationLock(chatId, () =>
        create({ id: chatId, projectId }),
      );

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'creation_in_progress' });
      expect(await chatRow(chatId)).toBeUndefined();
    });

    it('answers 409 creation_in_progress to a message during a create, storing nothing', async () => {
      const chatId = newChatId();
      await create({ id: chatId, projectId }).expect(201);

      const response = await withCreationLock(chatId, () =>
        request(harness.http)
          .post(`/api/v1/chats/${chatId}/messages`)
          .set('Cookie', owner.cookie)
          .send({
            modelId: MODEL_ID,
            message: {
              id: crypto.randomUUID(),
              parts: [{ type: 'text', text: 'Interleaved send.' }],
            },
          }),
      );

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'creation_in_progress' });
      expect(await countRows('messages', { chatId })).toBe(0);
      expect(await countRows('runs', { chatId })).toBe(0);
    });

    it('takes the same lock for either case of one chat id', async () => {
      const chatId = newChatId();

      // `ParseUUIDPipe` accepts uppercase, so the create must name the same
      // key the lowercase id does.
      const response = await withCreationLock(chatId, () =>
        create({ id: chatId.toUpperCase(), projectId }),
      );

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'creation_in_progress' });
      expect(await chatRow(chatId)).toBeUndefined();
    });

    it('creates one worktree for one id across a refused and a successful request', async () => {
      const chatId = newChatId();
      const refused = await withCreationLock(chatId, () =>
        create({
          id: chatId,
          projectId,
          repositoryId,
          worktree: { name: 'creation-three' },
        }),
      );
      expect(refused.status).toBe(409);

      const accepted = await create({
        id: chatId,
        projectId,
        repositoryId,
        worktree: { name: 'creation-three' },
      }).expect(201);
      expect(createResponseSchema.parse(accepted.body).workspace).toMatchObject(
        { status: 'bound' },
      );
      expect(await countRows('worktree_leases', { chatId })).toBe(1);
    });
  });
});

/*
 * The creation lock reserves a connection for the whole request, so it must not
 * take it from the pool the request's own transactions then need. A tenant pool
 * of one connection is a valid configuration, and this suite proves the create
 * still finishes on it.
 */
describe('chat creation on a one-connection tenant pool', () => {
  let harness: Harness;

  beforeAll(async () => {
    // HTTP only: the claim is about the request path's connections.
    harness = await boot(
      { ...configFor(), db: { poolSize: 1 } },
      { workers: false },
    );
  });

  afterAll(async () => {
    await harness?.app.close();
  });

  it('completes a create while the creation lock holds its own connection', async () => {
    const registered = await request(harness.http)
      .post('/auth/v1/register')
      .send({
        email: `chat-creation-single-${crypto.randomUUID()}@test.com`,
        password: 'password123',
        name: 'Chat creation single pool',
      })
      .expect(201);
    const body: unknown = registered.body;
    expectRegisteredUserId(body);

    const response = await request(harness.http)
      .post('/api/v1/chats')
      .set('Cookie', cookieOf(registered))
      .send({ id: crypto.randomUUID() })
      .expect(201);

    expect(createResponseSchema.parse(response.body).workspace.status).toBe(
      'unbound',
    );
  });
});
