import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  API_ORIGIN,
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import { createNpmAdapter } from './adapter';

const FILES_ORIGIN = 'http://127.0.0.1:43124/npm';
const adapter = createNpmAdapter(
  { id: 'npm', use: 'npm' },
  { registryOrigin: API_ORIGIN, filesOrigin: FILES_ORIGIN },
);
const MANIFEST_URL = `${API_ORIGIN}/@scope/pkg/latest`;
const TAGS_URL = `${API_ORIGIN}/-/package/@scope/pkg/dist-tags`;
const README_URL = `${FILES_ORIGIN}/@scope/pkg@1.2.3/README.md`;

const manifest: JsonObject = {
  name: '@scope/pkg',
  version: '1.2.3',
  description: 'A package',
  license: { type: 'MIT' },
  homepage: 'https://example.com/pkg',
  repository: { type: 'git', url: 'git+ssh://git@github.com/o/pkg.git' },
  deprecated: 'use other-pkg',
  engines: { node: '>=22' },
  dependencies: { a: '^1.0.0', b: '~2.1.0' },
  peerDependencies: { react: '>=18' },
  maintainers: [
    { name: 'alice', email: 'a@example.com' },
    'bob',
    { email: 'nameless@example.com' },
  ],
  dist: {
    tarball: 'https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz',
    integrity: 'sha512-abc',
  },
};

const readme = {
  finalUrl: README_URL,
  contentType: 'text/markdown',
  body: '# pkg\n\nUsage text\n',
};

async function read(source: string, routes: ReadonlyArray<[string, Reply]>) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, requests: run.requests };
}

