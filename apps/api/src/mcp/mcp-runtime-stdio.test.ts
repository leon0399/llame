import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  McpRuntimeService,
  type McpRuntimeClient,
  type McpRuntimeClientFactory,
  type McpRuntimeServerDefinition,
} from './mcp-runtime.service';
import { type McpDiscoveryResult } from './mcp-server-client';

const MINUTE_MS = 60_000;

const emptyDiscovery = (): McpDiscoveryResult => ({ tools: [], refused: [] });

function fakeClient(): McpRuntimeClient {
  return {
    discover: vi.fn(() => Promise.resolve(emptyDiscovery())),
    close: vi.fn(() => Promise.resolve()),
  };
}

const stdioServers = (
  ...ids: string[]
): Readonly<Record<string, McpRuntimeServerDefinition>> =>
  Object.fromEntries(
    ids.map((id) => [id, { transport: 'stdio' as const, command: 'node' }]),
  );

const httpServers = (
  ...ids: string[]
): Readonly<Record<string, McpRuntimeServerDefinition>> =>
  Object.fromEntries(
    ids.map((id) => [
      id,
      { transport: 'http' as const, url: `https://${id}.example.test/mcp` },
    ]),
  );

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('McpRuntimeService stdio lifecycle', () => {
  // Task 2.2 — the attempt budget is bounded, unlike the remote path.
  it('stops the fast retry after the bounded attempt budget', async () => {
    vi.useFakeTimers();
    const clientFactory = vi.fn<McpRuntimeClientFactory>(() =>
      Promise.reject(new Error('spawn failed')),
    );
    const runtime = new McpRuntimeService(stdioServers('local'), {
      clientFactory,
      random: () => 1,
    });

    runtime.onModuleInit();
    await flushAsync();
    expect(clientFactory).toHaveBeenCalledTimes(1);

    // Drive well past the exponential ceiling: only the bounded number of
    // fast attempts may happen, and the budget must not keep doubling.
    for (let tick = 0; tick < 12; tick += 1) {
      await vi.advanceTimersByTimeAsync(MINUTE_MS);
      await flushAsync();
    }

    expect(clientFactory.mock.calls.length).toBeLessThanOrEqual(
      McpRuntimeService.STDIO_MAX_FAST_ATTEMPTS + 1,
    );

    await runtime.onModuleDestroy();
  });

  // Task 2.2 — a settled server keeps a recovery occasion (design.md D5).
  it('retries a settled stdio server on the periodic occasion', async () => {
    vi.useFakeTimers();
    let failing = true;
    const recovered = fakeClient();
    const clientFactory = vi.fn<McpRuntimeClientFactory>(() =>
      failing
        ? Promise.reject(new Error('spawn failed'))
        : Promise.resolve(recovered),
    );
    const runtime = new McpRuntimeService(stdioServers('local'), {
      clientFactory,
      random: () => 0.5,
    });

    runtime.onModuleInit();
    await flushAsync();

    // Exhaust the fast budget so the record settles.
    for (let tick = 0; tick < 10; tick += 1) {
      await vi.advanceTimersByTimeAsync(MINUTE_MS);
      await flushAsync();
    }
    const settledCalls = clientFactory.mock.calls.length;

    // Cadence is the distinguishing property, not merely "it retries again":
    // unbounded exponential backoff would keep firing every 5 minutes here.
    // A settled record must be quiet through that window.
    await vi.advanceTimersByTimeAsync(20 * MINUTE_MS);
    await flushAsync();
    expect(clientFactory.mock.calls.length).toBe(settledCalls);

    // The host condition clears; the periodic occasion must still retry it.
    failing = false;
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    await flushAsync();

    expect(clientFactory.mock.calls.length).toBeGreaterThan(settledCalls);
    expect(recovered.discover).toHaveBeenCalled();

    await runtime.onModuleDestroy();
  });

  // Task 2.3 — the remote path keeps its unbounded reconnect.
  it('leaves remote reconnect unbounded', async () => {
    vi.useFakeTimers();
    const clientFactory = vi.fn<McpRuntimeClientFactory>(() =>
      Promise.reject(new Error('endpoint down')),
    );
    const runtime = new McpRuntimeService(httpServers('web'), {
      clientFactory,
      random: () => 1,
    });

    runtime.onModuleInit();
    await flushAsync();

    for (let tick = 0; tick < 12; tick += 1) {
      await vi.advanceTimersByTimeAsync(5 * MINUTE_MS);
      await flushAsync();
    }

    // No ceiling applies to a remote server: it keeps trying.
    expect(clientFactory.mock.calls.length).toBeGreaterThan(
      McpRuntimeService.STDIO_MAX_FAST_ATTEMPTS + 1,
    );

    await runtime.onModuleDestroy();
  });

  // Task 2.4 — the factory receives a transport-appropriate config.
  it('dispatches the client factory on the transport discriminator', async () => {
    const seen: unknown[] = [];
    const clientFactory = vi.fn<McpRuntimeClientFactory>((config) => {
      seen.push(config);
      return Promise.resolve(fakeClient());
    });
    const runtime = new McpRuntimeService(
      { ...stdioServers('local'), ...httpServers('web') },
      { clientFactory, random: () => 0.5 },
    );

    runtime.onModuleInit();
    await flushAsync();

    expect(seen).toHaveLength(2);
    expect(seen).toContainEqual(
      expect.objectContaining({ serverId: 'local', command: 'node' }),
    );
    expect(seen).toContainEqual(
      expect.objectContaining({
        serverId: 'web',
        url: 'https://web.example.test/mcp',
      }),
    );

    await runtime.onModuleDestroy();
  });
});
