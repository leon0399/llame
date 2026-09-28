import { describe, expect, it } from 'vitest';

import type {
  WebFetchFailure,
  WebRequestInit,
  WebResponse,
} from '../../http-client';
import type { WebAdapterIo } from '../contract';
import { createGithubAdapter } from './adapter';
import type { GithubWebAdapterConfig } from '../../../../instance-config/llame-config';

type Reply = WebResponse | WebFetchFailure;
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonObject
  | Array<JsonValue>;
type JsonObject = { readonly [key: string]: JsonValue };
type RecordedRequest = {
  readonly url: string;
  readonly init: WebRequestInit | undefined;
};
type ScriptedIo = {
  readonly io: WebAdapterIo;
  readonly requests: Array<RecordedRequest>;
};

const API_ORIGIN = 'http://127.0.0.1:43123';
const ISSUE_SOURCE = 'https://github.com/acme/project/issues/12';
const PULL_SOURCE = 'https://github.com/acme/project/pull/12';

function config(token?: string): GithubWebAdapterConfig {
  return token === undefined
    ? { id: 'github', use: 'github' }
    : { id: 'github', use: 'github', token };
}

function response(value: JsonValue): WebResponse {
  return {
    finalUrl: `${API_ORIGIN}/response`,
    contentType: 'application/json',
    body: JSON.stringify(value),
  };
}