describe('npm adapter claim', () => {
  it.each([
    'https://www.npmjs.com/package/react',
    'https://npmjs.com/package/@scope/pkg',
    'https://www.npmjs.com/package/@scope/pkg/v/1.2.3-beta.1+build',
    'https://www.npmjs.com/package/JSONStream?activeTab=readme',
    'https://www.npmjs.com/package/%40scope%2Fpkg',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://www.npmjs.com/package/react',
    'https://registry.npmjs.org/react',
    'https://www.npmjs.com/package/react/',
    'https://www.npmjs.com/package/react/v/',
    'https://www.npmjs.com/package/.hidden',
    'https://www.npmjs.com/package/@Scope/pkg',
    'https://www.npmjs.com/search?q=react',
    'https://www.npmjs.com/~alice',
    `https://www.npmjs.com/package/${'a'.repeat(215)}`,
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('npm adapter read', () => {
  it('renders the version manifest, dist-tags, and README', async () => {
    const { outcome, requests } = await read(
      'https://www.npmjs.com/package/@scope/pkg',
      [
        [MANIFEST_URL, response(manifest)],
        [TAGS_URL, response({ latest: '1.2.3', next: '2.0.0-rc.1' })],
        [README_URL, readme],
      ],
    );

    expect(requests).toStrictEqual([
      { url: MANIFEST_URL, init: { accept: 'application/json' } },
      { url: TAGS_URL, init: { accept: 'application/json' } },
      {
        url: README_URL,
        init: { accept: 'text/markdown, text/plain;q=0.9' },
      },
    ]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# @scope/pkg@1.2.3',
        '',
        'A package',
        '',
        'Deprecated: use other-pkg',
        'License: MIT',
        'Homepage: https://example.com/pkg',
        'Repository: https://github.com/o/pkg',
        'Dist-tags: latest 1.2.3, next 2.0.0-rc.1',
        'Engines: node >=22',
        'Dependencies: (2) a@^1.0.0, b@~2.1.0',
        'Peer dependencies: (1) react@>=18',
        'Maintainers: alice, bob',
        'Tarball: https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz',
        'URL: https://www.npmjs.com/package/@scope/pkg/v/1.2.3',
        '',
        '## README',
        '',
        '# pkg\n\nUsage text',
      ].join('\n'),
    });
  });

  it('requests the version in the URL', async () => {
    const pinned = `${API_ORIGIN}/@scope/pkg/1.0.0`;
    const notFound: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 404',
      httpStatus: 404,
    };

    const { outcome, requests } = await read(
      'https://www.npmjs.com/package/@scope/pkg/v/1.0.0',
      [[pinned, notFound]],
    );

    expect(requests.map(({ url }) => url)).toStrictEqual([pinned]);
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'status' });
  });

  it('keeps the manifest with notes when secondary sections fail', async () => {
    const missing: WebFetchFailure = {
      type: 'http_status',
      message: 'HTTP 404',
      httpStatus: 404,
    };

    const { outcome } = await read('https://www.npmjs.com/package/@scope/pkg', [
      [MANIFEST_URL, response({ name: '@scope/pkg', version: '1.2.3' })],
      [TAGS_URL, { ...response({}), body: '["not a map"]' }],
      [README_URL, missing],
    ]);

    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: ['readme omitted: status', 'dist-tags omitted: parse'],
      content: [
        '# @scope/pkg@1.2.3',
        '',
        'URL: https://www.npmjs.com/package/@scope/pkg/v/1.2.3',
      ].join('\n'),
    });
  });

  it('keeps what arrived when the call deadline passes during a section', async () => {
    const deadline: WebFetchFailure = { type: 'call_timeout', message: 'late' };

    const { outcome } = await read('https://www.npmjs.com/package/@scope/pkg', [
      [MANIFEST_URL, response({ name: '@scope/pkg', version: '1.2.3' })],
      [TAGS_URL, response({ latest: '1.2.3' })],
      [README_URL, deadline],
    ]);

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['readme omitted: transport'],
    });
  });

  it('renders legacy field shapes and skips unparsable optional fields', async () => {
    const { outcome } = await read('https://www.npmjs.com/package/@scope/pkg', [
      [
        MANIFEST_URL,
        response({
          name: '@scope/pkg',
          version: '1.2.3',
          engines: ['node', 'rhino'],
          license: 7,
          dependencies: ['not', 'a', 'map'],
        }),
      ],
      [TAGS_URL, response({ latest: '1.2.3' })],
      [README_URL, { ...readme, body: '' }],
    ]);

    expect(outcome).toMatchObject({
      kind: 'rendered',
      content: [
        '# @scope/pkg@1.2.3',
        '',
        'Dist-tags: latest 1.2.3',
        'Engines: node, rhino',
        'URL: https://www.npmjs.com/package/@scope/pkg/v/1.2.3',
      ].join('\n'),
    });
  });

  it('skips the README once the call deadline is spent', async () => {
    const deadline: WebFetchFailure = { type: 'call_timeout', message: 'late' };

    const { outcome, requests } = await read(
      'https://www.npmjs.com/package/@scope/pkg',
      [
        [MANIFEST_URL, response({ name: '@scope/pkg', version: '1.2.3' })],
        [TAGS_URL, deadline],
      ],
    );

    expect(requests).toHaveLength(2);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['dist-tags omitted: transport'],
    });
  });

  it('ends the call when a secondary request hits a call-ending failure', async () => {
    const aborted: WebFetchFailure = { type: 'aborted', message: 'aborted' };

    const { outcome, requests } = await read(
      'https://www.npmjs.com/package/@scope/pkg',
      [
        [MANIFEST_URL, response(manifest)],
        [TAGS_URL, aborted],
      ],
    );

    expect(outcome).toStrictEqual({
      kind: 'failed',
      failure: 'transport',
      fatal: aborted,
    });
    expect(requests).toHaveLength(2);
  });

  it('falls through on a malformed manifest', async () => {
    const { outcome } = await read('https://www.npmjs.com/package/@scope/pkg', [
      [MANIFEST_URL, response({ name: '@scope/pkg' })],
    ]);

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'parse' });
  });
});
