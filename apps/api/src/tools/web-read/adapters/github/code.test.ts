import { describe, expect, it, vi } from 'vitest';

import type { WebFetchFailure, WebResponse } from '../../http-client';
import { MAX_ADAPTER_DOCUMENT_BYTES } from '../contract';
import { createGithubAdapter } from './adapter';
import { readGithubCode } from './code';
import {
  API_ORIGIN,
  config,
  response,
  scriptedIo,
  type JsonObject,
  type Reply,
} from '../../../../testing/github-test-io';
import { parseGithubBlob, parseGithubTree } from './code-payload';
import { parseFilesPage } from './payload';
import { requestJson } from './request';

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

function treeResponse(
  entries: ReadonlyArray<JsonObject>,
  truncated = false,
): WebResponse {
  return response({ tree: entries, truncated });
}
function changedFile(index: number): JsonObject {
  return {
    filename: `src/file-${index}.ts`,
    status: 'modified',
    additions: 1,
    deletions: 0,
  };
}

function commitPayload(files: ReadonlyArray<JsonObject>): JsonObject {
  return {
    sha: 'c91b31c012345678901234567890123456789012',
    commit: {
      message: 'Fix it',
      author: { name: 'Alice', date: '2026-01-01T00:00:00Z' },
    },
    author: { login: 'alice' },
    files,
  };
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
  it('parses directory payloads separately from malformed blobs', () => {
    expect(parseGithubBlob(JSON.stringify([{ name: 'src' }]))).toStrictEqual({
      kind: 'directory',
    });
    expect(parseGithubBlob('{')).toBeUndefined();
  });
  it('parses tree modes and GitHub truncation', () => {
    expect(
      parseGithubTree(
        JSON.stringify({
          tree: [{ path: 'link', mode: '120000', type: 'blob' }],
          truncated: true,
        }),
      ),
    ).toEqual({
      entries: [{ path: 'link', mode: '120000', type: 'blob' }],
      truncated: true,
    });
  });

  it('preserves renamed and ordinary files while parsing file pages', () => {
    expect(
      parseFilesPage(
        JSON.stringify([
          {
            filename: 'new.ts',
            status: 'renamed',
            additions: 2,
            deletions: 1,
            previous_filename: 'old.ts',
          },
          {
            filename: 'same.ts',
            status: 'modified',
            additions: 1,
            deletions: 0,
          },
        ]),
      ),
    ).toStrictEqual([
      {
        filename: 'new.ts',
        status: 'renamed',
        additions: 2,
        deletions: 1,
        previousFilename: 'old.ts',
      },
      { filename: 'same.ts', status: 'modified', additions: 1, deletions: 0 },
    ]);
  });

  it('does not fetch after a request context has halted', async () => {
    const halted = failure(500);
    const fetch = vi.fn(() => Promise.resolve(response({})));
    const result = await requestJson('https://api.github.test', {
      io: { fetch },
      init: {},
      apiOrigin: API_ORIGIN,
      notes: [],
      halted,
    });

    expect(result).toStrictEqual({ kind: 'failed', failure: halted });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts a blob declared exactly at the document size bound', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/contents/file.ts?ref=main`;
    const { outcome } = await readGithub(
      'https://github.com/acme/project/blob/main/file.ts',
      new Map([
        [
          url,
          [
            response({
              content: Buffer.from('x').toString('base64'),
              encoding: 'base64',
              size: MAX_ADAPTER_DOCUMENT_BYTES,
            }),
          ],
        ],
      ]),
    );

    expect(renderedContent(outcome)).toBe('x');
  });

  it('accepts an empty zero-sized blob', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/contents/empty.ts?ref=main`;
    const { outcome } = await readGithub(
      'https://github.com/acme/project/blob/main/empty.ts',
      new Map([
        [url, [response({ content: '', encoding: 'base64', size: 0 })]],
      ]),
    );

    expect(renderedContent(outcome)).toBe('');
  });

  it.each([
    { label: 'invalid length', content: 'A' },
    { label: 'invalid prefix', content: '!!QUJD' },
    { label: 'invalid suffix', content: 'QUJD!!' },
  ])('rejects base64 with an $label', async ({ content }) => {
    const url = `${API_ORIGIN}/repos/acme/project/contents/file.bin?ref=main`;
    const { outcome } = await readGithub(
      'https://github.com/acme/project/blob/main/file.bin',
      new Map([[url, [response({ content, encoding: 'base64' })]]]),
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'binary' });
  });
  it('ignores whitespace while decoding base64', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/contents/file.ts?ref=main`;
    const { outcome } = await readGithub(
      'https://github.com/acme/project/blob/main/file.ts',
      new Map([[url, [response({ content: 'QU\nJD', encoding: 'base64' })]]]),
    );

    expect(renderedContent(outcome)).toBe('ABC');
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
  it('tries tags when the heads lookup returns not found', async () => {
    const initial = `${API_ORIGIN}/repos/acme/project/contents/foo/src/a.ts?ref=feature`;
    const heads = `${API_ORIGIN}/repos/acme/project/git/matching-refs/heads/feature`;
    const tags = `${API_ORIGIN}/repos/acme/project/git/matching-refs/tags/feature`;
    const retry = `${API_ORIGIN}/repos/acme/project/contents/src/a.ts?ref=feature%2Ffoo`;
    const { outcome, urls } = await readGithub(
      'https://github.com/acme/project/blob/feature/foo/src/a.ts',
      new Map([
        [initial, [failure(404)]],
        [heads, [failure(404)]],
        [tags, [response([{ ref: 'refs/tags/feature/foo' }])]],
        [retry, [blobResponse('tag after 404')]],
      ]),
    );

    expect(urls).toStrictEqual([initial, heads, tags, retry]);
    expect(renderedContent(outcome)).toBe('tag after 404');
  });

  it('chooses the longest matching ref regardless of response order', async () => {
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
              { ref: 'refs/heads/feature/foo' },
              { ref: 'refs/heads/feature' },
            ]),
          ],
        ],
        [retry, [blobResponse('longest')]],
      ]),
    );

    expect(urls).toStrictEqual([initial, lookup, retry]);
    expect(renderedContent(outcome)).toBe('longest');
  });
  it('updates the longest ref after a shorter match', async () => {
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
              { ref: 'refs/heads/feature' },
              { ref: 'refs/heads/feature/foo' },
            ]),
          ],
        ],
        [retry, [blobResponse('longer')]],
      ]),
    );

    expect(urls).toStrictEqual([initial, lookup, retry]);
    expect(renderedContent(outcome)).toBe('longer');
  });

  it('ignores matching refs from another namespace', async () => {
    const initial = `${API_ORIGIN}/repos/acme/project/contents/src/a.ts?ref=feature`;
    const heads = `${API_ORIGIN}/repos/acme/project/git/matching-refs/heads/feature`;
    const tags = `${API_ORIGIN}/repos/acme/project/git/matching-refs/tags/feature`;
    const { outcome, urls } = await readGithub(
      'https://github.com/acme/project/blob/feature/src/a.ts',
      new Map([
        [initial, [failure(404), blobResponse('wrong namespace accepted')]],
        [heads, [response([{ ref: 'refs/other/feature' }])]],
        [tags, [failure(404)]],
      ]),
    );

    expect(urls).toStrictEqual([initial, heads, tags]);
    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'status' });
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
  it('notes a truncated tree listing', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/git/trees/main:apps?recursive=1`;
    const { outcome } = await readGithub(
      'https://github.com/acme/project/tree/main/apps',
      new Map([
        [url, [treeResponse([{ path: 'partial.ts', type: 'blob' }], true)]],
      ]),
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['tree truncated by GitHub: listing is partial'],
    });
  });

  it('encodes each tree path segment while preserving separators', async () => {
    const url = `${API_ORIGIN}/repos/acme/project/git/trees/main:src/nested?recursive=1`;
    const { outcome, urls } = await readGithub(
      'https://github.com/acme/project/tree/main/src/nested',
      new Map([[url, [treeResponse([])]]]),
    );

    expect(urls).toStrictEqual([url]);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      directory: { entries: [] },
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
  it('notes a truncated root tree', async () => {
    const repository = `${API_ORIGIN}/repos/acme/project`;
    const tree = `${repository}/git/trees/main?recursive=1`;
    const readme = `${repository}/readme`;
    const { outcome } = await readGithub(
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
        [tree, [treeResponse([{ path: 'src', type: 'tree' }], true)]],
        [readme, [blobResponse('README text')]],
      ]),
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['tree truncated by GitHub: listing is partial'],
    });
    expect(renderedContent(outcome)).toContain('  - src/');
  });

  it('notes an oversized root tree while retaining the README', async () => {
    const repository = `${API_ORIGIN}/repos/acme/project`;
    const tree = `${repository}/git/trees/main?recursive=1`;
    const readme = `${repository}/readme`;
    const entries = Array.from({ length: 10_001 }, (_, index) => ({
      path: `file-${index}`,
      type: 'blob',
    }));
    const { outcome } = await readGithub(
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
        [tree, [treeResponse(entries)]],
        [readme, [blobResponse('README text')]],
      ]),
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['tree omitted: too_large'],
    });
    expect(renderedContent(outcome)).toContain('Description: A project');
    expect(renderedContent(outcome)).toContain('## README\n\nREADME text');
    expect(renderedContent(outcome)).not.toContain('file-0');
  });

  it('notes a malformed tree while retaining a successful README', async () => {
    const repository = `${API_ORIGIN}/repos/acme/project`;
    const tree = `${repository}/git/trees/main?recursive=1`;
    const readme = `${repository}/readme`;
    const { outcome } = await readGithub(
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
        [tree, [response({ malformed: true })]],
        [readme, [blobResponse('README text')]],
      ]),
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['tree omitted: parse'],
    });
    expect(renderedContent(outcome)).toContain('## README\n\nREADME text');
    expect(renderedContent(outcome)).not.toContain('  -');
  });

  it('notes a failed tree request separately from a successful README', async () => {
    const repository = `${API_ORIGIN}/repos/acme/project`;
    const tree = `${repository}/git/trees/main?recursive=1`;
    const readme = `${repository}/readme`;
    const { outcome } = await readGithub(
      'https://github.com/acme/project',
      new Map([
        [
          repository,
          [
            response({
              description: null,
              default_branch: 'main',
              visibility: 'public',
              language: null,
            }),
          ],
        ],
        [tree, [failure(500)]],
        [readme, [blobResponse('README text')]],
      ]),
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['tree omitted: status'],
    });
  });

  it('notes an undecodable README payload', async () => {
    const repository = `${API_ORIGIN}/repos/acme/project`;
    const tree = `${repository}/git/trees/main?recursive=1`;
    const readme = `${repository}/readme`;
    const { outcome } = await readGithub(
      'https://github.com/acme/project',
      new Map([
        [
          repository,
          [
            response({
              description: null,
              default_branch: 'main',
              visibility: 'public',
              language: null,
            }),
          ],
        ],
        [tree, [treeResponse([])]],
        [
          readme,
          [
            response({
              content: Buffer.from('text').toString('base64'),
              encoding: 'none',
            }),
          ],
        ],
      ]),
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['README omitted: binary'],
    });
  });
  it('does not request another page for a short first commit page', async () => {
    const sha = 'c91b31c0';
    const firstUrl = `${API_ORIGIN}/repos/acme/project/commits/${sha}?per_page=100&page=1`;
    const { outcome, urls } = await readGithub(
      `https://github.com/acme/project/commit/${sha}`,
      new Map([[firstUrl, [response(commitPayload([changedFile(1)]))]]]),
    );

    expect(urls).toStrictEqual([firstUrl]);
    expect(renderedContent(outcome)).toContain('src/file-1.ts');
  });

  it('continues commit pagination after full pages until a short page', async () => {
    const sha = 'c91b31c0';
    const urls = [1, 2, 3].map(
      (page) =>
        `${API_ORIGIN}/repos/acme/project/commits/${sha}?per_page=100&page=${page}`,
    );
    const firstFiles = Array.from({ length: 100 }, (_, index) =>
      changedFile(index),
    );
    const secondFiles = Array.from({ length: 100 }, (_, index) =>
      changedFile(index + 100),
    );
    const { outcome, urls: requested } = await readGithub(
      `https://github.com/acme/project/commit/${sha}`,
      new Map([
        [urls[0], [response(commitPayload(firstFiles))]],
        [urls[1], [response({ files: secondFiles })]],
        [urls[2], [response({ files: [changedFile(200)] })]],
      ]),
    );

    expect(requested).toStrictEqual(urls);
    expect(renderedContent(outcome)).toContain('src/file-200.ts');
  });

  it('notes a malformed later commit file page', async () => {
    const sha = 'c91b31c0';
    const firstUrl = `${API_ORIGIN}/repos/acme/project/commits/${sha}?per_page=100&page=1`;
    const secondUrl = `${API_ORIGIN}/repos/acme/project/commits/${sha}?per_page=100&page=2`;
    const { outcome } = await readGithub(
      `https://github.com/acme/project/commit/${sha}`,
      new Map([
        [
          firstUrl,
          [
            response(
              commitPayload(
                Array.from({ length: 100 }, (_, index) => changedFile(index)),
              ),
            ),
          ],
        ],
        [secondUrl, [response({ malformed: true })]],
      ]),
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['files omitted: parse'],
    });
  });

  it('caps a commit at the maximum file count', async () => {
    const sha = 'c91b31c0';
    const urls = new Map<string, ReadonlyArray<Reply>>();
    for (let page = 1; page <= 30; page += 1) {
      const pageUrl = `${API_ORIGIN}/repos/acme/project/commits/${sha}?per_page=100&page=${page}`;
      const files = Array.from({ length: 100 }, (_, index) =>
        changedFile((page - 1) * 100 + index),
      );
      urls.set(
        pageUrl,
        page === 1 ? [response(commitPayload(files))] : [response({ files })],
      );
    }

    const { outcome, urls: requested } = await readGithub(
      `https://github.com/acme/project/commit/${sha}`,
      urls,
    );

    expect(requested).toHaveLength(30);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['files omitted: too_large'],
    });
  });

  it('truncates files when a page crosses the maximum count', async () => {
    const sha = 'c91b31c0';
    const urls = new Map<string, ReadonlyArray<Reply>>();
    for (let page = 1; page <= 30; page += 1) {
      const pageUrl = `${API_ORIGIN}/repos/acme/project/commits/${sha}?per_page=100&page=${page}`;
      const count = page === 30 ? 101 : 100;
      const files = Array.from({ length: count }, (_, index) =>
        changedFile((page - 1) * 100 + index),
      );
      urls.set(
        pageUrl,
        page === 1 ? [response(commitPayload(files))] : [response({ files })],
      );
    }

    const { outcome, urls: requested } = await readGithub(
      `https://github.com/acme/project/commit/${sha}`,
      urls,
    );

    expect(requested).toHaveLength(30);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['files omitted: too_large'],
    });
    expect(renderedContent(outcome)).not.toContain('src/file-3000.ts');
  });

  it('rejects a code target without a ref segment', async () => {
    const fetch = vi.fn(() => Promise.resolve(response({})));
    const outcome = await readGithubCode(
      { kind: 'blob', owner: 'acme', repo: 'project', segments: [] },
      {
        source: new URL('https://github.com/acme/project/blob/main/file.ts'),
        io: { fetch },
        apiOrigin: API_ORIGIN,
        init: {},
      },
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'parse' });
    expect(fetch).not.toHaveBeenCalled();
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