function scriptedIo(
  routes: ReadonlyMap<string, ReadonlyArray<Reply>>,
): ScriptedIo {
  const requests: Array<RecordedRequest> = [];
  const remaining = new Map(
    [...routes].map(([url, replies]) => [url, [...replies]]),
  );
  return {
    requests,
    io: {
      fetch: (url, init) => {
        requests.push({ url, init });
        const replies = remaining.get(url);
        if (replies === undefined || replies.length === 0) {
          throw new Error(`unexpected request ${url}`);
        }
        const reply = replies.shift();
        if (reply === undefined) throw new Error(`empty reply ${url}`);
        return Promise.resolve(reply);
      },
    },
  };
}
function issuePayload() {
  return {
    number: 12,
    title: 'An issue',
    state: 'open',
    state_reason: null,
    user: { login: 'alice' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    labels: [{ name: 'bug' }],
    html_url: ISSUE_SOURCE,
    body: 'Issue body',
  } satisfies JsonObject;
}

function pullPayload() {
  return {
    number: 12,
    title: 'A pull request',
    state: 'open',
    merged: false,
    draft: true,
    user: { login: 'alice' },
    base: { ref: 'main' },
    head: { ref: 'feature', sha: 'abc123' },
    mergeable_state: 'clean',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    labels: [{ name: 'enhancement' }],
    html_url: PULL_SOURCE,
    body: 'Pull body',
  } satisfies JsonObject;
}

function comment(id: number) {
  return {
    id,
    user: { login: `user-${id}` },
    created_at: '2026-01-03T00:00:00Z',
    html_url: `https://github.com/acme/project/issues/12#issuecomment-${id}`,
    body: `Comment ${id}`,
  } satisfies JsonObject;
}

function review(id: number, state = 'APPROVED') {
  return {
    id,
    user: { login: `reviewer-${id}` },
    submitted_at: '2026-01-03T00:00:00Z',
    state,
    html_url: `https://github.com/acme/project/pull/12#pullrequestreview-${id}`,
    body: `Review ${id}`,
  } satisfies JsonObject;
}

function reviewComment(id: number) {
  return {
    ...comment(id),
    path: 'src/app.ts',
    line: 7,
    side: 'RIGHT',
    in_reply_to_id: id - 1,
  } satisfies JsonObject;
}

function checkRun(name: string, status: string, conclusion: string | null) {
  return { name, status, conclusion } satisfies JsonObject;
}

function file() {
  return {
    filename: 'src/app.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
  } satisfies JsonObject;
}

function pullRoutes(
  overrides: ReadonlyMap<string, ReadonlyArray<Reply>> = new Map(),
): Map<string, ReadonlyArray<Reply>> {
  const routes = new Map<string, ReadonlyArray<Reply>>([
    [`${API_ORIGIN}/repos/acme/project/pulls/12`, [response(pullPayload())]],
    [
      `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=1`,
      [response([])],
    ],
    [
      `${API_ORIGIN}/repos/acme/project/pulls/12/reviews?per_page=100&page=1`,
      [response([])],
    ],
    [
      `${API_ORIGIN}/repos/acme/project/pulls/12/comments?per_page=100&page=1`,
      [response([])],
    ],
    [
      `${API_ORIGIN}/repos/acme/project/pulls/12/files?per_page=100&page=1`,
      [response([])],
    ],
    [
      `${API_ORIGIN}/repos/acme/project/commits/abc123/check-runs?filter=latest&per_page=100&page=1`,
      [response({ total_count: 0, check_runs: [] })],
    ],
  ]);
  for (const [url, replies] of overrides) routes.set(url, replies);
  return routes;
}

function malformedReviewRoutes(): Map<string, ReadonlyArray<Reply>> {
  const reviewsPage1 = `${API_ORIGIN}/repos/acme/project/pulls/12/reviews?per_page=100&page=1`;
  const reviewsPage2 = `${API_ORIGIN}/repos/acme/project/pulls/12/reviews?per_page=100&page=2`;
  return pullRoutes(
    new Map([
      [
        reviewsPage1,
        [
          response(
            Array.from({ length: 100 }, (_, index) => review(index + 1)),
          ),
        ],
      ],
      [reviewsPage2, [response({ malformed: true })]],
      [
        `${API_ORIGIN}/repos/acme/project/pulls/12/comments?per_page=100&page=1`,
        [response([reviewComment(5)])],
      ],
      [
        `${API_ORIGIN}/repos/acme/project/pulls/12/files?per_page=100&page=1`,
        [response([file()])],
      ],
      [
        `${API_ORIGIN}/repos/acme/project/commits/abc123/check-runs?filter=latest&per_page=100&page=1`,
        [
          response({
            total_count: 1,
            check_runs: [checkRun('lint', 'completed', 'success')],
          }),
        ],
      ],
    ]),
  );
}

describe('GitHub thread adapter', () => {
  it('matches only canonical public GitHub thread URLs', () => {
    const adapter = createGithubAdapter(config());
    const cases = [
      ['https://github.com/o/r/issues/1', true],
      ['https://github.com/o/r/pull/2', true],
      ['https://github.com/o/r/pull/2.diff', false],
      ['https://github.com/o/r/pull/2/files', false],
      ['https://github.com/o/r/issues', false],
      ['https://github.com/o/r/actions/runs/3', false],
      ['https://github.example.com/o/r/pull/2', false],
      ['https://www.github.com/o/r/pull/2', false],
    ] as const;

    for (const [source, expected] of cases) {
      expect(adapter.match(new URL(source))).toBe(expected);
    }
  });
  it('requests all three issue comment pages and renders every comment', async () => {
    const comments = [
      Array.from({ length: 100 }, (_, index) => comment(index + 1)),
      Array.from({ length: 100 }, (_, index) => comment(index + 101)),
      Array.from({ length: 30 }, (_, index) => comment(index + 201)),
    ];
    const routes = new Map<string, ReadonlyArray<Reply>>([
      [
        `${API_ORIGIN}/repos/acme/project/issues/12`,
        [response(issuePayload())],
      ],
      [
        `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=1`,
        [response(comments[0])],
      ],
      [
        `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=2`,
        [response(comments[1])],
      ],
      [
        `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=3`,
        [response(comments[2])],
      ],
    ]);
    const { io, requests } = scriptedIo(routes);
    const adapter = createGithubAdapter(config(), { apiOrigin: API_ORIGIN });

    const outcome = await adapter.read(new URL(ISSUE_SOURCE), io);

    expect(requests.map(({ url }) => url)).toStrictEqual([
      `${API_ORIGIN}/repos/acme/project/issues/12`,
      `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=1`,
      `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=2`,
      `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=3`,
    ]);
    expect(outcome).toMatchObject({ kind: 'rendered' });
    if (outcome.kind === 'rendered') {
      expect(outcome.content).toContain('## Comments (230)');
      expect(outcome.content).toContain('ID: 230');
      expect(outcome.content).toContain(
        'URL: https://github.com/acme/project/issues/12#issuecomment-230',
      );
    }
  });

  it('requests every pull section in order and includes review, check, and diff output', async () => {
    const routes = pullRoutes(
      new Map([
        [
          `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=1`,
          [response([comment(1)])],
        ],
        [
          `${API_ORIGIN}/repos/acme/project/pulls/12/reviews?per_page=100&page=1`,
          [response([review(1), review(2, 'CHANGES_REQUESTED')])],
        ],
        [
          `${API_ORIGIN}/repos/acme/project/pulls/12/comments?per_page=100&page=1`,
          [response([reviewComment(5)])],
        ],
        [
          `${API_ORIGIN}/repos/acme/project/pulls/12/files?per_page=100&page=1`,
          [
            response([
              {
                filename: 'src/app.ts',
                status: 'renamed',
                additions: 3,
                deletions: 1,
                previous_filename: 'src/old-app.ts',
              },
            ]),
          ],
        ],
        [
          `${API_ORIGIN}/repos/acme/project/commits/abc123/check-runs?filter=latest&per_page=100&page=1`,
          [response({ total_count: 0, check_runs: [] })],
        ],
      ]),
    );
    const { io, requests } = scriptedIo(routes);
    const adapter = createGithubAdapter(config(), { apiOrigin: API_ORIGIN });

    const outcome = await adapter.read(new URL(PULL_SOURCE), io);

    expect(requests.map(({ url }) => url)).toStrictEqual([
      `${API_ORIGIN}/repos/acme/project/pulls/12`,
      `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=1`,
      `${API_ORIGIN}/repos/acme/project/pulls/12/reviews?per_page=100&page=1`,
      `${API_ORIGIN}/repos/acme/project/pulls/12/comments?per_page=100&page=1`,
      `${API_ORIGIN}/repos/acme/project/pulls/12/files?per_page=100&page=1`,
      `${API_ORIGIN}/repos/acme/project/commits/abc123/check-runs?filter=latest&per_page=100&page=1`,
    ]);
    expect(outcome).toMatchObject({ kind: 'rendered' });
    if (outcome.kind === 'rendered') {
      expect(outcome.content).toContain(
        'Reviews: 1 approved, 1 changes requested (latest per reviewer)',
      );
      expect(outcome.content).toContain('Checks: none');
      expect(outcome.content).toContain(
        'Diff: https://github.com/acme/project/pull/12.diff',
      );
      expect(outcome.content).toContain('Reply to: 4');
      expect(outcome.content).toContain('Location: src/app.ts:7');
      expect(outcome.content).toContain('## Files (1)');
    }
  });

  it('sends a token only to the configured API origin and omits it when absent', async () => {
    const routes = new Map<string, ReadonlyArray<Reply>>([
      [
        `${API_ORIGIN}/repos/acme/project/issues/12`,
        [response(issuePayload())],
      ],
      [
        `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=1`,
        [response([])],
      ],
    ]);
    const tokenRun = scriptedIo(routes);
    await createGithubAdapter(config('secret-value'), {
      apiOrigin: API_ORIGIN,
    }).read(new URL(ISSUE_SOURCE), tokenRun.io);
    expect(tokenRun.requests[0]?.init).toStrictEqual({
      accept: 'application/vnd.github+json',
      authorization: { origin: API_ORIGIN, value: 'Bearer secret-value' },
    });

    const noTokenRun = scriptedIo(routes);
    await createGithubAdapter(config(), { apiOrigin: API_ORIGIN }).read(
      new URL(ISSUE_SOURCE),
      noTokenRun.io,
    );
    expect(noTokenRun.requests[0]?.init).toStrictEqual({
      accept: 'application/vnd.github+json',
    });
  });

  it('falls through on a primary status or rate-limit failure', async () => {
    const notFound = scriptedIo(
      new Map([
        [
          `${API_ORIGIN}/repos/acme/project/issues/12`,
          [
            {
              type: 'http_status',
              message: 'The server answered HTTP 404.',
              httpStatus: 404,
            },
          ],
        ],
      ]),
    );
    const rateLimited = scriptedIo(
      new Map([
        [
          `${API_ORIGIN}/repos/acme/project/issues/12`,
          [
            {
              type: 'http_status',
              message: 'The server answered HTTP 403.',
              httpStatus: 403,
              rateLimit: { remaining: '0', reset: '123' },
            },
          ],
        ],
      ]),
    );
    const adapter = createGithubAdapter(config(), { apiOrigin: API_ORIGIN });

    await expect(
      adapter.read(new URL(ISSUE_SOURCE), notFound.io),
    ).resolves.toStrictEqual({
      kind: 'failed',
      failure: 'status',
    });
    await expect(
      adapter.read(new URL(ISSUE_SOURCE), rateLimited.io),
    ).resolves.toStrictEqual({
      kind: 'failed',
      failure: 'rate_limit',
      reset: '1970-01-01T00:02:03.000Z',
    });
  });

  it('renders partial content and notes a secondary rate limit', async () => {
    const first = Array.from({ length: 100 }, (_, index) =>
      reviewComment(index + 1),
    );
    const second = Array.from({ length: 100 }, (_, index) =>
      reviewComment(index + 101),
    );
    const rateLimit: WebFetchFailure = {
      type: 'http_status',
      message: 'The server answered HTTP 403.',
      httpStatus: 403,
      rateLimit: { remaining: '0', reset: '123' },
    };
    const routes = pullRoutes(
      new Map([
        [
          `${API_ORIGIN}/repos/acme/project/pulls/12/comments?per_page=100&page=1`,
          [response(first)],
        ],
        [
          `${API_ORIGIN}/repos/acme/project/pulls/12/comments?per_page=100&page=2`,
          [response(second)],
        ],
        [
          `${API_ORIGIN}/repos/acme/project/pulls/12/comments?per_page=100&page=3`,
          [rateLimit],
        ],
        [
          `${API_ORIGIN}/repos/acme/project/pulls/12/files?per_page=100&page=1`,
          [
            response([
              {
                filename: 'README.md',
                status: 'modified',
                additions: 1,
                deletions: 0,
              },
            ]),
          ],
        ],
      ]),
    );
    const { io, requests } = scriptedIo(routes);
    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL(PULL_SOURCE), io);

    expect(requests.map(({ url }) => url)).toContain(
      `${API_ORIGIN}/repos/acme/project/pulls/12/files?per_page=100&page=1`,
    );
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: [
        'review comments omitted: rate_limit, resets 1970-01-01T00:02:03.000Z',
      ],
    });
    if (outcome.kind === 'rendered') {
      expect(outcome.content).toContain('## Review Comments (200)');
      expect(outcome.content).toContain('## Files (1)');
    }
  });

  it('reports check runs not loaded after a failed later page', async () => {
    const runs = [
      ...Array.from({ length: 98 }, (_, index) =>
        checkRun(`pass-${index}`, 'completed', 'success'),
      ),
      checkRun('lint', 'completed', 'failure'),
      checkRun('deploy', 'queued', null),
    ];
    const failedPage: WebFetchFailure = {
      type: 'http_status',
      message: 'The server answered HTTP 429.',
      httpStatus: 429,
      rateLimit: { reset: '123' },
    };
    const page1 = `${API_ORIGIN}/repos/acme/project/commits/abc123/check-runs?filter=latest&per_page=100&page=1`;
    const page2 = `${API_ORIGIN}/repos/acme/project/commits/abc123/check-runs?filter=latest&per_page=100&page=2`;
    const routes = pullRoutes(
      new Map([
        [page1, [response({ total_count: 140, check_runs: runs })]],
        [page2, [failedPage]],
      ]),
    );
    const { io } = scriptedIo(routes);

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL(PULL_SOURCE), io);

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: [
        'check runs omitted: rate_limit, resets 1970-01-01T00:02:03.000Z',
      ],
    });
    if (outcome.kind === 'rendered') {
      expect(outcome.content).toContain(
        'Checks: 98 passed, 1 failed (lint), 1 pending, 40 not loaded',
      );
    }
  });

  it('halts after a fatal secondary failure and notes skipped sections', async () => {
    const reviewsUrl = `${API_ORIGIN}/repos/acme/project/pulls/12/reviews?per_page=100&page=1`;
    const timeout: WebFetchFailure = {
      type: 'call_timeout',
      message: 'The web read exceeded its 30-second budget.',
    };
    const routes = pullRoutes(new Map([[reviewsUrl, [timeout]]]));
    const { io, requests } = scriptedIo(routes);

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL(PULL_SOURCE), io);

    expect(requests.map(({ url }) => url)).toStrictEqual([
      `${API_ORIGIN}/repos/acme/project/pulls/12`,
      `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=1`,
      reviewsUrl,
    ]);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: [
        'reviews omitted: transport',
        'review comments omitted: transport',
        'files omitted: transport',
        'check runs omitted: transport',
      ],
    });
    if (outcome.kind === 'rendered') {
      expect(outcome.content).toContain('Checks: unavailable');
    }
  });

  it('returns a fatal outcome when a secondary request is aborted', async () => {
    const reviewsUrl = `${API_ORIGIN}/repos/acme/project/pulls/12/reviews?per_page=100&page=1`;
    const aborted: WebFetchFailure = {
      type: 'aborted',
      message: 'The web read was cancelled.',
    };
    const routes = pullRoutes(new Map([[reviewsUrl, [aborted]]]));
    const { io, requests } = scriptedIo(routes);

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL(PULL_SOURCE), io);

    expect(requests.map(({ url }) => url)).toStrictEqual([
      `${API_ORIGIN}/repos/acme/project/pulls/12`,
      `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=1`,
      reviewsUrl,
    ]);
    expect(outcome).toStrictEqual({
      kind: 'failed',
      failure: 'transport',
      fatal: aborted,
    });
  });
  it('returns a fatal outcome when a later review page hits a redirect limit', async () => {
    const reviewsPage1 = `${API_ORIGIN}/repos/acme/project/pulls/12/reviews?per_page=100&page=1`;
    const reviewsPage2 = `${API_ORIGIN}/repos/acme/project/pulls/12/reviews?per_page=100&page=2`;
    const tooManyRedirects: WebFetchFailure = {
      type: 'too_many_redirects',
      message: 'The server redirected too many times.',
    };
    const routes = pullRoutes(
      new Map([
        [
          reviewsPage1,
          [
            response(
              Array.from({ length: 100 }, (_, index) => review(index + 1)),
            ),
          ],
        ],
        [reviewsPage2, [tooManyRedirects]],
      ]),
    );
    const { io, requests } = scriptedIo(routes);

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL(PULL_SOURCE), io);

    expect(requests.map(({ url }) => url)).toStrictEqual([
      `${API_ORIGIN}/repos/acme/project/pulls/12`,
      `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=1`,
      reviewsPage1,
      reviewsPage2,
    ]);
    expect(outcome).toStrictEqual({
      kind: 'failed',
      failure: 'transport',
      fatal: tooManyRedirects,
    });
  });

  it('continues loading other sections after a malformed later review page', async () => {
    const { io } = scriptedIo(malformedReviewRoutes());
    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL(PULL_SOURCE), io);

    expect(outcome).toMatchObject({ kind: 'rendered' });
    if (outcome.kind === 'rendered') {
      expect(outcome.notes).toStrictEqual(['reviews omitted: parse']);
      expect(outcome.content).toContain('## Review Comments (1)');
      expect(outcome.content).toContain('## Files (1)');
      expect(outcome.content).toContain('Checks: 1 passed');
    }
  });

  it('falls through when primary numbers differ without issuing secondary requests', async () => {
    const issuePrimary = `${API_ORIGIN}/repos/acme/project/issues/12`;
    const pullPrimary = `${API_ORIGIN}/repos/acme/project/pulls/12`;
    const issueRun = scriptedIo(
      new Map([[issuePrimary, [response({ ...issuePayload(), number: 13 })]]]),
    );
    const pullRun = scriptedIo(
      pullRoutes(
        new Map([[pullPrimary, [response({ ...pullPayload(), number: 13 })]]]),
      ),
    );
    const adapter = createGithubAdapter(config(), { apiOrigin: API_ORIGIN });

    await expect(
      adapter.read(new URL(ISSUE_SOURCE), issueRun.io),
    ).resolves.toStrictEqual({ kind: 'failed', failure: 'parse' });
    await expect(
      adapter.read(new URL(PULL_SOURCE), pullRun.io),
    ).resolves.toStrictEqual({ kind: 'failed', failure: 'parse' });
    expect(issueRun.requests.map(({ url }) => url)).toStrictEqual([
      issuePrimary,
    ]);
    expect(pullRun.requests.map(({ url }) => url)).toStrictEqual([pullPrimary]);
  });

  it('reports loaded checks and the remainder after a malformed later page', async () => {
    const page1 = `${API_ORIGIN}/repos/acme/project/commits/abc123/check-runs?filter=latest&per_page=100&page=1`;
    const page2 = `${API_ORIGIN}/repos/acme/project/commits/abc123/check-runs?filter=latest&per_page=100&page=2`;
    const runs = Array.from({ length: 100 }, (_, index) =>
      checkRun(`pass-${index}`, 'completed', 'success'),
    );
    const routes = pullRoutes(
      new Map([
        [page1, [response({ total_count: 140, check_runs: runs })]],
        [page2, [response({ total_count: 140, check_runs: [{ bad: true }] })]],
      ]),
    );
    const { io } = scriptedIo(routes);

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL(PULL_SOURCE), io);

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['check runs omitted: parse'],
    });
    if (outcome.kind === 'rendered') {
      expect(outcome.content).toContain('Checks: 100 passed, 40 not loaded');
    }
  });

  it('renders checks unavailable when the first page fails or is malformed', async () => {
    const failedPage: WebFetchFailure = {
      type: 'http_status',
      message: 'The server answered HTTP 500.',
      httpStatus: 500,
    };
    const checksUrl = `${API_ORIGIN}/repos/acme/project/commits/abc123/check-runs?filter=latest&per_page=100&page=1`;
    const failedRoutes = pullRoutes(new Map([[checksUrl, [failedPage]]]));
    const malformedRoutes = pullRoutes(
      new Map([[checksUrl, [response({ check_runs: [] })]]]),
    );
    const failedIo = scriptedIo(failedRoutes);
    const malformedIo = scriptedIo(malformedRoutes);
    const adapter = createGithubAdapter(config(), { apiOrigin: API_ORIGIN });

    const failed = await adapter.read(new URL(PULL_SOURCE), failedIo.io);
    const malformed = await adapter.read(new URL(PULL_SOURCE), malformedIo.io);

    expect(failed).toMatchObject({
      kind: 'rendered',
      notes: ['check runs omitted: status'],
    });
    expect(malformed).toMatchObject({
      kind: 'rendered',
      notes: ['check runs omitted: parse'],
    });
    if (failed.kind === 'rendered' && malformed.kind === 'rendered') {
      expect(failed.content).toContain('Checks: unavailable');
      expect(malformed.content).toContain('Checks: unavailable');
    }
  });

  it('normalizes null GitHub users to the ghost author', async () => {
    const commentsUrl = `${API_ORIGIN}/repos/acme/project/issues/12/comments?per_page=100&page=1`;
    const routes = new Map<string, ReadonlyArray<Reply>>([
      [
        `${API_ORIGIN}/repos/acme/project/issues/12`,
        [response({ ...issuePayload(), user: null })],
      ],
      [commentsUrl, [response([{ ...comment(1), user: null }])]],
    ]);
    const { io } = scriptedIo(routes);

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL(ISSUE_SOURCE), io);

    expect(outcome).toMatchObject({ kind: 'rendered' });
    if (outcome.kind === 'rendered') {
      expect(outcome.content).toContain('Author: ghost');
      expect(outcome.content).toContain('### ghost · 2026-01-03T00:00:00Z');
    }
  });

  it('turns malformed primary JSON into a parse fallthrough', async () => {
    const routes = new Map<string, ReadonlyArray<Reply>>([
      [
        `${API_ORIGIN}/repos/acme/project/issues/12`,
        [response({ number: 12, title: 'missing required fields' })],
      ],
    ]);
    const { io } = scriptedIo(routes);

    await expect(
      createGithubAdapter(config(), { apiOrigin: API_ORIGIN }).read(
        new URL(ISSUE_SOURCE),
        io,
      ),
    ).resolves.toStrictEqual({ kind: 'failed', failure: 'parse' });
  });

  it('claims repository-code shapes through the same native adapter', () => {
    const adapter = createGithubAdapter(config(), { apiOrigin: API_ORIGIN });

    expect(adapter.match(new URL('https://github.com/acme/project'))).toBe(
      true,
    );
    expect(
      adapter.match(new URL('https://github.com/acme/project/tree/main/src')),
    ).toBe(true);
    expect(
      adapter.match(
        new URL('https://github.com/acme/project/blob/main/src/a.ts'),
      ),
    ).toBe(true);
    expect(
      adapter.match(new URL('https://github.com/acme/project/commit/c91b31c')),
    ).toBe(true);
    expect(
      adapter.match(new URL('https://github.com/acme/project/pull/12.diff')),
    ).toBe(false);
  });
});
