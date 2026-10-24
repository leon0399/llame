/**
 * HTTP-boundary tests for checkout registration on a Machine (openspec
 * `repositories` — "A Machine checkout stores the canonical Machine locator",
 * "Checkout registration inspects the path on its executor", "Registration and
 * removal need a configured executor", and "Registration and removal map
 * failures to typed statuses").
 *
 * The hub side is the production path: the real `MachineConnector` session, the
 * real `ExecutorGit` dispatch, and the real `readHelloResult` narrowing, over
 * the protocol peer's wire instead of SSH. The daemon's own argv, environment,
 * and root enforcement are pinned by `apps/machine/src/git.test.ts`.
 */

import { type IncomingMessage, Server, type ServerResponse } from 'node:http';

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
import type { MachinesConfig } from '../instance-config/machines-config';
import { MachineConnector } from '../machines/machine-connector.service';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import {
  createProtocolPeer,
  type ProtocolPeer,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';
import { cookieOf, expectRegisteredUserId } from '../testing/support';
import { type PermissionGroup } from '../tools/permissions/types';

vi.setConfig({ testTimeout: 60_000 });

const MACHINE = 'nas';
const PATH = '/srv/app';
const LOCATOR = `machine://${MACHINE}${PATH}`;
const HEAD = 'a'.repeat(40);

const MACHINES: MachinesConfig = {
  ssh: { knownHostsFile: '/dev/null' },
  hosts: { [MACHINE]: { destination: 'nas.example' } },
};

/** The locator answer a current daemon gives for one clone. */
const INSPECTED = {
  status: 'ok',
  toplevel: LOCATOR,
  commonDir: `${LOCATOR}/.git`,
  linked: false,
  mainWorktree: null,
  remotes: [{ name: 'origin', url: 'github.com/leon0399/llame' }],
  branch: 'main',
  head: HEAD,
};

/** What a current daemon answers `fs.stat` for the registered directory. */
const STAT = {
  value: { kind: 'directory', isLink: false, realPath: PATH },
};

/** The peer's method list for a daemon that answers the git surface. */
const GIT_SURFACE = [
  'git.inspect',
  'git.worktreeAdd',
  'git.worktreeList',
  'git.worktreeRemove',
  'git.status',
];

/** A policy that admits the Machine's own locators and nothing else. */
const ALLOW_MACHINE: PermissionGroup = {
  allow: [{ field: 'path', regex: `^machine://${MACHINE}/` }],
};

function tools(overrides: Partial<LlameConfig['tools']>): LlameConfig['tools'] {
  return { ...BUILT_IN_DEFAULTS.tools, ...overrides };
}

const checkoutSchema = z.looseObject({
  id: z.guid(),
  executorId: z.string(),
  path: z.string(),
  kind: z.enum(['main', 'worktree']),
  chatIds: z.array(z.guid()),
});

const failureSchema = z.looseObject({
  statusCode: z.number(),
  code: z.string(),
  message: z.string(),
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
  readonly peer: ProtocolPeer;
};

type BootOptions = {
  readonly tools: LlameConfig['tools'];
  readonly peer?: ProtocolPeerOptions;
};

async function boot(options: BootOptions): Promise<Harness> {
  const peer = createProtocolPeer({ roots: ['/srv'], ...options.peer });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CanonicalSearchCoverageService)
    .useValue({ assertReady: () => Promise.resolve() })
    .overrideProvider(InstanceConfigService)
    .useValue({
      config: {
        ...BUILT_IN_DEFAULTS,
        machines: MACHINES,
        tools: options.tools,
      },
      productUserAgent: 'llame/test',
    })
    .overrideProvider(MachineConnector)
    .useValue(
      new MachineConnector({
        machines: MACHINES,
        hubVersion: 'llame/test',
        transportFactory: peer.factory,
        idleCloseMs: 1000,
      }),
    )
    .compile();
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
      email: `machine-checkouts-${crypto.randomUUID()}@test.com`,
      password: 'password123',
      name: 'Machine checkout owner',
    });
  const body: unknown = registered.body;
  expectRegisteredUserId(body);
  return {
    app,
    http,
    cookie: cookieOf(registered),
    userId: body.user.id,
    peer,
  };
}

