import { describe, expect, it, vi } from 'vitest';

import { compileToolPermissionMap } from '../../permissions/compile-permissions';
import { type ToolContext } from '../../types';
import { createWebReadExecutor, type WebReadDeps } from '../execute';
import type {
  WebFetchFailure,
  WebResponse,
  WebFetchSession,
} from '../http-client';
import { parseWebLocator } from '../locator';
import { renderWebContent } from '../pipeline';
import { buildWebReadResult } from '../result';
import {
  classifyFetchFailure,
  createWebAdapters,
  dispatchWebAdapters,
  MAX_ADAPTER_DOCUMENT_BYTES,
  omissionNote,
  type WebAdapter,
  type WebAdapterFailure,
  type WebAdapterIo,
  type WebAdapterOutcome,
} from './contract';
import { REJECTED_ADDRESS_MESSAGE } from '../../permissions/messages';

const SOURCE = 'https://example.test/article';
const POLICY = compileToolPermissionMap(
  { read: { allow: true } },
  'test-policy',
);

function response(body: string, contentType = 'text/plain'): WebResponse {
  return { finalUrl: SOURCE, contentType, body };
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    permissionPolicy: POLICY,
    tenantDb: {
      runAs: () => Promise.reject(new Error('database unavailable')),
    },
    productUserAgent: 'llame/0.0.0-test',
    ...overrides,
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
): WebAdapterOutcome {
  return { kind: 'rendered', content, notes };
}

function failedOutcome(failure: WebAdapterFailure): WebAdapterOutcome {
  return { kind: 'failed', failure };
}

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
          ...adapter('second', true, renderedOutcome('adapter text')),
          route: 'rewrite',
        },
      ],
      { fetch: () => Promise.resolve(response('unused')) },
    );

    expect(result).toMatchObject({
      kind: 'rendered',
      render: {
        method: 'adapter',
        content: 'adapter text',
        finalUrl: SOURCE,
        adapter: { id: 'second', route: 'rewrite' },
        notes: ['web adapter "first" fell through: status'],
      },
    });
  });

  it('keeps an adapter omission note on a partial render', async () => {
    const note = omissionNote('review comments', 'rate_limit');
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

  it('truncates an oversized document only at a line boundary', async () => {
    const line = `${'x'.repeat(1023)}\n`;
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
      { type: 'http_status', message: 'The server answered HTTP 429.' },
      'rate_limit',
    ],
    [
      { type: 'http_status', message: 'The server answered HTTP 500.' },
      'status',
    ],
    [{ type: 'body_too_large', message: 'too large' }, 'too_large'],
    [{ type: 'unsupported_content_type', message: 'binary' }, 'content_type'],
    [{ type: 'network_error', message: 'network' }, 'transport'],
    [{ type: 'headers_timeout', message: 'timeout' }, 'transport'],
    [{ type: 'call_timeout', message: 'timeout' }, 'transport'],
    [{ type: 'aborted', message: 'aborted' }, 'transport'],
    [{ type: 'invalid_redirect', message: 'redirect' }, 'transport'],
    [{ type: 'too_many_redirects', message: 'redirects' }, 'transport'],
  ];

  it.each(cases)('maps %s to %s', (failure, expected) => {
    expect(classifyFetchFailure(failure)).toBe(expected);
  });
});

describe('web read adapter stage', () => {
  it('bypasses adapters for :raw and fetches only the source', async () => {
    const sourceResponse = response(
      '<html><body>source</body></html>',
      'text/html',
    );
    const fetch = vi.fn<WebFetchSession['fetch']>((url) => {
      expect(url).toBe(SOURCE);
      return Promise.resolve(sourceResponse);
    });
    const session: WebFetchSession = { fetch, dispose: vi.fn() };
    const createAdapters = vi.fn<typeof createWebAdapters>();
    const deps: WebReadDeps = {
      parseWebLocator,
      createWebFetchSession: () => session,
      createWebAdapters,
      renderWebContent,
      buildWebReadResult,
    };
    const execute = createWebReadExecutor(deps);

    const result = await execute(
      context({
        webAdapters: [
          {
            id: 'rewrite',
            use: 'rewrite',
            hosts: ['example.test'],
            target: 'https://origin.test{path}',
          },
        ],
      }),
      { operation: 'read', input: { path: `${SOURCE}:raw` } },
    );
    expect(createAdapters).not.toHaveBeenCalled();

    expect(result).toMatchObject({ status: 'success', method: 'raw' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
