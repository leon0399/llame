import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  API_ORIGIN,
  config,
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import { createGithubAdapter } from './adapter';
import type { WebAdapterOutcome } from '../contract';

const SOURCE = 'https://github.com/acme/project/actions/runs/70/job/90';
const JOB_URL = `${API_ORIGIN}/repos/acme/project/actions/jobs/90`;
const LOGS_URL = `${JOB_URL}/logs`;
const RUN_URL = 'https://github.com/acme/project/actions/runs/70';
const TOKEN_INIT = {
  accept: 'application/vnd.github+json',
  authorization: { origin: API_ORIGIN, value: 'Bearer secret-value' },
};

function job(extra: JsonObject = {}): JsonObject {
  return {
    run_id: 70,
    run_attempt: 2,
    workflow_name: 'CI',
    head_branch: 'main',
    head_sha: 'abc123',
    html_url: SOURCE,
    status: 'completed',
    conclusion: 'failure',
    started_at: '2026-01-01T00:00:10Z',
    completed_at: '2026-01-01T00:02:00Z',
    name: 'build',
    labels: ['ubuntu-latest'],
    steps: [
      {
        number: 1,
        name: 'Set up job',
        status: 'completed',
        conclusion: 'success',
      },
      {
        number: 2,
        name: 'Run tests',
        status: 'completed',
        conclusion: 'failure',
      },
      {
        number: 4,
        name: 'Post cleanup',
        status: 'completed',
        conclusion: 'skipped',
      },
    ],
    ...extra,
  };
}

function text(body: string): Reply {
  return { finalUrl: LOGS_URL, contentType: 'text/plain', body };
}

function failure(
  httpStatus: number,
  rateLimit?: WebFetchFailure['rateLimit'],
): WebFetchFailure {
  const result: WebFetchFailure = {
    type: 'http_status',
    message: `HTTP ${httpStatus}`,
    httpStatus,
  };
  return rateLimit === undefined ? result : { ...result, rateLimit };
}

function numbered(count: number): string {
  return `${Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n')}\n`;
}

/** `token: null` reads without one. */
async function readJob(
  primary: Reply,
  logs: Reply | undefined,
  token: string | null = 'secret-value',
) {
  const routes = new Map<string, ReadonlyArray<Reply>>([[JOB_URL, [primary]]]);
  if (logs !== undefined) routes.set(LOGS_URL, [logs]);
  const run = scriptedIo(routes);
  const outcome = await createGithubAdapter(config(token ?? undefined), {
    apiOrigin: API_ORIGIN,
  }).read(new URL(SOURCE), run.io);
  return { outcome, requests: run.requests };
}

function contentOf(outcome: WebAdapterOutcome): string {
  if (outcome.kind !== 'rendered') throw new Error('expected a render');
  return outcome.content;
}

