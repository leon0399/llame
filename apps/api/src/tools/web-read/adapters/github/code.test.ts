import { describe, expect, it } from 'vitest';

import type {
  WebFetchFailure,
  WebRequestInit,
  WebResponse,
} from '../../http-client';
import type { WebAdapterIo } from '../contract';
import type { GithubWebAdapterConfig } from '../../../../instance-config/llame-config';
import { createGithubAdapter } from './adapter';

type Reply = WebResponse | WebFetchFailure;
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonObject
  | ReadonlyArray<JsonValue>;
type JsonObject = { readonly [key: string]: JsonValue };
type BlobWire = {
  readonly content: string;
  readonly encoding: string;
  readonly size?: number;
};
type ScriptedIo = {
  readonly io: WebAdapterIo;
  readonly requests: Array<{
    readonly url: string;
    readonly init: WebRequestInit | undefined;
  }>;
};

const API_ORIGIN = 'http://127.0.0.1:43123';
const MAX_BODY = 5 * 1024 * 1024;

function config(token?: string): GithubWebAdapterConfig {
  return token === undefined
    ? { id: 'github', use: 'github' }
    : { id: 'github', use: 'github', token };
}
function response(value: JsonValue | BlobWire): WebResponse {
  return {
    finalUrl: `${API_ORIGIN}/response`,
    contentType: 'application/json',
    body: JSON.stringify(value) ?? '',
  };
}

function failure(
  httpStatus: number,
  rateLimit?: WebFetchFailure['rateLimit'],
): WebFetchFailure {
  const result: WebFetchFailure = {
    type: 'http_status',
    message: `The server answered HTTP ${httpStatus}.`,
    httpStatus,
  };
  if (rateLimit !== undefined) return { ...result, rateLimit };
  return result;
}

