import { describe, expect, it, vi } from 'vitest';

import { createRewriteAdapter } from './rewrite';
import type { WebAdapterIo } from './contract';
import type { WebResponse, WebFetchFailure } from '../http-client';
import type { WebAdapterConfig } from '../../../instance-config/llame-config';

const BASE_CONFIG: WebAdapterConfig = {
  id: 'pcstyle',
  use: 'rewrite',
  hosts: ['x.com'],
  target: 'https://x.pcstyle.dev{path}',
};

function config(overrides: Partial<WebAdapterConfig> = {}): WebAdapterConfig {
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
  networkRequests: Array<string> = [],
): WebAdapterIo {
  return {
    fetch: (url) => {
      requests.push(url);
      if ('type' in result) {
        return Promise.resolve<WebResponse | WebFetchFailure>(result);
      }
      networkRequests.push(url);
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
      origin: 'https://x.pcstyle.dev',
      notes: [
        'content came through the operator-configured origin https://x.pcstyle.dev',
      ],
    });
  });

  it('maps a refused expansion to permission without requesting', async () => {
    const requests: Array<string> = [];
    const networkRequests: Array<string> = [];
    const adapter = createRewriteAdapter(
      config({ target: 'https://x.pcstyle.dev/foo\\bar{path}' }),
    );

    const outcome = await adapter.read(
      new URL('https://x.com/article'),
      ioFor(response('never'), requests, networkRequests),
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'permission' });
    expect(requests).toStrictEqual([]);
    expect(networkRequests).toStrictEqual([]);
  });

  it('maps an admitted-target refusal without issuing a network request', async () => {
    const requests: Array<string> = [];
    const networkRequests: Array<string> = [];
    const adapter = createRewriteAdapter(BASE_CONFIG);
    const outcome = await adapter.read(new URL('https://x.com/article'), {
      fetch: (url) => {
        requests.push(url);
        return Promise.resolve<WebResponse | WebFetchFailure>({
          type: 'permission_denied',
          message: 'The adapter target was refused by operator permissions.',
        });
      },
    });

    expect(outcome).toStrictEqual({ kind: 'failed', failure: 'permission' });
    expect(requests).toStrictEqual(['https://x.pcstyle.dev/article']);
    expect(networkRequests).toStrictEqual([]);
  });

  it.each([
    [
      { type: 'http_status', message: 'The server answered HTTP 500.' },
      'status',
    ],
    [
      { type: 'http_status', message: 'The server answered HTTP 429.' },
      'rate_limit',
    ],
    [
      { type: 'unsupported_content_type', message: 'Unsupported binary.' },
      'content_type',
    ],
    [{ type: 'body_too_large', message: 'too large' }, 'too_large'],
  ] as const)('maps %s without exposing a body', async (failure, expected) => {
    const adapter = createRewriteAdapter(BASE_CONFIG);
    const outcome = await adapter.read(
      new URL('https://x.com/article'),
      ioFor(failure, []),
    );

    expect(outcome).toStrictEqual({ kind: 'failed', failure: expected });
    expect(JSON.stringify(outcome)).not.toContain('response body');
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
