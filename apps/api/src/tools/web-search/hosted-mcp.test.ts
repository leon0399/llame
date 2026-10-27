import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMcpTestFixture,
  mcpStreamableHttpInitialize,
  routedMcpFetch as routedFetch,
  type McpFixtureResponse,
  type McpTestFixture,
} from '../../mcp/mcp-test-fixture';

import { createHostedMcp, mcpTextParts } from './hosted-mcp';

const hostedToolName = 'hosted_search';
const hostedTool = {
  name: hostedToolName,
  description: 'Fixture search tool',
  inputSchema: {
    type: 'object',
    properties: { q: { type: 'string' } },
    required: ['q'],
    additionalProperties: false,
  },
};

function fixtureScripts(
  callResponses: ReadonlyArray<McpFixtureResponse>,
  initializeResponses: ReadonlyArray<McpFixtureResponse> = [
    mcpStreamableHttpInitialize({ sessionId: 'hosted-session' }),
  ],
  toolLists: ReadonlyArray<
    ReadonlyArray<typeof hostedTool>
  > = initializeResponses.map(() => [hostedTool]),
) {
  return {
    $get: initializeResponses.map(() => ({
      kind: 'raw' as const,
      status: 405,
      body: '',
    })),
    initialize: initializeResponses,
    'notifications/initialized': initializeResponses.map(() => ({
      kind: 'raw' as const,
      status: 204,
      body: '',
    })),
    'tools/list': toolLists.map((tools) => ({
      kind: 'json' as const,
      body: { jsonrpc: '2.0', id: 1, result: { tools } },
    })),
    'tools/call': callResponses,
    $delete: initializeResponses.map(() => ({
      kind: 'raw' as const,
      status: 204,
      body: '',
    })),
  } satisfies Readonly<Record<string, ReadonlyArray<McpFixtureResponse>>>;
}

let activeFixture: McpTestFixture | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await activeFixture?.close();
  activeFixture = undefined;
});

describe('mcpTextParts', () => {
  it('keeps the text parts in order and drops every other part', () => {
    expect(
      mcpTextParts({
        content: [
          { type: 'text', text: 'one' },
          { type: 'image', data: 'ignored' },
          { type: 'text', text: 'two' },
        ],
      }),
    ).toStrictEqual(['one', 'two']);
    expect(
      mcpTextParts({ content: [{ type: 'image', data: 'ignored' }] }),
    ).toStrictEqual([]);
  });
});

