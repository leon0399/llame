import { createServer, type Server } from 'node:http';

import { fetch as undiciFetch } from 'undici';
import { describe, expect, it, vi } from 'vitest';

import {
  createWebFetchSession,
  type WebFetchFailure,
  type WebResponse,
} from '../http-client';
import {
  classifyFetchFailure,
  createWebAdapters,
  dispatchWebAdapters,
  isFatalAdapterFailure,
  omissionNote,
  rateLimitReset,
  MAX_ADAPTER_DOCUMENT_BYTES,
  type WebAdapter,
  type WebAdapterFailure,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from './contract';
import { REJECTED_ADDRESS_MESSAGE } from '../../permissions/messages';

const SOURCE = 'https://example.test/article';

function response(body: string, contentType = 'text/plain'): WebResponse {
  return { finalUrl: SOURCE, contentType, body };
}
async function listenServer(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || !(address instanceof Object)) {
    throw new Error('The adapter fixture did not receive a TCP address.');
  }
  return address.port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
}

async function openPartialFixture(): Promise<{
  readonly url: string;
  readonly close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    if (request.url === '/slow') {
      // Hold the response open so the shared call deadline, not a test timer,
      // produces the deterministic timeout.
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('primary');
  });
  const port = await listenServer(server);
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => closeServer(server),
  };
}

function adapter(
  id: string,
  matches: boolean,
  outcome: WebAdapterOutcome,
): WebAdapter {
  return {
    id,
    route: 'native',
    match: () => matches,
    read: () => Promise.resolve(outcome),
  };
}

function renderedOutcome(
  content: string,
  notes: ReadonlyArray<string> = [],
  mediaType?: string,
): WebAdapterOutcome {
  return { kind: 'rendered', content, mediaType, notes };
}

function failedOutcome(failure: WebAdapterFailure): WebAdapterOutcome {
  return { kind: 'failed', failure };
}

