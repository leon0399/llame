import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  API_ORIGIN,
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import { createCratesAdapter } from './adapter';

const adapter = createCratesAdapter(
  { id: 'crates', use: 'crates' },
  { origin: API_ORIGIN },
);
const API = `${API_ORIGIN}/api/v1/crates/demo`;
const CRATE_URL = `${API}?include=default_version,keywords,categories,downloads`;
const NOT_FOUND: WebFetchFailure = {
  type: 'http_status',
  message: 'HTTP 404',
  httpStatus: 404,
};

function version(num: string, extra: JsonObject = {}): JsonObject {
  return { num, license: 'MIT', edition: '2021', ...extra };
}

const cratePage: JsonObject = {
  crate: {
    name: 'demo',
    description: 'A demo crate',
    default_version: '2.0.0',
    downloads: 12_345,
    recent_downloads: 678,
    repository: 'https://github.com/o/demo',
    keywords: ['demo'],
  },
  versions: [
    version('2.0.0', {
      rust_version: '1.70',
      features: { default: [], std: [] },
      created_at: '2026-01-01T00:00:00Z',
      published_by: { login: 'alice' },
    }),
  ],
};

function html(body: string): Reply {
  return {
    finalUrl: 'https://static.crates.io/readmes/demo/demo.html',
    contentType: 'text/html',
    body,
  };
}

async function read(source: string, routes: ReadonlyArray<[string, Reply]>) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, urls: run.requests.map(({ url }) => url) };
}

describe('crates.io adapter claim', () => {
  it.each([
    'https://crates.io/crates/serde',
    'https://crates.io/crates/serde_json/1.0.140',
    'https://crates.io/crates/tokio/1.0.0-alpha.1?tab=readme',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://crates.io/crates/serde',
    'https://www.crates.io/crates/serde',
    'https://crates.io/crates/serde/',
    'https://crates.io/crates/serde/versions',
    'https://crates.io/search?q=serde',
    'https://crates.io/crates/1serde',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('crates.io adapter read', () => {
  it('renders the default version with dependencies and README', async () => {
    const { outcome, urls } = await read('https://crates.io/crates/demo', [
      [CRATE_URL, response(cratePage)],
      [
        `${API}/2.0.0/dependencies`,
        response({
          dependencies: [
            { crate_id: 'serde', req: '^1', kind: 'normal', optional: true },
            { crate_id: 'cc', req: '^1.0', kind: 'build', optional: false },
            { crate_id: 'proptest', req: '^1', kind: 'dev', optional: false },
          ],
        }),
      ],
      [
        `${API}/2.0.0/readme`,
        html('<h1>Demo</h1><p>Use <code>demo</code>.</p>'),
      ],
    ]);

    expect(urls).toStrictEqual([
      CRATE_URL,
      `${API}/2.0.0/dependencies`,
      `${API}/2.0.0/readme`,
    ]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# demo 2.0.0',
        '',
        'A demo crate',
        '',
        'License: MIT',
        'Rust version: 1.70',
        'Edition: 2021',
        'Downloads: 12,345 (678 in the last 90 days)',
        'Repository: https://github.com/o/demo',
        'Keywords: demo',
        'Features: default, std',
        'Dependencies: (1) serde ^1 (optional)',
        'Build dependencies: (1) cc ^1.0',
        'Dev dependencies: (1) proptest ^1',
        'Published: 2026-01-01T00:00:00Z by alice',
        'URL: https://crates.io/crates/demo/2.0.0',
        '',
        '## README',
        '',
        '# Demo\n\nUse `demo`.',
      ].join('\n'),
    });
  });

  it('fetches a pinned version and names the default one', async () => {
    const { outcome, urls } = await read(
      'https://crates.io/crates/demo/1.0.0',
      [
        [CRATE_URL, response(cratePage)],
        [
          `${API}/1.0.0`,
          response({ version: version('1.0.0', { yanked: true }) }),
        ],
        [`${API}/1.0.0/dependencies`, NOT_FOUND],
        [`${API}/1.0.0/readme`, NOT_FOUND],
      ],
    );

    expect(urls[1]).toBe(`${API}/1.0.0`);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['dependencies omitted: status', 'readme omitted: status'],
    });
    const content = outcome.kind === 'rendered' ? outcome.content : '';
    expect(content).toContain('# demo 1.0.0');
    expect(content).toContain(
      'Yanked: yes\nLicense: MIT\nDefault version: 2.0.0',
    );
  });

  it('follows the canonical name after a differently spelled URL', async () => {
    const spelled = `${API_ORIGIN}/api/v1/crates/Demo-Crate?include=default_version,keywords,categories,downloads`;
    const canonical = `${API_ORIGIN}/api/v1/crates/demo_crate/2.0.0`;
    const page = {
      ...cratePage,
      crate: { name: 'demo_crate', default_version: '2.0.0' },
    };

    const { urls } = await read('https://crates.io/crates/Demo-Crate', [
      [spelled, response(page)],
      [`${canonical}/dependencies`, response({ dependencies: [] })],
      [`${canonical}/readme`, html('<p>Readme</p>')],
    ]);

    expect(urls).toStrictEqual([
      spelled,
      `${canonical}/dependencies`,
      `${canonical}/readme`,
    ]);
  });

  it('falls through for an unknown crate or version', async () => {
    await expect(
      read('https://crates.io/crates/demo', [[CRATE_URL, NOT_FOUND]]),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
    await expect(
      read('https://crates.io/crates/demo/9.9.9', [
        [CRATE_URL, response(cratePage)],
        [`${API}/9.9.9`, NOT_FOUND],
      ]),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
  });

  it('skips the README once the call deadline is spent', async () => {
    const deadline: WebFetchFailure = { type: 'call_timeout', message: 'late' };

    const { outcome, urls } = await read('https://crates.io/crates/demo', [
      [CRATE_URL, response(cratePage)],
      [`${API}/2.0.0/dependencies`, deadline],
    ]);

    expect(urls).toHaveLength(2);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['dependencies omitted: transport'],
    });
  });
});