describe('createHostedMcp', () => {
  it('calls the hosted tool once and detaches the abort listener', async () => {
    const fixture = await createMcpTestFixture(
      fixtureScripts([
        {
          kind: 'json',
          body: {
            jsonrpc: '2.0',
            id: 2,
            result: { content: [{ type: 'text', text: 'hello' }] },
          },
        },
      ]),
    );
    activeFixture = fixture;
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, 'addEventListener');
    const removed = vi.spyOn(controller.signal, 'removeEventListener');
    const hosted = createHostedMcp<{ readonly q: string }>({
      url: fixture.url,
      toolName: hostedToolName,
      fetch: routedFetch(fixture),
    });

    await expect(
      hosted.call(
        { q: 'read' },
        { signal: controller.signal, userAgent: 'llame/test' },
        (result) => mcpTextParts(result).join(' '),
      ),
    ).resolves.toBe('hello');

    const abortListener = added.mock.calls.find(
      ([event]) => event === 'abort',
    )?.[1];
    expect(abortListener).toBeDefined();
    expect(added).toHaveBeenCalledWith('abort', abortListener, { once: true });
    expect(removed).toHaveBeenCalledWith('abort', abortListener);
    expect(
      fixture
        .requestSummaries()
        .filter(({ httpMethod }) => httpMethod === 'DELETE'),
    ).toStrictEqual([]);
  });

  it('rejects a caller abort during the shared handshake and keeps the session', async () => {
    const fixture = await createMcpTestFixture(
      fixtureScripts(
        [
          {
            kind: 'json',
            body: {
              jsonrpc: '2.0',
              id: 2,
              result: { content: [{ type: 'text', text: 'second' }] },
            },
          },
        ],
        [
          {
            ...mcpStreamableHttpInitialize({ sessionId: 'slow-session' }),
            delayMs: 200,
          },
        ],
      ),
    );
    activeFixture = fixture;
    const hosted = createHostedMcp<{ readonly q: string }>({
      url: fixture.url,
      toolName: hostedToolName,
      fetch: routedFetch(fixture),
    });
    const controller = new AbortController();
    const reason = new Error('caller cancelled the handshake');
    const pending = hosted.call(
      { q: 'read' },
      { signal: controller.signal, userAgent: 'llame/test' },
      (result) => mcpTextParts(result).join(' '),
    );
    await vi.waitFor(() => {
      expect(
        fixture
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
      ).toHaveLength(1);
    });
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    // The caller stops waiting at once, before the shared handshake reaches
    // the tool list.
    expect(
      fixture
        .requestSummaries()
        .map(({ rpcMethod }) => rpcMethod)
        .filter((method) => method !== null),
    ).toStrictEqual(['initialize']);
    // The handshake it abandoned is still shared: the next call reuses it.
    await vi.waitFor(() => {
      expect(
        fixture
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'tools/list'),
      ).toHaveLength(1);
    });
    await expect(
      hosted.call(
        { q: 'read' },
        { signal: new AbortController().signal, userAgent: 'llame/test' },
        (result) => mcpTextParts(result).join(' '),
      ),
    ).resolves.toBe('second');
    expect(
      fixture
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
    ).toHaveLength(1);
  });

  it('reconnects after a handshake fails while no caller waits', async () => {
    const fixture = await createMcpTestFixture(
      fixtureScripts(
        [
          {
            kind: 'json',
            body: {
              jsonrpc: '2.0',
              id: 2,
              result: { content: [{ type: 'text', text: 'second' }] },
            },
          },
        ],
        [
          {
            kind: 'json',
            status: 500,
            delayMs: 100,
            headers: { 'mcp-session-id': 'failed-session' },
            body: {
              jsonrpc: '2.0',
              id: 0,
              error: { code: -32_603, message: 'handshake failed' },
            },
          },
          mcpStreamableHttpInitialize({ sessionId: 'replacement-session' }),
        ],
      ),
    );
    activeFixture = fixture;
    const hosted = createHostedMcp<{ readonly q: string }>({
      url: fixture.url,
      toolName: hostedToolName,
      fetch: routedFetch(fixture),
    });
    const controller = new AbortController();
    const reason = new Error('caller cancelled the handshake');
    const pending = hosted.call(
      { q: 'read' },
      { signal: controller.signal, userAgent: 'llame/test' },
      (result) => mcpTextParts(result).join(' '),
    );
    await vi.waitFor(() => {
      expect(
        fixture
          .requestSummaries()
          .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
      ).toHaveLength(1);
    });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    // The caller is gone; the failed handshake closes its own client, which
    // is the only thing that can evict the session nobody waits on any more.
    await vi.waitFor(() => {
      expect(
        fixture
          .requestSummaries()
          .filter(({ httpMethod }) => httpMethod === 'DELETE'),
      ).toHaveLength(1);
    });

    await expect(
      hosted.call(
        { q: 'read' },
        { signal: new AbortController().signal, userAgent: 'llame/test' },
        (result) => mcpTextParts(result).join(' '),
      ),
    ).resolves.toBe('second');
    expect(
      fixture
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
    ).toHaveLength(2);
  });

  it('closes a poisoned session once its call ends and reconnects', async () => {
    const fixture = await createMcpTestFixture(
      fixtureScripts(
        [
          { kind: 'disconnect' },
          {
            kind: 'json',
            body: {
              jsonrpc: '2.0',
              id: 2,
              result: { content: [{ type: 'text', text: 'reconnected' }] },
            },
          },
        ],
        [
          mcpStreamableHttpInitialize({ sessionId: 'first-session' }),
          mcpStreamableHttpInitialize({ sessionId: 'second-session' }),
        ],
      ),
    );
    activeFixture = fixture;
    const hosted = createHostedMcp<{ readonly q: string }>({
      url: fixture.url,
      toolName: hostedToolName,
      fetch: routedFetch(fixture),
    });
    const signal = new AbortController().signal;
    const interpret = (result: Parameters<typeof mcpTextParts>[0]): string =>
      mcpTextParts(result).join(' ');

    await expect(
      hosted.call(
        { q: 'read' },
        { signal, userAgent: 'llame/test' },
        interpret,
      ),
    ).rejects.toMatchObject({
      name: 'EngineFailure',
      failureClass: 'upstream_error',
    });
    await vi.waitFor(() => {
      expect(
        fixture
          .requestSummaries()
          .filter(({ httpMethod }) => httpMethod === 'DELETE'),
      ).toHaveLength(1);
    });

    await expect(
      hosted.call(
        { q: 'read' },
        { signal, userAgent: 'llame/test' },
        interpret,
      ),
    ).resolves.toBe('reconnected');
    expect(
      fixture
        .requestSummaries()
        .filter(({ rpcMethod }) => rpcMethod === 'initialize'),
    ).toHaveLength(2);
  });
});
