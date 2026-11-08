/**
 * `GET /api/v1/chats/:id/git-state` over real HTTP, real PostgreSQL with FORCE
 * RLS, and real git (openspec `workspace-git-state`): owner isolation, the
 * session requirement, and the credential-free remote.
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

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { ExecutorGit } from '../machines/executor-git.service';
import { ModelsService } from '../models/models.service';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import {
  FakeModelsService,
  cookieOf,
  expectRegisteredUserId,
} from '../testing/support';

for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'])
  .toString()
  .split('\n')) {
  if (name !== '') delete process.env[name];
}

vi.setConfig({ testTimeout: 120_000 });

const EXECUTOR = 'git-state-host';
const SECRET_REMOTE =
  'https://x-access-token:ghp_secret@github.com/leon0399/llame.git';

type HttpServer = Server<typeof IncomingMessage, typeof ServerResponse>;

type Owner = { readonly cookie: string; readonly userId: string };

const created: Array<string> = [];

function runGit(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  });
}

function clone(): string {
  const base = mkdtempSync(join(tmpdir(), 'chat-git-state-'));
  created.push(base);
  const directory = join(realpathSync(base), 'llame');
  mkdirSync(directory);
  runGit(directory, ['init', '--quiet', '--initial-branch=main', '.']);
  runGit(directory, ['config', 'user.name', 'llame tests']);
  runGit(directory, ['config', 'user.email', 'llame@test.invalid']);
  writeFileSync(join(directory, 'README.md'), 'readme\n');
  runGit(directory, ['add', 'README.md']);
  runGit(directory, ['commit', '--quiet', '--message', 'first']);
  runGit(directory, ['remote', 'add', 'origin', SECRET_REMOTE]);
  return directory;
}

const config: LlameConfig = {
  ...BUILT_IN_DEFAULTS,
  tools: { ...BUILT_IN_DEFAULTS.tools, nativeExecutorId: EXECUTOR },
};

describe('the git state route over HTTP', () => {
  let app: INestApplication;
  let http: HttpServer;
  let sql: Sql;
  let owner: Owner;
  let other: Owner;
  let chatId = '';

  async function register(label: string): Promise<Owner> {
    const registered = await request(http)
      .post('/auth/v1/register')
      .send({
        email: `git-state-${label}-${crypto.randomUUID()}@test.com`,
        password: 'password123',
        name: `Git state ${label}`,
      })
      .expect(201);
    const body: unknown = registered.body;
    expectRegisteredUserId(body);
    return { cookie: cookieOf(registered), userId: body.user.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .overrideProvider(InstanceConfigService)
      .useValue({ config })
      .overrideProvider(ModelsService)
      .useValue(new FakeModelsService())
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0);
    const server: unknown = app.getHttpServer();
    if (!(server instanceof Server)) throw new Error('Expected a Node server');
    http = server;
    sql = postgres(process.env.POSTGRES_URL!, { max: 2 });
    owner = await register('owner');
    other = await register('other');

    chatId = crypto.randomUUID();
    await request(http)
      .post('/api/v1/chats')
      .set('Cookie', owner.cookie)
      .send({ id: chatId })
      .expect(201);
    const root = clone();
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_user_id', ${owner.userId}, true)`;
      await tx`UPDATE chats SET workspace_root = ${root}, workspace_executor_id = ${EXECUTOR}
        WHERE id = ${chatId}`;
    });
  });

  afterAll(async () => {
    await sql?.end();
    await app?.close();
    for (const directory of created.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  const stateOf = (as?: Owner) => {
    const call = request(http).get(`/api/v1/chats/${chatId}/git-state`);
    return as === undefined ? call : call.set('Cookie', as.cookie);
  };

  it('hides remote credentials from the owner', async () => {
    const response = await stateOf(owner).expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      branch: 'main',
      remotes: [{ name: 'origin', value: 'github.com/leon0399/llame' }],
    });
    expect(response.text).not.toContain('ghp_secret');
  });

  it('answers 404 to another owner and runs no git', async () => {
    const executors = app.get(ExecutorGit);
    const locateEntry = vi.spyOn(executors, 'locateEntry');

    const response = await stateOf(other).expect(404);

    expect(response.body).not.toHaveProperty('status', 'ok');
    expect(locateEntry).not.toHaveBeenCalled();
    locateEntry.mockRestore();
  });

  it('refuses an anonymous request', async () => {
    await stateOf().expect(401);
  });

  // The route's own ceiling (30/min per IP). Last: it spends that budget.
  it('THROTTLE: rapid git state reads are rejected with 429', async () => {
    let tooMany = 0;
    for (let i = 0; i < 35; i += 1) {
      const res = await stateOf(owner);
      if (res.status === 429) tooMany += 1;
      else expect(res.status).toBe(200);
    }
    expect(tooMany).toBeGreaterThan(0);
  });
});
