/**
 * HTTP-boundary tests for /api/v1/checkouts and /api/v1/repositories.
 *
 * Runs against real Postgres (integration project) and real git repositories in
 * throwaway directories, so registration exercises the same argv, environment,
 * and inspection the hub runs in production. Each permission scenario boots its
 * own application graph, because `tools.allowed` and `tools.permissions` are
 * read once at boot.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { IncomingMessage, Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { type GitInspectResult } from '@workspace/git-executor';
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
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { cookieOf, expectRegisteredUserId } from '../testing/support';
import { type PermissionGroup } from '../tools/permissions/types';
import { GIT_INSPECTOR } from './checkout-registration.service';

vi.setConfig({ testTimeout: 60_000 });

// A git hook exports GIT_DIR and friends; clear them so the test's own git
// commands cannot be redirected at this checkout.
for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'])
  .toString()
  .split('\n')) {
  if (name !== '') delete process.env[name];
}

const created: Array<string> = [];

function tempDirectory(prefix = 'checkout-api-'): string {
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

function repository(options: { readonly remote?: string } = {}): string {
  const directory = tempDirectory();
  mkdirSync(directory, { recursive: true });
  runGit(directory, ['init', '--quiet', '--initial-branch=main', '.']);
  runGit(directory, ['config', 'user.name', 'llame tests']);
  runGit(directory, ['config', 'user.email', 'llame@test.invalid']);
  runGit(directory, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(directory, 'README.md'), 'readme\n');
  runGit(directory, ['add', 'README.md']);
  runGit(directory, ['commit', '--quiet', '--message', 'first']);
  if (options.remote !== undefined) {
    runGit(directory, ['remote', 'add', 'origin', options.remote]);
  }
  return directory;
}

function linkedWorktree(main: string, branch: string): string {
  const target = join(tempDirectory('checkout-worktree-'), branch);
  runGit(main, ['worktree', 'add', '--quiet', '-b', branch, target]);
  return target;
}

function tools(overrides: Partial<LlameConfig['tools']>): LlameConfig['tools'] {
  return { ...BUILT_IN_DEFAULTS.tools, ...overrides };
}

const ALLOW_TMP: PermissionGroup = {
  allow: [{ field: 'path', regex: '^/tmp/' }],
};

const idSchema = z.object({ id: z.guid() });
const failureSchema = z.looseObject({
  statusCode: z.number(),
  code: z.string(),
  message: z.string(),
});
const repositorySchema = z.looseObject({
  id: z.guid(),
  displayName: z.string(),
  canonicalRemote: z.string().nullable(),
});
const checkoutSchema = z.looseObject({
  id: z.guid(),
  repositoryId: z.guid(),
  executorId: z.string(),
  path: z.string(),
  kind: z.enum(['main', 'worktree']),
  parentCheckoutId: z.guid().nullable(),
  branch: z.string().nullable(),
  origin: z.enum(['registered', 'adopted', 'created']),
  worktreeBase: z.string().nullable(),
  chatIds: z.array(z.guid()),
  leaseChatId: z.guid().nullable(),
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

type BootOptions = {
  readonly tools: LlameConfig['tools'];
  readonly inspect?: (path: string) => Promise<GitInspectResult>;
};

type CheckoutBody = {
  readonly path: string;
  readonly repositoryId?: string | null;
  readonly remote?: string | null;
};

async function boot(options: BootOptions): Promise<Harness> {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CanonicalSearchCoverageService)
    .useValue({ assertReady: () => Promise.resolve() })
    .overrideProvider(InstanceConfigService)
    .useValue({ config: { ...BUILT_IN_DEFAULTS, tools: options.tools } });
  if (options.inspect !== undefined) {
    builder
      .overrideProvider(GIT_INSPECTOR)
      .useValue({ inspect: options.inspect });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  const server: unknown = app.getHttpServer();
  if (!isHttpServer(server)) {
    throw new Error('Expected Nest to expose a Node HTTP server');
  }
  const http = server;
  const registered = await request(http)
    .post('/auth/v1/register')
    .send({
      email: `checkouts-${crypto.randomUUID()}@test.com`,
      password: 'password123',
      name: 'Checkout owner',
    });
  const body: unknown = registered.body;
  expectRegisteredUserId(body);
  return { app, http, cookie: cookieOf(registered), userId: body.user.id };
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

afterAll(() => {
  for (const directory of created) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('/api/v1/checkouts with a permissive local executor', () => {
  let harness: Harness;
  let sql: Sql;
  let clone: string;
  let repositoryId: string;
  let mainCheckoutId: string;
  let worktreePath: string;
  let worktreeCheckoutId: string;

  beforeAll(async () => {
    harness = await boot({
      tools: tools({
        nativeExecutorId: 'test-host',
        allowed: ['enter_workspace'],
        permissions: { enter_workspace: ALLOW_TMP },
      }),
    });
    sql = postgres(process.env.POSTGRES_URL!, { max: 2 });
    clone = repository({ remote: 'git@github.com:leon0399/llame.git' });
    worktreePath = linkedWorktree(clone, 'feature');
  });

  afterAll(async () => {
    await harness?.app.close();
    await sql?.end();
  });

  const post = (body: CheckoutBody) =>
    request(harness.http)
      .post('/api/v1/checkouts')
      .set('Cookie', harness.cookie)
      .send(body);

  it('registers the clone and adopts its repository from the inspected origin', async () => {
    const response = await post({ path: clone }).expect(201);
    const registered = checkoutSchema.parse(response.body);

    expect(registered).toMatchObject({
      executorId: 'test-host',
      path: clone,
      kind: 'main',
      origin: 'registered',
      branch: 'main',
      parentCheckoutId: null,
      chatIds: [],
      leaseChatId: null,
    });
    const repositories = await request(harness.http)
      .get('/api/v1/repositories')
      .set('Cookie', harness.cookie)
      .expect(200);
    const catalog = z.array(repositorySchema).parse(repositories.body);
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
      displayName: 'llame',
      canonicalRemote: 'github.com/leon0399/llame',
    });
    repositoryId = registered.repositoryId;
    mainCheckoutId = registered.id;
  });

  it('answers a repeated registration of one path as a conflict', async () => {
    const response = await post({ path: clone }).expect(409);

    expect(response.body).toMatchObject({ code: 'path_taken' });
    const list = await request(harness.http)
      .get('/api/v1/checkouts')
      .set('Cookie', harness.cookie)
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('records a linked worktree as a worktree row with its main clone as parent', async () => {
    const response = await post({ path: worktreePath }).expect(201);
    const worktree = checkoutSchema.parse(response.body);

    expect(worktree).toMatchObject({
      kind: 'worktree',
      parentCheckoutId: mainCheckoutId,
      repositoryId,
      branch: 'feature',
      origin: 'registered',
    });
    worktreeCheckoutId = worktree.id;
  });

  it('rejects a declared repository whose origin differs from the inspected one', async () => {
    const other = await request(harness.http)
      .post('/api/v1/repositories')
      .set('Cookie', harness.cookie)
      .send({
        displayName: 'other',
        remote: 'https://github.com/leon0399/other',
      })
      .expect(201);
    const declared = idSchema.parse(other.body);

    const mismatch = await post({
      path: repository({ remote: 'git@github.com:leon0399/llame.git' }),
      repositoryId: declared.id,
    }).expect(422);
    expect(mismatch.body).toMatchObject({ code: 'origin_mismatch' });
  });

  it('registers a remote-less clone under its toplevel name', async () => {
    const bare = repository();
    const response = await post({ path: bare }).expect(201);
    const registered = checkoutSchema.parse(response.body);

    const repositories = await request(harness.http)
      .get('/api/v1/repositories')
      .set('Cookie', harness.cookie)
      .expect(200);
    const adopted = z
      .array(repositorySchema)
      .parse(repositories.body)
      .find((row) => row.id === registered.repositoryId);
    expect(adopted).toMatchObject({
      displayName: join(bare).split('/').at(-1),
      canonicalRemote: null,
    });
  });

  it('joins the repository a declared alias names', async () => {
    const target = await request(harness.http)
      .post('/api/v1/repositories')
      .set('Cookie', harness.cookie)
      .send({
        displayName: 'aliased',
        remote: 'https://github.com/leon0399/llame-alias-new',
      })
      .expect(201);
    const aliased = idSchema.parse(target.body);
    await request(harness.http)
      .post(`/api/v1/repositories/${aliased.id}/aliases`)
      .set('Cookie', harness.cookie)
      .send({ remote: 'https://github.com/leon0399/llame-alias-old' })
      .expect(201);

    const response = await post({
      path: repository({
        remote: 'git@github.com:leon0399/llame-alias-old.git',
      }),
    }).expect(201);

    expect(checkoutSchema.parse(response.body).repositoryId).toBe(aliased.id);
  });

  it('refuses a request that carries two selectors', async () => {
    const response = await post({
      path: repository(),
      repositoryId,
      remote: 'github.com/leon0399/llame',
    }).expect(422);

    expect(failureSchema.parse(response.body).code).toBe('invalid_selector');
  });

  it('refuses a path that holds no repository', async () => {
    const plain = tempDirectory('checkout-plain-');
    const response = await post({ path: plain }).expect(422);

    expect(response.body).toMatchObject({ code: 'not_a_repository' });
  });

  it('refuses a path that does not exist as a validation failure, not a 404', async () => {
    const response = await post({
      path: join(tmpdir(), `missing-${crypto.randomUUID()}`),
    }).expect(422);

    expect(response.body).toMatchObject({ code: 'invalid_path' });
  });

  it('refuses a machine:// path as executor_unavailable in this layer', async () => {
    const response = await post({ path: 'machine://nas/srv/app' }).expect(503);

    expect(response.body).toMatchObject({ code: 'executor_unavailable' });
  });

  it('sets a worktree base on a main row only', async () => {
    const updated = await request(harness.http)
      .patch(`/api/v1/checkouts/${mainCheckoutId}`)
      .set('Cookie', harness.cookie)
      .send({ worktreeBase: '/tmp/llame-trees' })
      .expect(200);
    expect(updated.body).toMatchObject({ worktreeBase: '/tmp/llame-trees' });

    const relative = await request(harness.http)
      .patch(`/api/v1/checkouts/${mainCheckoutId}`)
      .set('Cookie', harness.cookie)
      .send({ worktreeBase: 'trees/llame' })
      .expect(422);
    expect(relative.body).toMatchObject({ code: 'invalid_worktree_base' });

    const otherExecutor = await request(harness.http)
      .patch(`/api/v1/checkouts/${mainCheckoutId}`)
      .set('Cookie', harness.cookie)
      .send({ worktreeBase: 'machine://nas/srv/trees' })
      .expect(422);
    expect(otherExecutor.body).toMatchObject({ code: 'invalid_worktree_base' });

    const worktreeRow = await request(harness.http)
      .patch(`/api/v1/checkouts/${worktreeCheckoutId}`)
      .set('Cookie', harness.cookie)
      .send({ worktreeBase: '/tmp/trees' })
      .expect(422);
    expect(worktreeRow.body).toMatchObject({ code: 'invalid_worktree_base' });
  });

  it('lists the bound chats of a main row and the lease chat of a worktree row', async () => {
    const leased = crypto.randomUUID();
    const sibling = crypto.randomUUID();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_user_id', ${harness.userId}, true)`;
      for (const [chatId, root] of [
        [first, clone],
        [second, clone],
        [leased, worktreePath],
        [sibling, worktreePath],
      ] as const) {
        await tx`INSERT INTO chats (id, owner_user_id, title, workspace_root)
                  VALUES (${chatId}, ${harness.userId}, 'bound', ${root})`;
      }
      await tx`INSERT INTO worktree_leases (owner_user_id, chat_id, checkout_id, base_ref)
                VALUES (${harness.userId}, ${leased}, ${worktreeCheckoutId}, 'main')`;
    });

    const response = await request(harness.http)
      .get(`/api/v1/checkouts?repositoryId=${repositoryId}`)
      .set('Cookie', harness.cookie)
      .expect(200);

    const rows = z.array(checkoutSchema).parse(response.body);
    const main = rows.find((row) => row.id === mainCheckoutId);
    const worktree = rows.find((row) => row.id === worktreeCheckoutId);
    // Two chats written in one transaction share `now()`, so the row order
    // falls back to id; the set is what the contract promises.
    expect([...(main?.chatIds ?? [])].sort()).toEqual([first, second].sort());
    expect(main?.leaseChatId).toBeNull();
    expect([...(worktree?.chatIds ?? [])].sort()).toEqual(
      [leased, sibling].sort(),
    );
    expect(worktree?.leaseChatId).toBe(leased);
  });

  it('answers 404 for a foreign repository, checkout, or selector', async () => {
    const foreign = await boot({
      tools: tools({
        nativeExecutorId: 'test-host',
        allowed: ['enter_workspace'],
        permissions: { enter_workspace: ALLOW_TMP },
      }),
    });
    try {
      const foreignCookie = foreign.cookie;
      const read = await request(foreign.http)
        .patch(`/api/v1/repositories/${repositoryId}`)
        .set('Cookie', foreignCookie)
        .send({ displayName: 'hijacked' })
        .expect(404);
      expect(read.body).toMatchObject({ code: 'not_found' });
      await request(foreign.http)
        .delete(`/api/v1/repositories/${repositoryId}`)
        .set('Cookie', foreignCookie)
        .expect(404);
      await request(foreign.http)
        .patch(`/api/v1/checkouts/${mainCheckoutId}`)
        .set('Cookie', foreignCookie)
        .send({ worktreeBase: '/tmp/trees' })
        .expect(404);
      await request(foreign.http)
        .delete(`/api/v1/checkouts/${mainCheckoutId}`)
        .set('Cookie', foreignCookie)
        .expect(404);
      const selector = await request(foreign.http)
        .post('/api/v1/checkouts')
        .set('Cookie', foreignCookie)
        .send({ path: repository(), repositoryId })
        .expect(404);
      expect(selector.body).toMatchObject({ code: 'not_found' });

      // The owner's rows are untouched by any of it.
      const mine = await request(harness.http)
        .get('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .expect(200);
      expect(
        z.array(checkoutSchema).parse(mine.body).length,
      ).toBeGreaterThanOrEqual(3);
    } finally {
      await foreign.app.close();
    }
  });

  it('deletes a checkout row without touching its directory', async () => {
    const beyond = await request(harness.http)
      .post('/api/v1/repositories')
      .set('Cookie', harness.cookie)
      .send({ displayName: 'scratch' })
      .expect(201);
    const scratch = repository();
    const scratchRepository = idSchema.parse(beyond.body);
    const created2 = checkoutSchema.parse(
      (
        await post({
          path: scratch,
          repositoryId: scratchRepository.id,
        }).expect(201)
      ).body,
    );

    await request(harness.http)
      .delete(`/api/v1/checkouts/${created2.id}`)
      .set('Cookie', harness.cookie)
      .expect(204);

    expect(existsSync(scratch)).toBe(true);
    const list = await request(harness.http)
      .get(`/api/v1/checkouts?repositoryId=${scratchRepository.id}`)
      .set('Cookie', harness.cookie)
      .expect(200);
    expect(list.body).toEqual([]);
  });

  it('stores a subdirectory of a clone as the clone root, once', async () => {
    const parent = repository();
    const subdirectory = join(parent, 'apps', 'web');
    mkdirSync(subdirectory, { recursive: true });

    const registered = checkoutSchema.parse(
      (await post({ path: subdirectory }).expect(201)).body,
    );
    expect(registered).toMatchObject({
      path: parent,
      kind: 'main',
      branch: 'main',
    });

    const repeated = await post({ path: parent }).expect(409);
    expect(repeated.body).toMatchObject({ code: 'path_taken' });
  });

  it('keeps a remote-less worktree under the repository of its main row', async () => {
    const main = repository();
    const mainRow = checkoutSchema.parse(
      (await post({ path: main }).expect(201)).body,
    );
    const worktree = linkedWorktree(main, 'remote-less-feature');

    const registered = checkoutSchema.parse(
      (await post({ path: worktree }).expect(201)).body,
    );

    expect(registered).toMatchObject({
      repositoryId: mainRow.repositoryId,
      kind: 'worktree',
      parentCheckoutId: mainRow.id,
      branch: 'remote-less-feature',
    });
  });

  it('lists a chat already bound to a path in the registration response', async () => {
    const clone = repository();
    const chatId = crypto.randomUUID();
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_user_id', ${harness.userId}, true)`;
      await tx`INSERT INTO chats (id, owner_user_id, title, workspace_root)
                VALUES (${chatId}, ${harness.userId}, 'pre-bound', ${clone})`;
    });

    const registered = checkoutSchema.parse(
      (await post({ path: clone }).expect(201)).body,
    );

    expect(registered.chatIds).toEqual([chatId]);
  });

  it('adopts one repository for two clones of one remote registered at once', async () => {
    const slug = `concurrent-${crypto.randomUUID()}`;
    const remote = `https://github.com/leon0399/${slug}`;
    const first = repository({ remote });
    const second = repository({ remote });

    const [a, b] = await Promise.all([
      post({ path: first }),
      post({ path: second }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const firstRow = checkoutSchema.parse(a.body);
    const secondRow = checkoutSchema.parse(b.body);
    expect(firstRow.repositoryId).toBe(secondRow.repositoryId);

    const catalog = z
      .array(repositorySchema)
      .parse(
        (
          await request(harness.http)
            .get('/api/v1/repositories')
            .set('Cookie', harness.cookie)
            .expect(200)
        ).body,
      );
    expect(
      catalog.filter(
        (row) => row.canonicalRemote === `github.com/leon0399/${slug}`,
      ),
    ).toHaveLength(1);
  });

  it('records one parent row for two worktrees registered at once', async () => {
    const remote = `https://github.com/leon0399/race-${crypto.randomUUID()}`;
    const main = repository({ remote });
    const first = linkedWorktree(main, 'race-a');
    const second = linkedWorktree(main, 'race-b');

    const [a, b] = await Promise.all([
      post({ path: first }),
      post({ path: second }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const firstRow = checkoutSchema.parse(a.body);
    const secondRow = checkoutSchema.parse(b.body);
    expect(firstRow.parentCheckoutId).toBe(secondRow.parentCheckoutId);
    expect(firstRow.repositoryId).toBe(secondRow.repositoryId);

    const rows = z
      .array(checkoutSchema)
      .parse(
        (
          await request(harness.http)
            .get(`/api/v1/checkouts?repositoryId=${firstRow.repositoryId}`)
            .set('Cookie', harness.cookie)
            .expect(200)
        ).body,
      );
    expect(rows.filter((row) => row.kind === 'main')).toHaveLength(1);
  });

  it('refuses the second of two concurrent registrations of one path', async () => {
    const clone = repository();

    const responses = await Promise.all([
      post({ path: clone }),
      post({ path: clone }),
    ]);
    const statuses = responses
      .map((response) => response.status)
      .sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const created = checkoutSchema.parse(
      responses.find((response) => response.status === 201)?.body,
    );
    const rows = z
      .array(checkoutSchema)
      .parse(
        (
          await request(harness.http)
            .get(`/api/v1/checkouts?repositoryId=${created.repositoryId}`)
            .set('Cookie', harness.cookie)
            .expect(200)
        ).body,
      );
    expect(rows).toHaveLength(1);
  });
});

describe('checkout registration gates', () => {
  it('refuses a local path on a process without a native executor', async () => {
    const inspect = vi.fn();
    const harness = await boot({
      tools: tools({
        nativeExecutorId: undefined,
        allowed: ['enter_workspace'],
        permissions: { enter_workspace: ALLOW_TMP },
      }),
      inspect,
    });
    try {
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: repository() })
        .expect(503);
      expect(response.body).toMatchObject({ code: 'executor_unavailable' });
      expect(inspect).not.toHaveBeenCalled();
      const list = await request(harness.http)
        .get('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .expect(200);
      expect(list.body).toEqual([]);
    } finally {
      await harness.app.close();
    }
  });

  it('requires the enter_workspace allowlist entry before any git call', async () => {
    const inspect = vi.fn();
    const harness = await boot({
      tools: tools({
        nativeExecutorId: 'test-host',
        allowed: [],
        permissions: { enter_workspace: ALLOW_TMP },
      }),
      inspect,
    });
    try {
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: repository() })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'tool_not_allowed' });
      expect(inspect).not.toHaveBeenCalled();
    } finally {
      await harness.app.close();
    }
  });

  it('refuses an unallowed path without starting a git call', async () => {
    const inspect = vi.fn();
    const harness = await boot({
      tools: tools({
        nativeExecutorId: 'test-host',
        allowed: ['enter_workspace'],
        permissions: {
          enter_workspace: { allow: [{ field: 'path', regex: '^/srv/' }] },
        },
      }),
      inspect,
    });
    try {
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: repository() })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'permission_denied' });
      expect(inspect).not.toHaveBeenCalled();
    } finally {
      await harness.app.close();
    }
  });

  it('refuses a rejected main clone behind an allowed subdirectory', async () => {
    const clone = repository();
    const harness = await boot({
      tools: tools({
        nativeExecutorId: 'test-host',
        allowed: ['enter_workspace'],
        permissions: {
          enter_workspace: {
            allow: [{ field: 'path', regex: `^${escapeRegex(clone)}/` }],
            reject: [{ field: 'path', regex: `^${escapeRegex(clone)}$` }],
          },
        },
      }),
    });
    try {
      const subdirectory = join(clone, 'nested');
      mkdirSync(subdirectory);
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: subdirectory })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'permission_denied' });
    } finally {
      await harness.app.close();
    }
  });

  it('refuses a rejected main clone behind an allowed linked worktree', async () => {
    const main = repository();
    const worktree = linkedWorktree(main, 'allowed');
    const harness = await boot({
      tools: tools({
        nativeExecutorId: 'test-host',
        allowed: ['enter_workspace'],
        permissions: {
          enter_workspace: {
            allow: [{ field: 'path', regex: `^${escapeRegex(worktree)}$` }],
            reject: [{ field: 'path', regex: `^${escapeRegex(main)}$` }],
          },
        },
      }),
    });
    try {
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: worktree })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'permission_denied' });
    } finally {
      await harness.app.close();
    }
  });

  it('maps a git timeout and a git failure to 502', async () => {
    const timedOut = await boot({
      tools: tools({
        nativeExecutorId: 'test-host',
        allowed: ['enter_workspace'],
        permissions: { enter_workspace: ALLOW_TMP },
      }),
      inspect: () =>
        Promise.resolve({
          status: 'error',
          type: 'timed_out',
          stderr: 'git did not finish',
        }),
    });
    const failed = await boot({
      tools: tools({
        nativeExecutorId: 'test-host',
        allowed: ['enter_workspace'],
        permissions: { enter_workspace: ALLOW_TMP },
      }),
      inspect: () =>
        Promise.resolve({
          status: 'error',
          type: 'git_failed',
          stderr: 'fatal: bad object HEAD',
        }),
    });
    try {
      const path = repository();
      const timeout = await request(timedOut.http)
        .post('/api/v1/checkouts')
        .set('Cookie', timedOut.cookie)
        .send({ path })
        .expect(502);
      expect(timeout.body).toMatchObject({ code: 'git_failed' });

      const failure = await request(failed.http)
        .post('/api/v1/checkouts')
        .set('Cookie', failed.cookie)
        .send({ path })
        .expect(502);
      const failureBody = failureSchema.parse(failure.body);
      expect(failureBody.code).toBe('git_failed');
      expect(failureBody.message).toContain('fatal: bad object HEAD');

      const list = await request(failed.http)
        .get('/api/v1/checkouts')
        .set('Cookie', failed.cookie)
        .expect(200);
      expect(list.body).toEqual([]);
    } finally {
      await timedOut.app.close();
      await failed.app.close();
    }
  });
});
