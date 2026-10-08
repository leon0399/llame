import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  API_ORIGIN,
  response,
  scriptedIo,
  type Reply,
} from '../../../../testing/github-test-io';
import { createHuggingfaceAdapter } from './adapter';

const adapter = createHuggingfaceAdapter(
  { id: 'hf', use: 'huggingface' },
  { origin: API_ORIGIN },
);
const SHARED =
  'expand[]=cardData&expand[]=createdAt&expand[]=lastModified&expand[]=likes&expand[]=sha&expand[]=tags';
const MODEL_URL = `${API_ORIGIN}/api/models/org/model?${SHARED}&expand[]=library_name&expand[]=pipeline_tag&expand[]=downloads&expand[]=gated&expand[]=safetensors`;
const MODEL_README = `${API_ORIGIN}/org/model/raw/abc123/README.md`;
const NOT_FOUND: WebFetchFailure = {
  type: 'http_status',
  message: 'HTTP 401',
  httpStatus: 401,
};

function markdown(body: string): Reply {
  return { finalUrl: MODEL_README, contentType: 'text/plain', body };
}

async function read(source: string, routes: ReadonlyArray<[string, Reply]>) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, requests: run.requests };
}

describe('Hugging Face adapter claim', () => {
  it.each([
    'https://huggingface.co/org/model',
    'https://huggingface.co/datasets/org/set?row=3',
    'https://huggingface.co/spaces/org/app',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://huggingface.co/org/model',
    'https://hf.co/org/model',
    'https://huggingface.co/gpt2',
    'https://huggingface.co/org/model/',
    'https://huggingface.co/org/model/tree/main',
    'https://huggingface.co/docs/transformers',
    'https://huggingface.co/blog/some-post',
    'https://huggingface.co/papers/2412.19437',
    'https://huggingface.co/datasets/org',
    'https://huggingface.co/meta-llama/models',
    'https://huggingface.co/search/full-text',
    'https://huggingface.co/hardware/a100',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('Hugging Face adapter read', () => {
  it('renders model metadata and the card without its front matter', async () => {
    const { outcome, requests } = await read(
      'https://huggingface.co/org/model',
      [
        [
          MODEL_URL,
          response({
            id: 'org/model',
            sha: 'abc123',
            gated: 'manual',
            likes: 1200,
            downloads: 34_567,
            tags: ['transformers', 'license:mit'],
            createdAt: '2026-01-01T00:00:00.000Z',
            lastModified: '2026-02-01T00:00:00.000Z',
            library_name: 'transformers',
            pipeline_tag: 'text-generation',
            safetensors: { total: 8_030_261_248 },
            cardData: { license: 'mit' },
          }),
        ],
        [
          MODEL_README,
          markdown('---\nlicense: mit\n---\n# Model\n\nUse it.\n'),
        ],
      ],
    );

    expect(requests.map(({ init }) => init)).toStrictEqual([
      { accept: 'application/json' },
      { accept: 'text/markdown, text/plain;q=0.9' },
    ]);
    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# org/model',
        '',
        'Kind: Model · text-generation · transformers',
        'License: mit',
        'Gated: manual',
        'Parameters: 8,030,261,248',
        'Downloads (last 30 days): 34,567',
        'Likes: 1,200',
        'Tags: transformers, license:mit',
        'Created: 2026-01-01T00:00:00.000Z',
        'Updated: 2026-02-01T00:00:00.000Z',
        'Revision: abc123',
        'URL: https://huggingface.co/org/model',
        '',
        '## README',
        '',
        '# Model\n\nUse it.',
      ].join('\n'),
    });
  });

  it('reads a Space with its own fields and keeps it without a README', async () => {
    const spaceUrl = `${API_ORIGIN}/api/spaces/org/app?${SHARED}&expand[]=sdk`;
    const readmeUrl = `${API_ORIGIN}/spaces/org/app/raw/main/README.md`;

    const { outcome } = await read('https://huggingface.co/spaces/org/app', [
      [spaceUrl, response({ id: 'org/app', sdk: 'gradio', gated: false })],
      [readmeUrl, NOT_FOUND],
    ]);

    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: ['readme omitted: status'],
      content: [
        '# org/app',
        '',
        'Kind: Space',
        'SDK: gradio',
        'URL: https://huggingface.co/spaces/org/app',
      ].join('\n'),
    });
  });

  it('reads a dataset at the dataset API and page paths', async () => {
    const setUrl = `${API_ORIGIN}/api/datasets/org/set?${SHARED}&expand[]=downloads&expand[]=gated`;
    const readmeUrl = `${API_ORIGIN}/datasets/org/set/raw/s1/README.md`;

    const { outcome, requests } = await read(
      'https://huggingface.co/datasets/org/set',
      [
        [
          setUrl,
          response({
            id: 'org/set',
            sha: 's1',
            cardData: { license: ['a', 'b'] },
          }),
        ],
        [readmeUrl, markdown('Rows.')],
      ],
    );

    expect(requests.map(({ url }) => url)).toStrictEqual([setUrl, readmeUrl]);
    expect(outcome).toMatchObject({ kind: 'rendered' });
    expect(outcome.kind === 'rendered' && outcome.content).toContain(
      'Kind: Dataset\nLicense: a, b\nRevision: s1\nURL: https://huggingface.co/datasets/org/set',
    );
  });

  it('treats null metadata as absent and strips loosely spaced front matter', async () => {
    const { outcome } = await read('https://huggingface.co/org/model', [
      [
        MODEL_URL,
        response({
          id: 'org/model',
          sha: 'abc123',
          pipeline_tag: null,
          library_name: null,
          safetensors: null,
          cardData: null,
          gated: false,
        }),
      ],
      [MODEL_README, markdown('\n---\nlicense: mit\n---  ')],
    ]);

    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        '# org/model',
        '',
        'Kind: Model',
        'Revision: abc123',
        'URL: https://huggingface.co/org/model',
      ].join('\n'),
    });
  });

  it('falls through when the repository is missing or the payload is malformed', async () => {
    await expect(
      read('https://huggingface.co/org/model', [[MODEL_URL, NOT_FOUND]]),
    ).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
    await expect(
      read('https://huggingface.co/org/model', [
        [MODEL_URL, response({ sha: 'x' })],
      ]),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
  });

  it('ends the call when the README request hits a call-ending failure', async () => {
    const aborted: WebFetchFailure = { type: 'aborted', message: 'aborted' };

    const { outcome } = await read('https://huggingface.co/org/model', [
      [MODEL_URL, response({ id: 'org/model', sha: 'abc123' })],
      [MODEL_README, aborted],
    ]);

    expect(outcome).toStrictEqual({
      kind: 'failed',
      failure: 'transport',
      fatal: aborted,
    });
  });
});