let sql: Sql;

beforeAll(() => {
  sql = postgres(process.env.POSTGRES_URL!, { max: 2 });
});

afterAll(async () => {
  await sql?.end();
});

describe('/api/v1/checkouts on a Machine', () => {
  it('stores the canonical locator and lists the chat bound to it', async () => {
    const harness = await boot({
      tools: tools({
        nativeExecutorId: 'hub-host',
        allowed: ['enter_workspace'],
        permissions: { enter_workspace: ALLOW_MACHINE },
      }),
      peer: {
        methods: GIT_SURFACE,
        answers: { 'fs.stat': STAT, 'git.inspect': { value: INSPECTED } },
      },
    });
    try {
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: LOCATOR })
        .expect(201);
      const checkout = checkoutSchema.parse(response.body);
      expect(checkout).toMatchObject({
        executorId: `machine:${MACHINE}`,
        path: LOCATOR,
        kind: 'main',
        chatIds: [],
      });

      // The inspected origin decided the repository, exactly as for a local
      // clone.
      const catalog = await request(harness.http)
        .get('/api/v1/repositories')
        .set('Cookie', harness.cookie)
        .expect(200);
      expect(catalog.body).toMatchObject([
        { canonicalRemote: 'github.com/leon0399/llame' },
      ]);

      // A bound root of the same Chat is the same text, so the list names it.
      const chatId = crypto.randomUUID();
      await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_user_id', ${harness.userId}, true)`;
        await tx`INSERT INTO chats (id, owner_user_id, title, workspace_root)
                  VALUES (${chatId}, ${harness.userId}, 'bound', ${LOCATOR})`;
      });
      const listed = await request(harness.http)
        .get('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .expect(200);
      const rows = z.array(checkoutSchema).parse(listed.body);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ chatIds: [chatId] });

      const machine = await harness.peer.session(0);
      expect(
        machine.calls.find((call) => call.method === 'fs.stat')?.params,
      ).toMatchObject({ path: PATH });
      expect(
        machine.calls.find((call) => call.method === 'git.inspect')?.params,
      ).toMatchObject({
        path: PATH,
        options: { displayPrefix: `machine://${MACHINE}` },
      });
    } finally {
      await harness.app.close();
    }
  });

  it('answers machine_unavailable when the session cannot open', async () => {
    const harness = await boot({
      tools: tools({
        nativeExecutorId: 'hub-host',
        allowed: ['enter_workspace'],
        permissions: { enter_workspace: ALLOW_MACHINE },
      }),
      peer: {
        openFailure: () =>
          'ssh: connect to host nas.example port 22: Connection refused',
      },
    });
    try {
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: LOCATOR })
        .expect(503);

      expect(failureSchema.parse(response.body)).toMatchObject({
        code: 'machine_unavailable',
      });
      const listed = await request(harness.http)
        .get('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .expect(200);
      expect(listed.body).toEqual([]);
    } finally {
      await harness.app.close();
    }
  });

  it('answers machine_update_required on a daemon that lists no git methods', async () => {
    const harness = await boot({
      tools: tools({
        nativeExecutorId: 'hub-host',
        allowed: ['enter_workspace'],
        permissions: { enter_workspace: ALLOW_MACHINE },
      }),
      peer: { roots: ['/srv'], answers: { 'fs.stat': STAT } },
    });
    try {
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: LOCATOR })
        .expect(503);

      const failure = failureSchema.parse(response.body);
      expect(failure.code).toBe('machine_update_required');
      expect(failure.message).toContain(
        'Update the daemon on that Machine to use git operations on it.',
      );
      const listed = await request(harness.http)
        .get('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .expect(200);
      expect(listed.body).toEqual([]);
      const machine = await harness.peer.session(0);
      expect(machine.requests).not.toContain('git.inspect');
    } finally {
      await harness.app.close();
    }
  });

  it('stores the canonical locator when the daemon sends a raw host path', async () => {
    const raw = '/srv/a#b/100%';
    const canonical = 'machine://nas/srv/a%23b/100%25';
    const harness = await boot({
      tools: tools({
        nativeExecutorId: 'hub-host',
        allowed: ['enter_workspace'],
        permissions: { enter_workspace: ALLOW_MACHINE },
      }),
      peer: {
        methods: GIT_SURFACE,
        answers: {
          'fs.stat': {
            value: { kind: 'directory', isLink: false, realPath: raw },
          },
          'git.inspect': {
            value: {
              ...INSPECTED,
              toplevel: `machine://${MACHINE}${raw}`,
              commonDir: `machine://${MACHINE}${raw}/.git`,
            },
          },
        },
      },
    });
    try {
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: canonical })
        .expect(201);

      expect(checkoutSchema.parse(response.body)).toMatchObject({
        executorId: `machine:${MACHINE}`,
        path: canonical,
        kind: 'main',
      });
    } finally {
      await harness.app.close();
    }
  });

  it('refuses a canonical Machine path the policy rejects, before any git call', async () => {
    const harness = await boot({
      tools: tools({
        nativeExecutorId: 'hub-host',
        allowed: ['enter_workspace'],
        permissions: {
          enter_workspace: {
            // The submitted locator is allowed; the daemon's real path is not.
            allow: [{ field: 'path', regex: `^machine://${MACHINE}${PATH}$` }],
          },
        },
      }),
      peer: {
        methods: GIT_SURFACE,
        answers: {
          'fs.stat': {
            value: {
              kind: 'directory',
              isLink: false,
              realPath: '/srv/secret',
            },
          },
          'git.inspect': { value: INSPECTED },
        },
      },
    });
    try {
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: LOCATOR })
        .expect(403);

      expect(failureSchema.parse(response.body).code).toBe('permission_denied');
      const machine = await harness.peer.session(0);
      expect(machine.requests).not.toContain('git.inspect');
    } finally {
      await harness.app.close();
    }
  });

  it('answers 403 permission_denied when the daemon refuses the address', async () => {
    const harness = await boot({
      tools: tools({
        nativeExecutorId: 'hub-host',
        allowed: ['enter_workspace'],
        permissions: { enter_workspace: ALLOW_MACHINE },
      }),
      peer: {
        methods: GIT_SURFACE,
        answers: { 'fs.stat': { error: 'path_not_registered' } },
      },
    });
    try {
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: LOCATOR })
        .expect(403);

      expect(failureSchema.parse(response.body).code).toBe('permission_denied');
      const listed = await request(harness.http)
        .get('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .expect(200);
      expect(listed.body).toEqual([]);
    } finally {
      await harness.app.close();
    }
  });

  it('refuses a locator the host policy rejects before any git call', async () => {
    const harness = await boot({
      tools: tools({
        nativeExecutorId: 'hub-host',
        allowed: ['enter_workspace'],
        permissions: {
          enter_workspace: {
            allow: [{ field: 'path', regex: '^machine://nas/public/' }],
          },
        },
      }),
      peer: {
        methods: GIT_SURFACE,
        answers: { 'fs.stat': STAT, 'git.inspect': { value: INSPECTED } },
      },
    });
    try {
      const response = await request(harness.http)
        .post('/api/v1/checkouts')
        .set('Cookie', harness.cookie)
        .send({ path: LOCATOR })
        .expect(403);

      expect(failureSchema.parse(response.body).code).toBe('permission_denied');
      // No git call ran, so the Machine was never even asked.
      expect(harness.peer.sessions).toHaveLength(0);
    } finally {
      await harness.app.close();
    }
  });
});
