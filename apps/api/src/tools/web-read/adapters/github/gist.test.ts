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

const ID = 'c2235dde4a25b46a2e00e168952bd0c0';
const SOURCE = `https://gist.github.com/octocat/${ID}`;
const GIST_URL = `${API_ORIGIN}/gists/${ID}`;

type GistFile = readonly [filename: string, entry: JsonObject];

function file(
  filename: string,
  content: string,
  extra: JsonObject = {},
): GistFile {
  return [
    filename,
    {
      filename,
      language: null,
      encoding: 'utf-8',
      truncated: false,
      content,
      ...extra,
    },
  ];
}

function gist(
  files: ReadonlyArray<GistFile>,
  extra: JsonObject = {},
): JsonObject {
  return {
    id: ID,
    html_url: SOURCE,
    public: true,
    description: 'Time zone lookup',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    owner: { login: 'octocat' },
    files: Object.fromEntries(files),
    truncated: false,
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

async function readGist(
  source: string,
  replies: ReadonlyArray<Reply>,
  options: { readonly token?: string; readonly url?: string } = {},
) {
  const run = scriptedIo(new Map([[options.url ?? GIST_URL, replies]]));
  const outcome = await createGithubAdapter(config(options.token), {
    apiOrigin: API_ORIGIN,
  }).read(new URL(source), run.io);
  return { outcome, requests: run.requests };
}

function contentOf(outcome: WebAdapterOutcome): string {
  if (outcome.kind !== 'rendered') throw new Error('expected a render');
  return outcome.content;
}

describe('GitHub gist adapter', () => {
  it('renders the description, owner, dates, and each file in a fenced block', async () => {
    const { outcome, requests } = await readGist(SOURCE, [
      response(
        gist([
          file('README.md', '# Title\n\n```sh\nls\n```\n', {
            language: 'Markdown',
          }),
          file('example.py', 'def f():\n\treturn 1\n', { language: 'Python' }),
          file('analysis.ipynb', '{}\n', { language: 'Jupyter Notebook' }),
          file('NOTES', 'no trailing newline'),
        ]),
      ),
    ]);

    expect(requests).toStrictEqual([
      { url: GIST_URL, init: { accept: 'application/vnd.github+json' } },
    ]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        `# Gist ${ID}`,
        '',
        'Description: Time zone lookup',
        'Owner: octocat',
        'Visibility: public',
        'Created: 2026-01-01T00:00:00Z',
        'Updated: 2026-01-02T00:00:00Z',
        `URL: ${SOURCE}`,
        '',
        '## README.md',
        '',
        '````Markdown',
        '# Title',
        '',
        '```sh',
        'ls',
        '```',
        '````',
        '',
        '## example.py',
        '',
        '```Python',
        'def f():',
        '\treturn 1',
        '```',
        '',
        '## analysis.ipynb',
        '',
        '```Jupyter-Notebook',
        '{}',
        '```',
        '',
        '## NOTES',
        '',
        '```',
        'no trailing newline',
        '```',
      ].join('\n'),
    });
  });

  it('reads an id-only link and a legacy numeric id through the same endpoint', async () => {
    const bare = await readGist(`https://gist.github.com/${ID}`, [
      response(gist([file('a.txt', 'x')])),
    ]);
    const numeric = await readGist(
      'https://gist.github.com/2059',
      [response(gist([file('a.txt', 'x')], { id: '2059' }))],
      { url: `${API_ORIGIN}/gists/2059` },
    );

    expect(bare.requests.map(({ url }) => url)).toStrictEqual([GIST_URL]);
    expect(numeric.requests.map(({ url }) => url)).toStrictEqual([
      `${API_ORIGIN}/gists/2059`,
    ]);
    expect(numeric.outcome).toMatchObject({ kind: 'rendered' });
  });

  it('sends the token only to the API origin', async () => {
    const { requests } = await readGist(
      SOURCE,
      [response(gist([file('a.txt', 'x')]))],
      { token: 'secret-value' },
    );

    expect(requests[0]?.init).toStrictEqual({
      accept: 'application/vnd.github+json',
      authorization: { origin: API_ORIGIN, value: 'Bearer secret-value' },
    });
  });

  it('keeps file text exact apart from one final newline', async () => {
    const { outcome } = await readGist(SOURCE, [
      response(
        gist([
          file('crlf.txt', 'a\r\nb\r\n'),
          file('blank.txt', 'a\n\n'),
          file('empty.txt', ''),
        ]),
      ),
    ]);

    expect(outcome.kind === 'rendered' && outcome.content).toContain(
      '## crlf.txt\n\n```\na\r\nb\n```\n\n## blank.txt\n\n```\na\n\n```\n\n## empty.txt\n\n```\n\n```',
    );
  });

  it('names a secret anonymous gist and drops an empty description', async () => {
    const secret = await readGist(SOURCE, [
      response(
        gist([file('a.txt', 'x')], {
          public: false,
          owner: null,
          description: null,
        }),
      ),
    ]);
    const spaced = await readGist(SOURCE, [
      response(gist([file('a.txt', 'x')], { description: '  \n ' })),
    ]);
    const multiline = await readGist(SOURCE, [
      response(gist([file('a.txt', 'x')], { description: 'one\n\n  two ' })),
    ]);

    expect(contentOf(secret.outcome)).toContain(
      'Owner: anonymous\nVisibility: secret',
    );
    expect(contentOf(secret.outcome)).not.toContain('Description:');
    expect(contentOf(spaced.outcome)).not.toContain('Description:');
    expect(contentOf(multiline.outcome)).toContain('Description: one two\n');
  });

  it('leaves out binary and budget-spent files and notes every cut', async () => {
    const { outcome } = await readGist(SOURCE, [
      response(
        gist(
          [
            file('part.txt', 'first part', { truncated: true }),
            file('spent.log', '', { truncated: true }),
            file('logo.png', 'iVBORw0KGgo=', { encoding: 'base64' }),
            file('ok.txt', 'whole'),
          ],
          { truncated: true },
        ),
      ),
    ]);

    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: [
        'part.txt truncated: the first part only',
        'spent.log omitted: too_large',
        'logo.png omitted: binary',
        'files truncated: the first 4 only',
      ],
    });
    const content = outcome.kind === 'rendered' ? outcome.content : '';
    expect(content).not.toContain('spent.log');
    expect(content).toContain('## part.txt\n\n```\nfirst part\n```');
    expect(content).toContain('## ok.txt');
    expect(content).not.toContain('logo.png');
    expect(content).not.toContain('iVBOR');
  });

  it('falls through on a status, a rate limit, a malformed payload, or a spent deadline', async () => {
    await expect(readGist(SOURCE, [failure(404)])).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
    await expect(
      readGist(SOURCE, [failure(403, { remaining: '0', reset: '123' })]),
    ).resolves.toMatchObject({
      outcome: {
        kind: 'failed',
        failure: 'rate_limit',
        reset: '1970-01-01T00:02:03.000Z',
      },
    });
    await expect(
      readGist(SOURCE, [response({ id: ID })]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
    await expect(
      readGist(SOURCE, [
        response(gist([file('a.txt', 'x')], { files: { 'a.txt': 'text' } })),
      ]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });

    const timeout: WebFetchFailure = {
      type: 'call_timeout',
      message: 'The web read exceeded its 30-second budget.',
    };
    await expect(readGist(SOURCE, [timeout])).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'transport', fatal: timeout },
    });
  });
});