function scriptedIo(
  routes: ReadonlyMap<string, ReadonlyArray<Reply>>,
): ScriptedIo {
  const requests: Array<{
    readonly url: string;
    readonly init: WebRequestInit | undefined;
  }> = [];
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

function blobResponse(content: string, size?: number): WebResponse {
  const bytes = Buffer.from(content);
  return response({
    content: bytes.toString('base64'),
    encoding: 'base64',
    size: size ?? bytes.byteLength,
  });
}

function treeResponse(entries: ReadonlyArray<JsonObject>): WebResponse {
  return response({ tree: entries });
}

function renderedContent(
  outcome: Awaited<ReturnType<ReturnType<typeof createGithubAdapter>['read']>>,
): string {
  if (outcome.kind !== 'rendered') throw new Error('expected rendered outcome');
  return outcome.content;
}

describe('GitHub code adapter', () => {
  it('fetches a blob once and preserves exact UTF-8 text', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/contents/src/a.ts?ref=main`;
    const run = scriptedIo(new Map([[url, [blobResponse('one\ntwo\n')]]]));

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(
      new URL('https://github.com/acme/project/blob/main/src/a.ts'),
      run.io,
    );

    expect(run.requests.map(({ url: requestUrl }) => requestUrl)).toStrictEqual(
      [url],
    );
    expect(renderedContent(outcome)).toBe('one\ntwo\n');
  });

  it.each([
    {
      label: 'NUL bytes',
      content: Buffer.from([0, 1, 2]).toString('base64'),
      encoding: 'base64',
    },
    {
      label: 'invalid UTF-8',
      content: Buffer.from([0xc3, 0x28]).toString('base64'),
      encoding: 'base64',
    },
    {
      label: 'encoding none',
      content: Buffer.from('text').toString('base64'),
      encoding: 'none',
    },
    { label: 'empty large content', content: '', encoding: 'base64', size: 1 },
  ])(
    'classifies $label blob content as binary',
    async ({ content, encoding, size }) => {
      const payload =
        size === undefined
          ? { content, encoding }
          : { content, encoding, size };
      const url = `${API_ORIGIN}/repos/acme/project/contents/file.bin?ref=main`;
      const run = scriptedIo(new Map([[url, [response(payload)]]]));

      const outcome = await createGithubAdapter(config(), {
        apiOrigin: API_ORIGIN,
      }).read(
        new URL('https://github.com/acme/project/blob/main/file.bin'),
        run.io,
      );

      expect(outcome).toStrictEqual({ kind: 'failed', failure: 'binary' });
    },
  );

  it('classifies a declared oversized blob before decoding', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/contents/large.bin?ref=main`;
    const run = scriptedIo(
      new Map([
        [
          url,
          [
            response({
              content: Buffer.from('x').toString('base64'),
              encoding: 'base64',
              size: MAX_BODY + 1,
            }),
          ],
        ],
      ]),
    );

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(
      new URL('https://github.com/acme/project/blob/main/large.bin'),
      run.io,
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'too_large' });
  });

  it('resolves a slash branch in three requests and rejects feature-old', async () => {
    const initial = `${API_ORIGIN}/repos/acme/project/contents/foo/src/a.ts?ref=feature`;
    const lookup = `${API_ORIGIN}/repos/acme/project/git/matching-refs/heads/feature`;
    const retry = `${API_ORIGIN}/repos/acme/project/contents/src/a.ts?ref=feature%2Ffoo`;
    const run = scriptedIo(
      new Map([
        [initial, [failure(404)]],
        [
          lookup,
          [
            response([
              { ref: 'refs/heads/feature-old' },
              { ref: 'refs/heads/feature/foo' },
            ]),
          ],
        ],
        [retry, [blobResponse('branch')]],
      ]),
    );

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(
      new URL('https://github.com/acme/project/blob/feature/foo/src/a.ts'),
      run.io,
    );

    expect(run.requests.map(({ url }) => url)).toStrictEqual([
      initial,
      lookup,
      retry,
    ]);
    expect(renderedContent(outcome)).toBe('branch');
  });

  it('tries tags after heads and resolves a slash tag in four requests', async () => {
    const initial = `${API_ORIGIN}/repos/acme/project/contents/foo/src/a.ts?ref=feature`;
    const heads = `${API_ORIGIN}/repos/acme/project/git/matching-refs/heads/feature`;
    const tags = `${API_ORIGIN}/repos/acme/project/git/matching-refs/tags/feature`;
    const retry = `${API_ORIGIN}/repos/acme/project/contents/src/a.ts?ref=feature%2Ffoo`;
    const run = scriptedIo(
      new Map([
        [initial, [failure(404)]],
        [heads, [response([{ ref: 'refs/heads/feature-old' }])]],
        [tags, [response([{ ref: 'refs/tags/feature/foo' }])]],
        [retry, [blobResponse('tag')]],
      ]),
    );

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(
      new URL('https://github.com/acme/project/blob/feature/foo/src/a.ts'),
      run.io,
    );

    expect(run.requests.map(({ url }) => url)).toStrictEqual([
      initial,
      heads,
      tags,
      retry,
    ]);
    expect(renderedContent(outcome)).toBe('tag');
  });

  it('keeps the first successful ref when a tag shadows a branch', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/contents/x/README.md?ref=v1`;
    const run = scriptedIo(new Map([[url, [blobResponse('tag wins')]]]));

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(
      new URL('https://github.com/acme/project/blob/v1/x/README.md'),
      run.io,
    );

    expect(run.requests.map(({ url: requestUrl }) => requestUrl)).toStrictEqual(
      [url],
    );
    expect(renderedContent(outcome)).toBe('tag wins');
  });

  it('uses a forty-character SHA without matching-ref lookups', async () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const url = `${API_ORIGIN}/repos/acme/project/contents/file.ts?ref=${sha}`;
    const run = scriptedIo(new Map([[url, [blobResponse('sha')]]]));

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(
      new URL(`https://github.com/acme/project/blob/${sha}/file.ts`),
      run.io,
    );

    expect(run.requests.map(({ url: requestUrl }) => requestUrl)).toStrictEqual(
      [url],
    );
    expect(renderedContent(outcome)).toBe('sha');
  });

  it('returns status when a tree ref has no path left to split', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/git/trees/main?recursive=1`;
    const run = scriptedIo(new Map([[url, [failure(404)]]]));

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL('https://github.com/acme/project/tree/main'), run.io);

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'status' });
  });

  it('fetches a tree once and passes stripped entries to the renderer', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/git/trees/main:apps?recursive=1`;
    const run = scriptedIo(
      new Map([
        [
          url,
          [
            treeResponse([
              { path: 'apps/api', type: 'tree' },
              { path: 'apps/api/main.ts', type: 'blob' },
              { path: 'apps/readme.md', type: 'blob' },
            ]),
          ],
        ],
      ]),
    );

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL('https://github.com/acme/project/tree/main/apps'), run.io);

    expect(run.requests.map(({ url: requestUrl }) => requestUrl)).toStrictEqual(
      [url],
    );
    expect(renderedContent(outcome)).toBe(
      'https://github.com/acme/project/tree/main/apps\n  - api/\n    - main.ts\n  - readme.md',
    );
  });

  it('fetches root metadata, tree, and README and notes a README failure', async () => {
    const repository = `${API_ORIGIN}/repos/acme/project`;
    const tree = `${repository}/git/trees/main?recursive=1`;
    const readme = `${repository}/readme`;
    const run = scriptedIo(
      new Map([
        [
          repository,
          [
            response({
              description: 'A project',
              default_branch: 'main',
              visibility: 'public',
              language: 'TypeScript',
            }),
          ],
        ],
        [
          tree,
          [
            treeResponse([
              { path: 'src', type: 'tree' },
              { path: 'src/index.ts', type: 'blob' },
            ]),
          ],
        ],
        [readme, [failure(404)]],
      ]),
    );

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL('https://github.com/acme/project'), run.io);

    expect(run.requests.map(({ url }) => url)).toStrictEqual([
      repository,
      tree,
      readme,
    ]);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['README omitted: status'],
    });
    expect(renderedContent(outcome)).toContain('Description: A project');
    expect(renderedContent(outcome)).toContain(
      'https://github.com/acme/project\n  - src/',
    );
  });

  it('renders commit fields and a diff URL without patch text', async () => {
    const sha = 'c91b31c0';
    const url = `${API_ORIGIN}/repos/acme/project/commits/${sha}`;
    const run = scriptedIo(
      new Map([
        [
          url,
          [
            response({
              sha,
              commit: {
                message: 'Fix it',
                author: { name: 'Alice', date: '2026-01-01T00:00:00Z' },
              },
              author: { login: 'alice' },
              files: [
                {
                  filename: 'src/a.ts',
                  status: 'modified',
                  additions: 2,
                  deletions: 1,
                  patch: '@@ hidden patch',
                },
              ],
            }),
          ],
        ],
      ]),
    );

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL(`https://github.com/acme/project/commit/${sha}`), run.io);

    expect(renderedContent(outcome)).toContain('Fix it');
    expect(renderedContent(outcome)).toContain('Author: alice');
    expect(renderedContent(outcome)).toContain('Date: 2026-01-01T00:00:00Z');
    expect(renderedContent(outcome)).toContain('- src/a.ts (modified, +2 -1)');
    expect(renderedContent(outcome)).toContain(
      'Diff: https://github.com/acme/project/commit/c91b31c0.diff',
    );
    expect(renderedContent(outcome)).not.toContain('hidden patch');
  });

  it('classifies a primary rate limit and carries its reset', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/contents/file.ts?ref=main`;
    const run = scriptedIo(
      new Map([[url, [failure(403, { remaining: '0', reset: '123' })]]]),
    );

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(
      new URL('https://github.com/acme/project/blob/main/file.ts'),
      run.io,
    );

    expect(outcome).toStrictEqual({
      kind: 'failed',
      failure: 'rate_limit',
      reset: '1970-01-01T00:02:03.000Z',
    });
  });
});
