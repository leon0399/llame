import { describe, expect, it } from 'vitest';

import type { WebFetchFailure, WebResponse } from '../../http-client';
import { MAX_ADAPTER_DOCUMENT_BYTES } from '../contract';
import { createGithubAdapter } from './adapter';
import {
  API_ORIGIN,
  config,
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from './test-io';

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

function blobResponse(content: string, size?: number): WebResponse {
  const bytes = Buffer.from(content);
  const encoded = bytes.toString('base64');
  const wrapped = encoded.match(/.{1,60}/gu)?.join('\n') ?? '';
  return response({
    content: wrapped,
    encoding: 'base64',
    size: size ?? bytes.byteLength,
  });
}

function treeResponse(entries: ReadonlyArray<JsonObject>): WebResponse {
  return response({ tree: entries });
}

async function readGithub(
  source: string,
  routes: ReadonlyMap<string, ReadonlyArray<Reply>>,
) {
  const run = scriptedIo(routes);
  const outcome = await createGithubAdapter(config(), {
    apiOrigin: API_ORIGIN,
  }).read(new URL(source), run.io);
  return { outcome, urls: run.requests.map(({ url }) => url) };
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
    const { outcome, urls } = await readGithub(
      'https://github.com/acme/project/blob/main/src/a.ts',
      new Map([[url, [blobResponse('one\ntwo\n')]]]),
    );

    expect(urls).toStrictEqual([url]);
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
      const { outcome } = await readGithub(
        'https://github.com/acme/project/blob/main/file.bin',
        new Map([[url, [response(payload)]]]),
      );

      expect(outcome).toStrictEqual({ kind: 'failed', failure: 'binary' });
    },
  );

  it('classifies a declared oversized blob before decoding', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/contents/large.bin?ref=main`;
    const { outcome } = await readGithub(
      'https://github.com/acme/project/blob/main/large.bin',
      new Map([
        [
          url,
          [
            response({
              content: Buffer.from('x').toString('base64'),
              encoding: 'base64',
              size: MAX_ADAPTER_DOCUMENT_BYTES + 1,
            }),
          ],
        ],
      ]),
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'too_large' });
  });

  it('resolves a slash branch in three requests and rejects feature-old', async () => {
    const initial = `${API_ORIGIN}/repos/acme/project/contents/foo/src/a.ts?ref=feature`;
    const lookup = `${API_ORIGIN}/repos/acme/project/git/matching-refs/heads/feature`;
    const retry = `${API_ORIGIN}/repos/acme/project/contents/src/a.ts?ref=feature%2Ffoo`;
    const { outcome, urls } = await readGithub(
      'https://github.com/acme/project/blob/feature/foo/src/a.ts',
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

    expect(urls).toStrictEqual([initial, lookup, retry]);
    expect(renderedContent(outcome)).toBe('branch');
  });

  it('tries tags after heads and resolves a slash tag in four requests', async () => {
    const initial = `${API_ORIGIN}/repos/acme/project/contents/foo/src/a.ts?ref=feature`;
    const heads = `${API_ORIGIN}/repos/acme/project/git/matching-refs/heads/feature`;
    const tags = `${API_ORIGIN}/repos/acme/project/git/matching-refs/tags/feature`;
    const retry = `${API_ORIGIN}/repos/acme/project/contents/src/a.ts?ref=feature%2Ffoo`;
    const { outcome, urls } = await readGithub(
      'https://github.com/acme/project/blob/feature/foo/src/a.ts',
      new Map([
        [initial, [failure(404)]],
        [heads, [response([{ ref: 'refs/heads/feature-old' }])]],
        [tags, [response([{ ref: 'refs/tags/feature/foo' }])]],
        [retry, [blobResponse('tag')]],
      ]),
    );

    expect(urls).toStrictEqual([initial, heads, tags, retry]);
    expect(renderedContent(outcome)).toBe('tag');
  });
  it('keeps the first successful ref when a tag shadows a branch', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/contents/x/README.md?ref=v1`;
    const { outcome, urls } = await readGithub(
      'https://github.com/acme/project/blob/v1/x/README.md',
      new Map([[url, [blobResponse('tag wins')]]]),
    );

    expect(urls).toStrictEqual([url]);
    expect(renderedContent(outcome)).toBe('tag wins');
  });

  it('uses a forty-character SHA without matching-ref lookups', async () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const url = `${API_ORIGIN}/repos/acme/project/contents/file.ts?ref=${sha}`;
    const { outcome, urls } = await readGithub(
      `https://github.com/acme/project/blob/${sha}/file.ts`,
      new Map([[url, [blobResponse('sha')]]]),
    );

    expect(urls).toStrictEqual([url]);
    expect(renderedContent(outcome)).toBe('sha');
  });

  it('returns status when a tree ref has no path left to split', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/git/trees/main?recursive=1`;
    const { outcome } = await readGithub(
      'https://github.com/acme/project/tree/main',
      new Map([[url, [failure(404)]]]),
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'status' });
  });

  it('fetches a tree once and passes relative entries to the renderer', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/git/trees/main:apps?recursive=1`;
    const { outcome, urls } = await readGithub(
      'https://github.com/acme/project/tree/main/apps',
      new Map([
        [
          url,
          [
            treeResponse([
              { path: 'api', type: 'tree' },
              { path: 'api/main.ts', type: 'blob' },
              { path: 'readme.md', type: 'blob' },
            ]),
          ],
        ],
      ]),
    );

    expect(urls).toStrictEqual([url]);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      content: '',
      directory: {
        displayPath: 'https://github.com/acme/project/tree/main/apps',
        entries: [
          {
            name: 'api',
            kind: 'directory',
            children: [{ name: 'main.ts', kind: 'file' }],
          },
          { name: 'readme.md', kind: 'file' },
        ],
      },
    });
  });
  it('falls through when the tree response exceeds the body bound', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/git/trees/main?recursive=1`;
    const { outcome } = await readGithub(
      'https://github.com/acme/project/tree/main',
      new Map([
        [
          url,
          [
            {
              type: 'body_too_large',
              message: 'The response body exceeds the 5 MiB limit.',
            },
          ],
        ],
      ]),
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'too_large' });
  });
  it('fetches root metadata, tree, and README and notes a README failure', async () => {
    const repository = `${API_ORIGIN}/repos/acme/project`;
    const tree = `${repository}/git/trees/main?recursive=1`;
    const readme = `${repository}/readme`;
    const { outcome, urls } = await readGithub(
      'https://github.com/acme/project',
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

    expect(urls).toStrictEqual([repository, tree, readme]);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['README omitted: status'],
    });
    expect(renderedContent(outcome)).toContain('Description: A project');
    expect(renderedContent(outcome)).toContain(
      'https://github.com/acme/project\n  - src/',
    );
  });

  it('renders commit fields and pages every changed file', async () => {
    const sha = 'c91b31c0';
    const firstUrl = `${API_ORIGIN}/repos/acme/project/commits/${sha}?per_page=100&page=1`;
    const secondUrl = `${API_ORIGIN}/repos/acme/project/commits/${sha}?per_page=100&page=2`;
    const firstFiles = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/a-${index}.ts`,
      status: 'modified',
      additions: 2,
      deletions: 1,
      patch: '@@ hidden patch',
    }));
    const run = scriptedIo(
      new Map([
        [
          firstUrl,
          [
            response({
              sha,
              commit: {
                message: 'Fix it',
                author: { name: 'Alice', date: '2026-01-01T00:00:00Z' },
              },
              author: { login: 'alice' },
              files: firstFiles,
            }),
          ],
        ],
        [
          secondUrl,
          [
            response({
              files: [
                {
                  filename: 'src/last.ts',
                  status: 'added',
                  additions: 3,
                  deletions: 0,
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

    expect(run.requests.map(({ url }) => url)).toStrictEqual([
      firstUrl,
      secondUrl,
    ]);
    expect(renderedContent(outcome)).toContain('Fix it');
    expect(renderedContent(outcome)).toContain('Author: alice');
    expect(renderedContent(outcome)).toContain('Date: 2026-01-01T00:00:00Z');
    expect(renderedContent(outcome)).toContain('- src/last.ts (added, +3 -0)');
    expect(renderedContent(outcome)).toContain(
      'Diff: https://github.com/acme/project/commit/c91b31c0.diff',
    );
    expect(renderedContent(outcome)).not.toContain('hidden patch');
  });

  it('renders commit files and notes a later files failure', async () => {
    const sha = 'c91b31c0';
    const firstUrl = `${API_ORIGIN}/repos/acme/project/commits/${sha}?per_page=100&page=1`;
    const secondUrl = `${API_ORIGIN}/repos/acme/project/commits/${sha}?per_page=100&page=2`;
    const run = scriptedIo(
      new Map([
        [
          firstUrl,
          [
            response({
              sha,
              commit: {
                message: 'Fix it',
                author: { name: 'Alice', date: '2026-01-01T00:00:00Z' },
              },
              author: { login: 'alice' },
              files: Array.from({ length: 100 }, (_, index) => ({
                filename: `src/a-${index}.ts`,
                status: 'modified',
                additions: 2,
                deletions: 1,
              })),
            }),
          ],
        ],
        [secondUrl, [failure(500)]],
      ]),
    );

    const outcome = await createGithubAdapter(config(), {
      apiOrigin: API_ORIGIN,
    }).read(new URL(`https://github.com/acme/project/commit/${sha}`), run.io);

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['files omitted: status'],
    });
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
