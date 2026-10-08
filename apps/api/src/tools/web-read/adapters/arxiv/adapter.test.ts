import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  API_ORIGIN,
  scriptedIo,
  type Reply,
} from '../../../../testing/github-test-io';
import { createArxivAdapter } from './adapter';

const adapter = createArxivAdapter(
  { id: 'arxiv', use: 'arxiv' },
  { origin: API_ORIGIN },
);
const HTML_URL = `${API_ORIGIN}/html/1706.03762v7`;
const ABS_URL = `${API_ORIGIN}/abs/1706.03762v7`;
const NOT_FOUND: WebFetchFailure = {
  type: 'http_status',
  message: 'HTTP 404',
  httpStatus: 404,
};
const PROSE =
  'The encoder maps an input sequence of symbol representations to a sequence of continuous representations, and the decoder then generates an output sequence one element at a time.';

function page(url: string, body: string): Reply {
  return {
    finalUrl: url,
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><title>Attention Is All You Need</title></head><body><article>${body}</article></body></html>`,
  };
}

async function read(source: string, routes: ReadonlyArray<[string, Reply]>) {
  const run = scriptedIo(new Map(routes.map(([url, reply]) => [url, [reply]])));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, urls: run.requests.map(({ url }) => url) };
}

describe('arXiv adapter claim', () => {
  it.each([
    'https://arxiv.org/abs/1706.03762',
    'https://arxiv.org/pdf/1706.03762v7',
    'https://arxiv.org/pdf/2412.09871.pdf',
    'https://www.arxiv.org/html/2412.09871v1',
    'https://arxiv.org/abs/hep-th/9901001',
    'https://arxiv.org/pdf/math.GT/0309136v2.pdf',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://arxiv.org/abs/1706.03762',
    'https://export.arxiv.org/abs/1706.03762',
    'https://arxiv.org/abs/1706.03762/',
    'https://arxiv.org/abs/170.03762',
    'https://arxiv.org/abs/1706.03762.pdf',
    'https://arxiv.org/list/cs.CL/recent',
    'https://arxiv.org/a/vaswani_a_1',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('arXiv adapter read', () => {
  it('reads a PDF link as the HTML full text with math as LaTeX', async () => {
    const equation = String.raw`<table class="ltx_equation ltx_eqn_table" id="S3.E1"><tbody><tr><td><math alttext="\mathrm{Attention}(Q,K,V)=QK^{T}" display="block"><mi>A</mi></math></td><td><span class="ltx_tag ltx_tag_equation ltx_align_right">(1)</span></td></tr></tbody></table>`;
    const inline =
      'Keys have dimension <math alttext="d_{k}" display="inline"><msub><mi>d</mi><mi>k</mi></msub></math> here.';

    const { outcome, urls } = await read(
      'https://arxiv.org/pdf/1706.03762v7.pdf',
      [
        [
          HTML_URL,
          page(
            HTML_URL,
            `<h1>Attention</h1><p>${PROSE}</p><p>${PROSE}</p><p>${inline}</p>${equation}<p>${PROSE}</p><p>${PROSE}</p>`,
          ),
        ],
      ],
    );

    expect(urls).toStrictEqual([HTML_URL]);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
    });
    const content = outcome.kind === 'rendered' ? outcome.content : '';
    expect(content).toContain('Keys have dimension `d_{k}` here.');
    expect(content).toContain(
      '```\n\\mathrm{Attention}(Q,K,V)=QK^{T}    (1)\n```',
    );
    expect(content).not.toContain('<math');
  });

  it('falls back to the abstract page when the version has no HTML', async () => {
    const { outcome, urls } = await read('https://arxiv.org/abs/1706.03762v7', [
      [HTML_URL, NOT_FOUND],
      [
        ABS_URL,
        page(
          ABS_URL,
          `<h1>Attention Is All You Need</h1><blockquote>${PROSE}</blockquote>`,
        ),
      ],
    ]);

    expect(urls).toStrictEqual([HTML_URL, ABS_URL]);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      notes: ['full text omitted: status'],
    });
    expect(outcome.kind === 'rendered' && outcome.content).toContain(PROSE);
  });

  it('falls through when neither page arrives', async () => {
    const { outcome } = await read('https://arxiv.org/abs/1706.03762v7', [
      [HTML_URL, NOT_FOUND],
      [ABS_URL, NOT_FOUND],
    ]);

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'status' });
  });

  it('ends the call on a call-ending failure without trying the abstract', async () => {
    const aborted: WebFetchFailure = { type: 'aborted', message: 'aborted' };

    const { outcome, urls } = await read('https://arxiv.org/abs/1706.03762v7', [
      [HTML_URL, aborted],
    ]);

    expect(urls).toStrictEqual([HTML_URL]);
    expect(outcome).toStrictEqual({
      kind: 'failed',
      failure: 'transport',
      fatal: aborted,
    });
  });
});
