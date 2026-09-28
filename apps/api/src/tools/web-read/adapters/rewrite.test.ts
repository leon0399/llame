import { describe, expect, it, vi } from 'vitest';

import { createRewriteAdapter } from './rewrite';
import type { WebAdapterIo } from './contract';
import type { WebResponse, WebFetchFailure } from '../http-client';
import type { RewriteWebAdapterConfig } from '../../../instance-config/llame-config';

const BASE_CONFIG: RewriteWebAdapterConfig = {
  id: 'pcstyle',
  use: 'rewrite',
  hosts: ['x.com'],
  target: 'https://x.pcstyle.dev{path}',
};

function config(
  overrides: Partial<RewriteWebAdapterConfig> = {},
): RewriteWebAdapterConfig {
  return { ...BASE_CONFIG, ...overrides };
}

function response(
  body: string,
  contentType = 'text/plain',
  finalUrl = 'https://x.pcstyle.dev/article',
): WebResponse {
  return { body, contentType, finalUrl };
}

function ioFor(
  result: WebResponse | WebFetchFailure,
  requests: Array<string>,
): WebAdapterIo {
  return {
    fetch: (url) => {
      requests.push(url);
      return Promise.resolve<WebResponse | WebFetchFailure>(result);
    },
  };
}

describe('rewrite web adapter matching', () => {
  it('matches configured hosts and an unanchored RE2 path pattern', () => {
    const adapter = createRewriteAdapter(config({ pathPattern: '/article' }));

    expect(adapter.match(new URL('https://x.com/guides/article?id=1'))).toBe(
      true,
    );
    expect(adapter.match(new URL('https://other.example/guides/article'))).toBe(
      false,
    );
    expect(adapter.match(new URL('https://x.com/guides/reference'))).toBe(
      false,
    );
  });
  it('rejects an invalid target with the adapter id', () => {
    expect(() => createRewriteAdapter(config({ target: 'not a URL' }))).toThrow(
      'Invalid rewrite target for adapter "pcstyle".',
    );
  });

  it('reports the configured path pattern when regex compilation fails', () => {
    expect(() => createRewriteAdapter(config({ pathPattern: '(' }))).toThrow(
      'tools.webAdapters[pcstyle].pathPattern',
    );
  });
});

describe('rewrite web adapter reads', () => {
  it('makes one request to the expanded target, including an ampersand path', async () => {
    const requests: Array<string> = [];
    const adapter = createRewriteAdapter(BASE_CONFIG);

    const outcome = await adapter.read(
      new URL('https://x.com/a&admin=1'),
      ioFor(response('plain content'), requests),
    );

    expect(requests).toStrictEqual(['https://x.pcstyle.dev/a&admin=1']);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      content: 'plain content',
      mediaType: 'text/plain',
      origin: 'https://x.pcstyle.dev',
      notes: [
        'content came through the operator-configured origin https://x.pcstyle.dev',
      ],
    });
  });
  it('forwards the inner Markdown media type', async () => {
    const outcome = await createRewriteAdapter(BASE_CONFIG).read(
      new URL('https://x.com/article'),
      ioFor(response('# Guide\n', 'text/markdown'), []),
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      mediaType: 'text/markdown',
    });
  });

  it('forwards the inner JSON media type', async () => {
    const outcome = await createRewriteAdapter(BASE_CONFIG).read(
      new URL('https://x.com/article'),
      ioFor(response('{"ok":true}', 'application/json'), []),
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      mediaType: 'application/json',
    });
  });

  it('maps an adapter status failure without exposing a body', async () => {
    const adapter = createRewriteAdapter(BASE_CONFIG);
    const outcome = await adapter.read(
      new URL('https://x.com/article'),
      ioFor(
        { type: 'http_status', message: 'The server answered HTTP 500.' },
        [],
      ),
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'status' });
  });
  it('marks a call-bound adapter failure as fatal', async () => {
    const failure: WebFetchFailure = {
      type: 'call_timeout',
      message: 'The web read exceeded its deadline.',
    };
    const outcome = await createRewriteAdapter(BASE_CONFIG).read(
      new URL('https://x.com/article'),
      ioFor(failure, []),
    );

    expect(outcome).toStrictEqual({
      kind: 'failed',
      failure: 'transport',
      fatal: failure,
    });
  });

  it('maps an unconverted HTML response to parse', async () => {
    const adapter = createRewriteAdapter(BASE_CONFIG);
    const outcome = await adapter.read(
      new URL('https://x.com/article'),
      ioFor(
        response(
          '<html><head><title>Checking</title></head><body><h1>Checking your browser</h1></body></html>',
          'text/html',
        ),
        [],
      ),
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'parse' });
  });

  it('maps a blank response to empty', async () => {
    const adapter = createRewriteAdapter(BASE_CONFIG);
    const outcome = await adapter.read(
      new URL('https://x.com/article'),
      ioFor(response(' \n\t', 'text/html'), []),
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'empty' });
  });

  it('reports the configured origin on successful conversion', async () => {
    const adapter = createRewriteAdapter(
      config({ target: 'https://reader.example.dev/view{path}' }),
    );
    const fetch = vi.fn<WebAdapterIo['fetch']>(() =>
      Promise.resolve<WebResponse | WebFetchFailure>(
        response(
          `<html><head><title>Guide</title></head><body><article>
<h1>Guide</h1>
<p>This article explains how the configured rewrite origin supplies a readable document to the native web reader. It contains enough sustained prose for the conversion quality gate to recognize the response as a real article rather than navigation chrome.</p>
<h2>Details</h2>
<p>The adapter keeps one request, renders the returned HTML locally, and reports the declared operator origin separately from the source URL so callers can inspect provenance without changing selector behavior.</p>
<p>A second paragraph gives the renderer several substantial lines and makes this fixture representative of the long-form pages an operator rewrite is intended to serve.</p>
</article></body></html>`,
          'text/html',
        ),
      ),
    );

    const outcome = await adapter.read(new URL('https://x.com/guide'), {
      fetch,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({
      kind: 'rendered',
      origin: 'https://reader.example.dev',
      notes: [
        'content came through the operator-configured origin https://reader.example.dev',
      ],
    });
  });
});