describe('createWebAdapters', () => {
  it('creates a native GitHub adapter with the configured id', () => {
    const adapters = createWebAdapters([{ id: 'gh', use: 'github' }]);
    expect(adapters).toHaveLength(1);
    const adapter = adapters[0];
    if (adapter === undefined) throw new Error('expected GitHub adapter');

    expect(adapter).toMatchObject({ id: 'gh', route: 'native' });
    expect(adapter.match(new URL('https://github.com/o/r/issues/1'))).toBe(
      true,
    );
  });

  it('creates a native Bluesky adapter with the configured id', () => {
    const [adapter] = createWebAdapters([{ id: 'bsky', use: 'bluesky' }]);
    if (adapter === undefined) throw new Error('expected Bluesky adapter');

    expect(adapter).toMatchObject({ id: 'bsky', route: 'native' });
    expect(adapter.match(new URL('https://bsky.app/profile/a.test'))).toBe(
      true,
    );
  });

  it('creates a native npm adapter with the configured id', () => {
    const [adapter] = createWebAdapters([{ id: 'pkgs', use: 'npm' }]);
    if (adapter === undefined) throw new Error('expected npm adapter');

    expect(adapter).toMatchObject({ id: 'pkgs', route: 'native' });
    expect(adapter.match(new URL('https://www.npmjs.com/package/react'))).toBe(
      true,
    );
  });

  it('creates a native Hugging Face adapter with the configured id', () => {
    const [adapter] = createWebAdapters([{ id: 'hub', use: 'huggingface' }]);
    if (adapter === undefined) throw new Error('expected Hugging Face adapter');

    expect(adapter).toMatchObject({ id: 'hub', route: 'native' });
    expect(adapter.match(new URL('https://huggingface.co/org/model'))).toBe(
      true,
    );
  });

  it('creates a native arXiv adapter with the configured id', () => {
    const [adapter] = createWebAdapters([{ id: 'papers', use: 'arxiv' }]);
    if (adapter === undefined) throw new Error('expected arXiv adapter');

    expect(adapter).toMatchObject({ id: 'papers', route: 'native' });
    expect(adapter.match(new URL('https://arxiv.org/abs/1706.03762'))).toBe(
      true,
    );
  });

  it('creates a native Stack Exchange adapter with the configured id', () => {
    const [adapter] = createWebAdapters([{ id: 'qa', use: 'stackexchange' }]);
    if (adapter === undefined)
      throw new Error('expected Stack Exchange adapter');

    expect(adapter).toMatchObject({ id: 'qa', route: 'native' });
    expect(adapter.match(new URL('https://stackoverflow.com/q/42'))).toBe(true);
  });

  it('creates a native crates.io adapter with the configured id', () => {
    const [adapter] = createWebAdapters([{ id: 'rust', use: 'crates' }]);
    if (adapter === undefined) throw new Error('expected crates.io adapter');

    expect(adapter).toMatchObject({ id: 'rust', route: 'native' });
    expect(adapter.match(new URL('https://crates.io/crates/serde'))).toBe(true);
  });

  it('creates a native Hacker News adapter with the configured id', () => {
    const [adapter] = createWebAdapters([{ id: 'hn', use: 'hackernews' }]);
    if (adapter === undefined) throw new Error('expected Hacker News adapter');

    expect(adapter).toMatchObject({ id: 'hn', route: 'native' });
    expect(
      adapter.match(new URL('https://news.ycombinator.com/item?id=1')),
    ).toBe(true);
  });

  it('creates a native DOI adapter with the configured id', () => {
    const [adapter] = createWebAdapters([{ id: 'papers', use: 'doi' }]);
    if (adapter === undefined) throw new Error('expected DOI adapter');

    expect(adapter).toMatchObject({ id: 'papers', route: 'native' });
    expect(adapter.match(new URL('https://doi.org/10.1038/nature14539'))).toBe(
      true,
    );
  });

  it('creates a native Wikipedia adapter with the configured id', () => {
    const [adapter] = createWebAdapters([
      { id: 'wikipedia', use: 'wikipedia' },
    ]);
    if (adapter === undefined) throw new Error('expected Wikipedia adapter');

    expect(adapter).toMatchObject({ id: 'wikipedia', route: 'native' });
    expect(adapter.match(new URL('https://en.wikipedia.org/wiki/Rust'))).toBe(
      true,
    );
  });

  it('creates a native OSV adapter with the configured id', () => {
    const [adapter] = createWebAdapters([{ id: 'advisories', use: 'osv' }]);
    if (adapter === undefined) throw new Error('expected OSV adapter');

    expect(adapter).toMatchObject({ id: 'advisories', route: 'native' });
    expect(
      adapter.match(
        new URL('https://osv.dev/vulnerability/GHSA-jfh8-c2jp-5v3q'),
      ),
    ).toBe(true);
  });

  it('creates a native dev.to adapter with the configured id', () => {
    const [adapter] = createWebAdapters([{ id: 'blogs', use: 'devto' }]);
    if (adapter === undefined) throw new Error('expected dev.to adapter');

    expect(adapter).toMatchObject({ id: 'blogs', route: 'native' });
    expect(adapter.match(new URL('https://dev.to/alice/a-post'))).toBe(true);
  });

  it('creates a native Substack adapter with the configured id', () => {
    const [adapter] = createWebAdapters([{ id: 'letters', use: 'substack' }]);
    if (adapter === undefined) throw new Error('expected Substack adapter');

    expect(adapter).toMatchObject({ id: 'letters', route: 'native' });
    expect(adapter.match(new URL('https://simonw.substack.com/p/a-post'))).toBe(
      true,
    );
  });

  it('creates a native Discourse adapter with the configured id', () => {
    const [adapter] = createWebAdapters([
      { id: 'forums', use: 'discourse', hosts: ['forum.example.test'] },
    ]);
    if (adapter === undefined) throw new Error('expected Discourse adapter');

    expect(adapter).toMatchObject({ id: 'forums', route: 'native' });
    expect(adapter.match(new URL('https://forum.example.test/t/topic/1'))).toBe(
      true,
    );
  });
});