describe('GitHub job adapter', () => {
  it('renders the job, its steps, and the log with timestamps and color codes removed', async () => {
    const log = [
      '\uFEFF2026-01-01T00:00:10.1234567Z Current runner version: 2.1',
      '2026-01-01T00:00:11.0000000Z ##[group]Run npm test',
      '2026-01-01T00:00:11.0000001Z \u001b[36;1mnpm test\u001b[0m',
      '2026-01-01T00:00:12.0000000Z ##[endgroup]',
      '2026-01-01T00:00:13.0000000Z FAIL src/a.test.ts',
      '2026-01-01T00:00:14.0000000Z ##[error]Process completed with exit code 1.',
      '',
    ].join('\n');

    const { outcome, requests } = await readJob(response(job()), text(log));

    expect(requests).toStrictEqual([
      { url: JOB_URL, init: TOKEN_INIT },
      { url: LOGS_URL, init: TOKEN_INIT },
    ]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# Job 90: build',
        '',
        'Workflow: CI',
        'Status: completed',
        'Conclusion: failure',
        `Run: ${RUN_URL}`,
        'Attempt: 2',
        'Branch: main',
        'Commit: abc123',
        'Runner: ubuntu-latest',
        'Started: 2026-01-01T00:00:10Z',
        'Completed: 2026-01-01T00:02:00Z',
        `URL: ${SOURCE}`,
        '',
        '## Steps (3)',
        '- 1. Set up job — success',
        '- 2. Run tests — failure',
        '- 4. Post cleanup — skipped',
        '',
        '## Log (6 lines)',
        '',
        '```text',
        'Current runner version: 2.1',
        '##[group]Run npm test',
        'npm test',
        '##[endgroup]',
        'FAIL src/a.test.ts',
        '##[error]Process completed with exit code 1.',
        '```',
      ].join('\n'),
    });
  });

  it('renders the job without requesting its log when no token is configured', async () => {
    const { outcome, requests } = await readJob(
      response(job()),
      undefined,
      null,
    );

    expect(requests).toStrictEqual([
      { url: JOB_URL, init: { accept: 'application/vnd.github+json' } },
    ]);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['log omitted: token required'],
    });
    expect(contentOf(outcome)).toContain('## Steps (3)');
    expect(contentOf(outcome)).not.toContain('## Log');
  });

  it('keeps the last 400 lines of a longer log and says how many there were', async () => {
    const exact = await readJob(response(job()), text(numbered(400)));
    const over = await readJob(response(job()), text(numbered(401)));

    expect(exact.outcome).toMatchObject({ kind: 'rendered', notes: [] });
    expect(contentOf(exact.outcome)).toContain(
      '## Log (400 lines)\n\n```text\nline 1\nline 2\n',
    );
    expect(over.outcome).toMatchObject({
      kind: 'rendered',
      notes: ['log truncated: the last 400 of 401 lines'],
    });
    const content = contentOf(over.outcome);
    expect(content).toContain(
      '## Log (last 400 of 401 lines)\n\n```text\nline 2\nline 3\n',
    );
    expect(content).toContain('\nline 400\nline 401\n```');
    expect(content).not.toContain('line 1\n');
  });

  it('cleans every kind of log line and reads CRLF endings', async () => {
    const log = [
      '2026-01-01T00:00:00Z no fraction',
      '2026-01-01T00:00:00.123Z',
      '2026-01-01T00:00:00.1234567Z \u001b[31;1merror\u001b[0m: boom',
      'plain line without timestamp',
      '2026-01-01T00:00:00.1234567Z \u001b[2K\u001b[1Gprogress',
      'lone \u001b escape and \u001bX not csi',
      'at 2026-01-01T00:00:00Z inside',
      'x 2026-01-01T00:00:00Z',
    ].join('\r\n');

    const { outcome } = await readJob(response(job()), text(`${log}\r\n`));

    expect(contentOf(outcome)).toContain(
      [
        '## Log (8 lines)',
        '',
        '```text',
        'no fraction',
        '',
        'error: boom',
        'plain line without timestamp',
        'progress',
        'lone  escape and X not csi',
        'at 2026-01-01T00:00:00Z inside',
        'x 2026-01-01T00:00:00Z',
        '```',
      ].join('\n'),
    );
  });

  it('fences a log whose lines contain backtick runs', async () => {
    const { outcome } = await readJob(response(job()), text('echo ```\n'));

    expect(contentOf(outcome)).toContain('````text\necho ```\n````');
  });

  it.each([
    ['a status', failure(403), 'log omitted: status'],
    ['an expired log', failure(404), 'log omitted: status'],
    [
      'a rate limit',
      failure(403, { remaining: '0', reset: '123' }),
      'log omitted: rate_limit, resets 1970-01-01T00:02:03.000Z',
    ],
    [
      'a refused redirect target',
      {
        type: 'permission_denied',
        message: 'The redirect target was refused by operator permissions.',
      },
      'log omitted: permission',
    ],
    [
      'an oversized log',
      { type: 'body_too_large', message: 'The body is too large.' },
      'log omitted: too_large',
    ],
    [
      'a content type the read refuses',
      { type: 'unsupported_content_type', message: 'Unsupported type.' },
      'log omitted: content_type',
    ],
    [
      'a spent call deadline',
      {
        type: 'call_timeout',
        message: 'The web read exceeded its 30-second budget.',
      },
      'log omitted: transport',
    ],
  ] as const)(
    'keeps the job when the log fails with %s',
    async (_, reply, note) => {
      const { outcome } = await readJob(response(job()), reply);

      expect(outcome).toMatchObject({ kind: 'rendered', notes: [note] });
      expect(contentOf(outcome)).toContain('## Steps (3)');
      expect(contentOf(outcome)).not.toContain('## Log');
    },
  );

  it.each([
    {
      type: 'aborted',
      message: 'The web read was cancelled.',
    },
    {
      type: 'too_many_redirects',
      message: 'The server redirected too many times.',
    },
  ])('ends the read when the log request fails with $type', async (reply) => {
    const { outcome } = await readJob(response(job()), reply);

    expect(outcome).toStrictEqual({
      kind: 'failed',
      failure: 'transport',
      fatal: reply,
    });
  });

  it('falls through on a primary status, rate limit, or malformed payload', async () => {
    await expect(readJob(failure(404), undefined)).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
    await expect(
      readJob(failure(429, { reset: '123' }), undefined),
    ).resolves.toMatchObject({
      outcome: {
        kind: 'failed',
        failure: 'rate_limit',
        reset: '1970-01-01T00:02:03.000Z',
      },
    });
    await expect(
      readJob(response({ name: 'build' }), undefined),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
  });

  it('links the run the job reports rather than the one in the link', async () => {
    const { outcome } = await readJob(
      response(job({ run_id: 71 })),
      undefined,
      null,
    );

    expect(contentOf(outcome)).toContain(
      'Run: https://github.com/acme/project/actions/runs/71\n',
    );
  });

  it('renders a job that has not started with only the fields GitHub sent', async () => {
    const { outcome } = await readJob(
      response({
        run_id: 70,
        head_sha: 'abc123',
        html_url: SOURCE,
        status: 'queued',
        conclusion: null,
        name: 'build',
        labels: [],
        workflow_name: null,
        head_branch: null,
        started_at: null,
        completed_at: null,
      }),
      undefined,
      null,
    );
    const running = await readJob(
      response(
        job({
          steps: [
            {
              number: 3,
              name: 'Run tests',
              status: 'in_progress',
              conclusion: null,
            },
          ],
        }),
      ),
      undefined,
      null,
    );

    expect(contentOf(outcome)).toBe(
      [
        '# Job 90: build',
        '',
        'Status: queued',
        `Run: ${RUN_URL}`,
        'Commit: abc123',
        `URL: ${SOURCE}`,
        '',
        '## Steps (0)',
      ].join('\n'),
    );
    expect(contentOf(running.outcome)).toContain(
      '## Steps (1)\n- 3. Run tests — in_progress',
    );
  });
});
