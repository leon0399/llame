import { createServer, type Server, type ServerResponse } from 'node:http';

import { isString } from '@workspace/runtime-safety';
import { fetch as undiciFetch } from 'undici';
import { describe, expect, it } from 'vitest';

import { compileToolPermissionMap } from '../../../permissions/compile-permissions';
import {
  createAddressAdmission,
  createDerivedAdmission,
} from '../../admission';
import { createWebFetchSession, type ResolveHost } from '../../http-client';
import type { ToolContext } from '../../../types';
import type { CompiledPolicy } from '../../../permissions/types';
import type { GithubWebAdapterConfig } from '../../../../instance-config/llame-config';
import {
  dispatchWebAdapters,
  type WebAdapterDispatch,
  type WebAdapterIo,
} from '../contract';
import { createGithubAdapter } from './adapter';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonObject
  | ReadonlyArray<JsonValue>;
type JsonObject = { readonly [key: string]: JsonValue };

type FixtureAddress = 'api' | 'redirect';
type FixtureRequest = {
  readonly address: FixtureAddress;
  readonly method: string;
  readonly path: string;
  readonly accept: string | undefined;
  readonly userAgent: string | undefined;
  readonly authorization: string | undefined;
};
type FixtureRoute = (
  address: FixtureAddress,
  path: string,
  response: ServerResponse,
  redirectOrigin: string,
) => void;
type GithubFixture = {
  readonly apiOrigin: string;
  readonly requests: Array<FixtureRequest>;
  readonly resolve: ResolveHost;
  close(): Promise<void>;
};
type PullRouteOptions = {
  readonly redirectPrimary?: boolean;
  readonly primaryRateLimited?: boolean;
};

const ACCEPT = 'application/vnd.github+json';
const USER_AGENT = 'llame/0.0.0-test';
const PULL_SOURCE = 'https://github.com/o/r/pull/12';
const PULL_PRIMARY = '/repos/o/r/pulls/12';
const PULL_ISSUE_COMMENTS = '/repos/o/r/issues/12/comments?per_page=100&page=1';
const PULL_REVIEWS = '/repos/o/r/pulls/12/reviews?per_page=100&page=1';
const PULL_REVIEW_COMMENTS = '/repos/o/r/pulls/12/comments?per_page=100&page=1';
const PULL_FILES = '/repos/o/r/pulls/12/files?per_page=100&page=1';
const CHECK_RUNS =
  '/repos/o/r/commits/abc123/check-runs?filter=latest&per_page=100&page=1';
const RESET = '123';

const ADMIT_ALL_POLICY = compileToolPermissionMap(
  { read: { allow: true } },
  'github-adapter-integration',
);
const SOURCE_ONLY_POLICY = compileToolPermissionMap(
  {
    read: {
      allow: [
        {
          field: 'path',
          regex: String.raw`^https://github\.com/`,
        },
      ],
    },
  },
  'github-adapter-source-only',
);

function pullPayload() {
  return {
    number: 12,
    title: 'A pull request',
    state: 'open',
    merged: false,
    draft: false,
    user: { login: 'alice' },
    base: { ref: 'main' },
    head: { ref: 'feature', sha: 'abc123' },
    mergeable_state: 'clean',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    labels: [],
    html_url: PULL_SOURCE,
    body: 'Pull body',
  } satisfies JsonObject;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: JsonValue,
  headers: Readonly<Record<string, string>> = {},
): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendNotFound(response: ServerResponse): void {
  sendJson(response, 404, { message: 'fixture route not found' });
}

function sendRateLimit(response: ServerResponse, body: string): void {
  sendJson(
    response,
    403,
    { message: body },
    {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': RESET,
    },
  );
}

function sendRedirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location });
  response.end('redirect');
}

async function listenOn(
  server: Server,
  address: string,
  port: number,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, address, resolve);
  });
  const listening = server.address();
  if (listening === null || isString(listening)) {
    throw new Error('The GitHub fixture did not receive a TCP address.');
  }
  return listening.port;
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
async function startGithubFixture(route: FixtureRoute): Promise<GithubFixture> {
  const requests: Array<FixtureRequest> = [];
  let port = 0;
  const create = (address: FixtureAddress): Server => {
    const server = createServer((request, response) => {
      requests.push({
        address,
        method: request.method ?? '',
        path: request.url ?? '',
        accept: request.headers.accept,
        userAgent: request.headers['user-agent'],
        authorization: request.headers.authorization,
      });
      request.on('error', () => undefined);
      response.on('error', () => undefined);
      route(
        address,
        request.url ?? '/',
        response,
        `http://redirect.github.test:${port}`,
      );
    });
    server.on('clientError', (_error, socket) => socket.destroy());
    return server;
  };
  const api = create('api');
  const redirect = create('redirect');
  port = await listenOn(api, '127.0.0.1', 0);
  await listenOn(redirect, '127.0.0.2', port);

  const resolve: ResolveHost = (hostname) => {
    if (hostname === 'api.github.test') {
      return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
    }
    if (hostname === 'redirect.github.test') {
      return Promise.resolve([{ address: '127.0.0.2', family: 4 }]);
    }
    return Promise.reject(
      new Error(`Unexpected GitHub fixture hostname: ${hostname}`),
    );
  };

  return {
    apiOrigin: `http://api.github.test:${port}`,
    requests,
    resolve,
    close: async () => {
      await Promise.all([closeServer(api), closeServer(redirect)]);
    },
  };
}