describe('dispatchWebAdapters', () => {
  it('does not fetch or note an unclaimed URL', async () => {
    const fetch = vi.fn<WebAdapterIo['fetch']>();
    const result = await dispatchWebAdapters(
      new URL(SOURCE),
      [adapter('unclaimed', false, renderedOutcome('never'))],
      { fetch },
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toStrictEqual({ kind: 'fallthrough', notes: [] });
  });

  it('falls through with the exact note and lets the next claimant render', async () => {
    const result = await dispatchWebAdapters(
      new URL(SOURCE),
      [
        adapter('first', true, failedOutcome('status')),
        {
          ...adapter(
            'second',
            true,
            renderedOutcome('adapter text', [], 'text/markdown'),
          ),
          route: 'rewrite',
        },
      ],
      { fetch: () => Promise.resolve(response('unused')) },
    );

    expect(result).toStrictEqual({
      kind: 'rendered',
      render: {
        method: 'adapter',
        content: 'adapter text',
        mediaType: 'text/markdown',
        finalUrl: SOURCE,
        adapter: { id: 'second', route: 'rewrite' },
        notes: ['web adapter "first" fell through: status'],
      },
    });
  });
  it('keeps a primary rate-limit reset in the fall-through note', async () => {
    const result = await dispatchWebAdapters(
      new URL(SOURCE),
      [
        adapter('github', true, {
          kind: 'failed',
          failure: 'rate_limit',
          reset: '2023-11-14T22:13:20.000Z',
        }),
      ],
      { fetch: () => Promise.resolve(response('unused')) },
    );

    expect(result).toStrictEqual({
      kind: 'fallthrough',
      notes: [
        'web adapter "github" fell through: rate_limit, resets 2023-11-14T22:13:20.000Z',
      ],
    });
  });

  it('keeps an adapter omission note on a partial render', async () => {
    const note = 'review comments omitted: rate_limit';
    const result = await dispatchWebAdapters(
      new URL(SOURCE),
      [adapter('partial', true, renderedOutcome('partial', [note]))],
      { fetch: () => Promise.resolve(response('unused')) },
    );

    expect(result).toMatchObject({
      kind: 'rendered',
      render: { content: 'partial', notes: [note] },
    });
  });

  it('passes a directory payload through adapter dispatch', async () => {
    const directory = {
      displayPath: SOURCE,
      entries: [{ name: 'src', kind: 'directory' as const, children: [] }],
    };
    const result = await dispatchWebAdapters(
      new URL(SOURCE),
      [
        adapter('github', true, {
          kind: 'rendered',
          content: '',
          mediaType: undefined,
          directory,
          notes: [],
        }),
      ],
      { fetch: () => Promise.resolve(response('unused')) },
    );

    expect(result).toMatchObject({
      kind: 'rendered',
      render: { content: '', directory },
    });
  });
  it('omits provenance and notes fields when neither is present', async () => {
    const result = await dispatchWebAdapters(
      new URL(SOURCE),
      [adapter('plain', true, renderedOutcome('plain'))],
      { fetch: () => Promise.resolve(response('unused')) },
    );

    expect(result).toStrictEqual({
      kind: 'rendered',
      render: {
        method: 'adapter',
        content: 'plain',
        finalUrl: SOURCE,
        adapter: { id: 'plain', route: 'native' },
      },
    });
    if (result.kind !== 'rendered') throw new Error('expected rendered result');
    expect(result.render.truncated).toBeUndefined();
  });

  it('reports a rewrite origin only when the rewrite outcome provides one', async () => {
    const origin = 'https://reader.example.test';
    const result = await dispatchWebAdapters(
      new URL(SOURCE),
      [
        {
          ...adapter('rewrite', true, {
            kind: 'rendered',
            content: 'rewritten',
            mediaType: undefined,
            origin,
            notes: [],
          }),
          route: 'rewrite',
        },
      ],
      { fetch: () => Promise.resolve(response('unused')) },
    );
    const native = await dispatchWebAdapters(
      new URL(SOURCE),
      [
        {
          ...adapter('native', true, {
            kind: 'rendered',
            content: 'native',
            mediaType: undefined,
            origin,
            notes: [],
          }),
          route: 'native',
        },
      ],
      { fetch: () => Promise.resolve(response('unused')) },
    );

    expect(result).toMatchObject({
      kind: 'rendered',
      render: {
        adapter: { id: 'rewrite', route: 'rewrite', origin },
      },
    });
    expect(native).toMatchObject({
      kind: 'rendered',
      render: { adapter: { id: 'native', route: 'native' } },
    });
    if (native.kind !== 'rendered') throw new Error('expected rendered result');
    expect(native.render.adapter).not.toHaveProperty('origin');
  });

  it('truncates an oversized document only at a line boundary', async () => {
    const line = `${'é'.repeat(700)}\n`;
    const result = await dispatchWebAdapters(
      new URL(SOURCE),
      [adapter('large', true, renderedOutcome(line.repeat(6000)))],
      { fetch: () => Promise.resolve(response('unused')) },
    );

    if (result.kind !== 'rendered') throw new Error('expected rendered result');
    expect(
      new TextEncoder().encode(result.render.content).byteLength,
    ).toBeLessThanOrEqual(MAX_ADAPTER_DOCUMENT_BYTES);
    expect(result.render.content.endsWith('\n')).toBe(true);
    expect(result.render.truncated).toBe(true);
    expect(result.render.notes).toContain('document truncated: too_large');
  });
  it('keeps a non-empty UTF-8 prefix when no newline fits the limit', async () => {
    const content = 'é'.repeat(MAX_ADAPTER_DOCUMENT_BYTES);
    const result = await dispatchWebAdapters(
      new URL(SOURCE),
      [adapter('single-line', true, renderedOutcome(content))],
      { fetch: () => Promise.resolve(response('unused')) },
    );

    if (result.kind !== 'rendered') throw new Error('expected rendered result');
    expect(result.render.content.length).toBeGreaterThan(0);
    expect(result.render.content).not.toContain('\n');
    expect(
      new TextEncoder().encode(result.render.content).byteLength,
    ).toBeLessThanOrEqual(MAX_ADAPTER_DOCUMENT_BYTES);
    expect(result.render.truncated).toBe(true);
    expect(result.render.notes).toContain('document truncated: too_large');
  });

  it('does not include a newline beyond the retained byte window', async () => {
    const content = `${'x'.repeat(MAX_ADAPTER_DOCUMENT_BYTES)}\ntrailing`;
    const result = await dispatchWebAdapters(
      new URL(SOURCE),
      [adapter('boundary', true, renderedOutcome(content))],
      { fetch: () => Promise.resolve(response('unused')) },
    );

    if (result.kind !== 'rendered') throw new Error('expected rendered result');
    expect(result.render.content).toBe('x'.repeat(MAX_ADAPTER_DOCUMENT_BYTES));
    expect(new TextEncoder().encode(result.render.content).byteLength).toBe(
      MAX_ADAPTER_DOCUMENT_BYTES,
    );
    expect(result.render.truncated).toBe(true);
    expect(result.render.notes).toContain('document truncated: too_large');
  });
  it('returns a fatal primary failure without trying later adapters', async () => {
    let laterMatched = false;
    const fatal: WebFetchFailure = {
      type: 'call_timeout',
      message: 'The web read exceeded its deadline.',
    };
    const result = await dispatchWebAdapters(
      new URL(SOURCE),
      [
        {
          id: 'fatal',
          route: 'native',
          match: () => true,
          read: () =>
            Promise.resolve({ kind: 'failed', failure: 'transport', fatal }),
        },
        {
          id: 'later',
          route: 'native',
          match: () => {
            laterMatched = true;
            return true;
          },
          read: () => Promise.resolve(renderedOutcome('never')),
        },
      ],
      { fetch: () => Promise.resolve(response('unused')) },
    );

    expect(result).toStrictEqual({ kind: 'fatal', failure: fatal });
    expect(laterMatched).toBe(false);
  });
});

describe('classifyFetchFailure', () => {
  const cases: ReadonlyArray<readonly [WebFetchFailure, string]> = [
    [
      {
        type: 'permission_denied',
        message: 'The adapter target was refused by operator permissions.',
      },
      'permission',
    ],
    [
      { type: 'permission_denied', message: REJECTED_ADDRESS_MESSAGE },
      'address',
    ],
    [
      { type: 'http_status', message: 'The server answered HTTP  429.' },
      'rate_limit',
    ],
    [
      { type: 'http_status', message: 'The server answered HTTP 429' },
      'rate_limit',
    ],
    [
      {
        type: 'http_status',
        message: 'The server answered HTTP 403.',
        httpStatus: 403,
        rateLimit: { remaining: '0' },
      },
      'rate_limit',
    ],
    [
      {
        type: 'http_status',
        message: 'The server answered HTTP 403.',
        httpStatus: 403,
        rateLimit: { retryAfter: '120' },
      },
      'rate_limit',
    ],
    [
      {
        type: 'http_status',
        message: 'The server answered HTTP 403.',
        httpStatus: 403,
        rateLimit: { reset: '1700000000' },
      },
      'status',
    ],
    [
      { type: 'http_status', message: 'The server answered HTTP 500.' },
      'status',
    ],
    [{ type: 'body_too_large', message: 'too large' }, 'too_large'],
    [{ type: 'unsupported_content_type', message: 'binary' }, 'content_type'],
    [{ type: 'network_error', message: 'network' }, 'transport'],
  ];

  it.each(cases)('maps %s to %s', (failure, expected) => {
    expect(classifyFetchFailure(failure)).toBe(expected);
  });
});
describe('omissionNote', () => {
  it('formats a numeric rate-limit reset as ISO time', () => {
    expect(
      omissionNote('review comments', {
        type: 'http_status',
        message: 'The server answered HTTP 403.',
        httpStatus: 403,
        rateLimit: { remaining: '0', reset: '1700000000' },
      }),
    ).toBe(
      'review comments omitted: rate_limit, resets 2023-11-14T22:13:20.000Z',
    );
  });

  it('omits reset text when no numeric reset is available', () => {
    expect(
      omissionNote('comments', {
        type: 'http_status',
        message: 'The server answered HTTP 403.',
        httpStatus: 403,
        rateLimit: { remaining: '0' },
      }),
    ).toBe('comments omitted: rate_limit');
  });
});
describe('rateLimitReset', () => {
  it('returns reset only for classified rate limits', () => {
    expect(
      rateLimitReset({
        type: 'http_status',
        message: 'The server answered HTTP 403.',
        httpStatus: 403,
        rateLimit: { remaining: '0', reset: '1700000000' },
      }),
    ).toBe('2023-11-14T22:13:20.000Z');
    expect(
      rateLimitReset({
        type: 'http_status',
        message: 'The server answered HTTP 403.',
        httpStatus: 403,
        rateLimit: { reset: '1700000000' },
      }),
    ).toBeUndefined();
  });
});

describe('adapter primary failure fatality', () => {
  it('allows bounded candidate failures and ends on deadline or unknown types', () => {
    expect(
      isFatalAdapterFailure({
        type: 'http_status',
        message: 'The server answered HTTP 500.',
      }),
    ).toBe(false);
    expect(
      isFatalAdapterFailure({
        type: 'permission_denied',
        message: 'The adapter target was refused by operator permissions.',
      }),
    ).toBe(false);
    expect(
      isFatalAdapterFailure({
        type: 'call_timeout',
        message: 'The web read exceeded its deadline.',
      }),
    ).toBe(true);
    expect(
      isFatalAdapterFailure({
        type: 'parse',
        message: 'The adapter could not parse the response.',
      }),
    ).toBe(false);
    expect(
      isFatalAdapterFailure({
        type: 'too_many_redirects',
        message: 'The server redirected too many times.',
      }),
    ).toBe(true);
    expect(isFatalAdapterFailure({ type: 'future_failure', message: '' })).toBe(
      true,
    );
  });
  it.each([
    'unsupported_content_type',
    'body_too_large',
    'network_error',
    'headers_timeout',
    'invalid_redirect',
  ])('allows candidate failure %s to fall through', (type) => {
    expect(isFatalAdapterFailure({ type, message: '' })).toBe(false);
  });
});

describe('adapter secondary requests', () => {
  it('keeps primary content when a later request reaches the call timeout', async () => {
    const fixture = await openPartialFixture();
    const session = createWebFetchSession(
      { userAgent: 'llame/adapter-test', deadlineMs: 250 },
      {
        fetch: undiciFetch,
        admit: () => ({
          policyId: 'test-policy',
          decision: 'allow',
          reason: 'matched_allow',
          reference: null,
        }),
        admitAddress: () => true,
        resolve: () =>
          Promise.resolve([{ address: '127.0.0.1', family: 4 as const }]),
      },
    );
    try {
      const adapter: WebAdapter = {
        id: 'partial',
        route: 'native',
        match: () => true,
        read: async (_source, io) => {
          const primary = await io.fetch(`${fixture.url}/primary`);
          if ('type' in primary) throw new Error('primary request failed');
          const secondary = await io.fetch(`${fixture.url}/slow`);
          if (!('type' in secondary) || secondary.type !== 'call_timeout') {
            throw new Error('secondary request did not reach call timeout');
          }
          return renderedOutcome(primary.body, [
            'review comments omitted: transport',
          ]);
        },
      };
      const result = await dispatchWebAdapters(
        new URL(`${fixture.url}/source`),
        [adapter],
        { fetch: session.fetch },
      );

      expect(result).toMatchObject({
        kind: 'rendered',
        render: {
          content: 'primary',
          notes: ['review comments omitted: transport'],
        },
      });
    } finally {
      session.dispose();
      await fixture.close();
    }
  });
});
