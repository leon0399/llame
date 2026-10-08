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

const REPO = `${API_ORIGIN}/repos/acme/project/releases`;
const HTML = 'https://github.com/acme/project/releases';
const TAG_SOURCE = `${HTML}/tag/v1.2.3`;
const LATEST_URL = `${REPO}/latest`;
const LIST_URL = `${REPO}?per_page=30`;

function release(extra: JsonObject = {}): JsonObject {
  return {
    tag_name: 'v1.2.3',
    name: 'Big release',
    html_url: TAG_SOURCE,
    draft: false,
    prerelease: false,
    published_at: '2026-01-02T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    author: { login: 'octocat' },
    body: '## What changed\n\n- a fix',
    assets: [
      {
        name: 'app-linux.tar.gz',
        size: 1_234_567,
        browser_download_url: `${HTML}/download/v1.2.3/app-linux.tar.gz`,
      },
      {
        name: 'checksums.txt',
        size: 98,
        browser_download_url: `${HTML}/download/v1.2.3/checksums.txt`,
      },
    ],
    ...extra,
  };
}

function entry(tag: string, extra: JsonObject = {}): JsonObject {
  return {
    tag_name: tag,
    name: tag,
    html_url: `${HTML}/tag/${tag}`,
    draft: false,
    prerelease: false,
    published_at: '2026-01-02T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    ...extra,
  };
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

async function readRelease(
  source: string,
  url: string,
  reply: Reply,
  token?: string,
) {
  const run = scriptedIo(new Map([[url, [reply]]]));
  const outcome = await createGithubAdapter(config(token), {
    apiOrigin: API_ORIGIN,
  }).read(new URL(source), run.io);
  return { outcome, requests: run.requests };
}

function contentOf(outcome: WebAdapterOutcome): string {
  if (outcome.kind !== 'rendered') throw new Error('expected a render');
  return outcome.content;
}

describe('GitHub release adapter', () => {
  it('renders a release by tag with its assets and Markdown notes', async () => {
    const { outcome, requests } = await readRelease(
      TAG_SOURCE,
      `${REPO}/tags/v1.2.3`,
      response(release()),
    );

    expect(requests).toStrictEqual([
      {
        url: `${REPO}/tags/v1.2.3`,
        init: { accept: 'application/vnd.github+json' },
      },
    ]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# Release v1.2.3: Big release',
        '',
        'Tag: v1.2.3',
        'Author: octocat',
        'Published: 2026-01-02T00:00:00Z',
        'Prerelease: false',
        'Draft: false',
        `URL: ${TAG_SOURCE}`,
        '',
        '## Assets (2)',
        `- app-linux.tar.gz — 1,234,567 bytes — ${HTML}/download/v1.2.3/app-linux.tar.gz`,
        `- checksums.txt — 98 bytes — ${HTML}/download/v1.2.3/checksums.txt`,
        '',
        '## Body',
        '',
        '## What changed',
        '',
        '- a fix',
      ].join('\n'),
    });
  });

  it('encodes each tag component and keeps the slashes, however the link spells them', async () => {
    const cases = [
      [`${HTML}/tag/%40scope/pkg%401.0.0`, '%40scope/pkg%401.0.0'],
      [`${HTML}/tag/%40scope%2Fpkg%401.0.0`, '%40scope/pkg%401.0.0'],
      [`${HTML}/tag/release%2F1.0`, 'release/1.0'],
      [`${HTML}/tag/v1.0%2B5%23x`, 'v1.0%2B5%23x'],
    ] as const;

    for (const [source, encoded] of cases) {
      const url = `${REPO}/tags/${encoded}`;
      const { requests } = await readRelease(source, url, response(release()));
      expect(requests.map((request) => request.url)).toStrictEqual([url]);
    }
  });

  it('reads the latest release and tolerates a missing name, author, body, and publish date', async () => {
    const { outcome, requests } = await readRelease(
      `${HTML}/latest`,
      LATEST_URL,
      response(
        release({
          name: null,
          draft: true,
          prerelease: true,
          published_at: null,
          author: null,
          body: null,
          assets: [],
        }),
      ),
    );

    expect(requests.map(({ url }) => url)).toStrictEqual([LATEST_URL]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# Release v1.2.3',
        '',
        'Tag: v1.2.3',
        'Author: ghost',
        'Prerelease: true',
        'Draft: true',
        `URL: ${TAG_SOURCE}`,
        '',
        '## Assets (0)',
        '',
        '## Body',
        '',
        'No release notes provided.',
      ].join('\n'),
    });
  });

  it('titles a release named after its tag by the tag alone', async () => {
    const { outcome } = await readRelease(
      `${HTML}/latest`,
      LATEST_URL,
      response(release({ name: 'v1.2.3' })),
    );

    expect(contentOf(outcome).split('\n')[0]).toBe('# Release v1.2.3');
  });

  it('lists the newest page with names, dates, and prerelease or draft marks', async () => {
    const { outcome, requests } = await readRelease(
      HTML,
      LIST_URL,
      response([
        entry('v2.0.0-rc.1', { prerelease: true }),
        entry('v1.2.3', { name: 'Big release' }),
        entry('v1.2.2', {
          name: null,
          draft: true,
          published_at: null,
          created_at: '2025-12-01T00:00:00Z',
        }),
      ]),
    );

    expect(requests.map(({ url }) => url)).toStrictEqual([LIST_URL]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# Releases: acme/project',
        '',
        `- v2.0.0-rc.1 — 2026-01-02T00:00:00Z — prerelease — ${HTML}/tag/v2.0.0-rc.1`,
        `- v1.2.3 — Big release — 2026-01-02T00:00:00Z — ${HTML}/tag/v1.2.3`,
        `- v1.2.2 — 2025-12-01T00:00:00Z — draft — ${HTML}/tag/v1.2.2`,
      ].join('\n'),
    });
  });

  it('notes a full page of 30 releases but not a short one, and says when there are none', async () => {
    const thirty = Array.from({ length: 30 }, (_, index) => entry(`v${index}`));
    const full = await readRelease(HTML, LIST_URL, response(thirty));
    const short = await readRelease(HTML, LIST_URL, response(thirty.slice(1)));
    const none = await readRelease(HTML, LIST_URL, response([]));

    expect(full.outcome).toMatchObject({
      kind: 'rendered',
      notes: ['releases truncated: the first 30 only'],
    });
    expect(short.outcome).toMatchObject({ kind: 'rendered', notes: [] });
    expect(contentOf(none.outcome)).toBe(
      '# Releases: acme/project\n\nNo releases.',
    );
  });

  it('sends the token only to the API origin', async () => {
    const { requests } = await readRelease(
      HTML,
      LIST_URL,
      response([]),
      'secret-value',
    );

    expect(requests[0]?.init).toStrictEqual({
      accept: 'application/vnd.github+json',
      authorization: { origin: API_ORIGIN, value: 'Bearer secret-value' },
    });
  });

  it('falls through on a status, a rate limit, a malformed payload, or a spent deadline', async () => {
    const tagUrl = `${REPO}/tags/v1.2.3`;
    await expect(
      readRelease(TAG_SOURCE, tagUrl, failure(404)),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
    await expect(
      readRelease(TAG_SOURCE, tagUrl, failure(429, { reset: '123' })),
    ).resolves.toMatchObject({
      outcome: {
        kind: 'failed',
        failure: 'rate_limit',
        reset: '1970-01-01T00:02:03.000Z',
      },
    });
    await expect(
      readRelease(TAG_SOURCE, tagUrl, response({ tag_name: 'v1.2.3' })),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
    await expect(
      readRelease(HTML, LIST_URL, response({ releases: [] })),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });

    const timeout: WebFetchFailure = {
      type: 'call_timeout',
      message: 'The web read exceeded its 30-second budget.',
    };
    await expect(readRelease(HTML, LIST_URL, timeout)).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'transport', fatal: timeout },
    });
  });
});