function pullRoute(options: PullRouteOptions = {}): FixtureRoute {
  return (address, path, response, redirectOrigin) => {
    if (address === 'redirect') {
      if (path === PULL_PRIMARY) sendJson(response, 200, pullPayload());
      else sendNotFound(response);
      return;
    }
    if (path === PULL_PRIMARY) {
      if (options.primaryRateLimited === true) {
        sendRateLimit(response, 'primary rate limit body');
      } else if (options.redirectPrimary === true) {
        sendRedirect(response, `${redirectOrigin}${PULL_PRIMARY}`);
      } else {
        sendJson(response, 200, pullPayload());
      }
      return;
    }
    if (path === '/repos/o/r/issues/12/comments?per_page=100&page=1') {
      sendJson(response, 200, []);
      return;
    }
    if (
      path === PULL_REVIEWS ||
      path === PULL_REVIEW_COMMENTS ||
      path === PULL_FILES ||
      path === CHECK_RUNS
    ) {
      sendJson(
        response,
        200,
        path === CHECK_RUNS ? { total_count: 0, check_runs: [] } : [],
      );
      return;
    }
    sendNotFound(response);
  };
}

function testContext(policy: CompiledPolicy): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    productUserAgent: USER_AGENT,
    tenantDb: {
      runAs: () => Promise.reject(new Error('Database unavailable')),
    },
    permissionPolicy: policy,
  };
}

function githubConfig(token: string | undefined): GithubWebAdapterConfig {
  return token === undefined
    ? { id: 'github', use: 'github' }
    : { id: 'github', use: 'github', token };
}

async function dispatchGithub(
  fixture: GithubFixture,
  source: string,
  token: string | undefined,
  policy: CompiledPolicy,
): Promise<WebAdapterDispatch> {
  const context = testContext(policy);
  const admit = createDerivedAdmission(context);
  const session = createWebFetchSession(
    { userAgent: USER_AGENT },
    {
      fetch: undiciFetch,
      admit,
      admitAddress: createAddressAdmission(context),
      resolve: fixture.resolve,
    },
  );
  const io: WebAdapterIo = {
    fetch: async (url, init) => {
      if (admit('adapter', url).decision === 'reject') {
        return {
          type: 'permission_denied',
          message: 'The adapter target was refused by operator permissions.',
        };
      }
      return session.fetch(url, init);
    },
  };
  try {
    const adapter = createGithubAdapter(githubConfig(token), {
      apiOrigin: fixture.apiOrigin,
    });
    return await dispatchWebAdapters(new URL(source), [adapter], io);
  } finally {
    session.dispose();
  }
}

function expectProductHeaders(requests: ReadonlyArray<FixtureRequest>): void {
  for (const request of requests) {
    expect(request.method).toBe('GET');
    expect(request.accept).toBe(ACCEPT);
    expect(request.userAgent).toBe(USER_AGENT);
  }
}

describe('GitHub adapter over a real shared web session', () => {
  it('scopes a token to the API origin across a real redirect', async () => {
    const token = 'integration-secret-token';
    const fixture = await startGithubFixture(
      pullRoute({ redirectPrimary: true }),
    );
    try {
      const result = await dispatchGithub(
        fixture,
        PULL_SOURCE,
        token,
        ADMIT_ALL_POLICY,
      );
      expect(result.kind).toBe('rendered');
      if (result.kind !== 'rendered')
        throw new Error('Pull request did not render.');
      expect(result.render.content).toContain(
        '# Pull Request #12: A pull request',
      );
      expect(result.render.content).toContain('Reviews:');
      expect(result.render.content).toContain('Checks:');
      expect(result.render.content).toContain('Diff:');
      expect(JSON.stringify(result)).not.toContain(token);
      expect(
        fixture.requests.map(({ address, path }) => ({ address, path })),
      ).toEqual([
        { address: 'api', path: PULL_PRIMARY },
        { address: 'redirect', path: PULL_PRIMARY },
        { address: 'api', path: PULL_ISSUE_COMMENTS },
        { address: 'api', path: PULL_REVIEWS },
        { address: 'api', path: PULL_REVIEW_COMMENTS },
        { address: 'api', path: PULL_FILES },
        { address: 'api', path: CHECK_RUNS },
      ]);
      const apiRequests = fixture.requests.filter(
        ({ address }) => address === 'api',
      );
      const redirectRequests = fixture.requests.filter(
        ({ address }) => address === 'redirect',
      );
      expect(
        apiRequests.every(
          ({ authorization }) => authorization === `Bearer ${token}`,
        ),
      ).toBe(true);
      expect(redirectRequests).toHaveLength(1);
      expect(redirectRequests[0]?.authorization).toBeUndefined();
      expectProductHeaders(fixture.requests);
    } finally {
      await fixture.close();
    }
  });

  it('falls through when the adapter API target is outside the source policy', async () => {
    const fixture = await startGithubFixture(pullRoute());
    try {
      const result = await dispatchGithub(
        fixture,
        PULL_SOURCE,
        undefined,
        SOURCE_ONLY_POLICY,
      );
      expect(result).toStrictEqual({
        kind: 'fallthrough',
        notes: ['web adapter "github" fell through: permission'],
      });
      expect(fixture.requests).toHaveLength(0);
    } finally {
      await fixture.close();
    }
  });

  it('falls through a primary rate limit without exposing its body', async () => {
    const fixture = await startGithubFixture(
      pullRoute({ primaryRateLimited: true }),
    );
    try {
      const result = await dispatchGithub(
        fixture,
        PULL_SOURCE,
        undefined,
        ADMIT_ALL_POLICY,
      );
      expect(result).toStrictEqual({
        kind: 'fallthrough',
        notes: [
          'web adapter "github" fell through: rate_limit, resets 1970-01-01T00:02:03.000Z',
        ],
      });
      expect(JSON.stringify(result)).not.toContain('primary rate limit body');
      expect(fixture.requests).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });
});
