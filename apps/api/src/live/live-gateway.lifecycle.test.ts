/**
 * The gateway's socket lifecycle against a real local HTTP server and `ws`
 * client, with a fake hub and session validator (no database): attach on
 * upgrade, refusal before `101`, delivery, the per-user cap, slow consumers,
 * heartbeats and session re-validation, and teardown.
 */

import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { WebSocket } from 'ws';
import { isString } from '@workspace/runtime-safety';

import {
  LIVE_PATH,
  LiveGatewayService,
  MAX_SOCKETS_PER_USER,
  type LiveAuth,
} from './live-gateway.service';

type Subscriber = (frame: string) => void;

class FakeHub {
  readonly subscribers = new Map<string, Set<Subscriber>>();
  readonly instanceSubscribers = new Set<Subscriber>();
  unsubscribed = 0;

  subscribe(owner: string, subscriber: Subscriber): () => void {
    const set = this.subscribers.get(owner) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribers.set(owner, set);
    return () => {
      set.delete(subscriber);
      this.unsubscribed += 1;
    };
  }

  subscribeInstance(subscriber: Subscriber): () => void {
    this.instanceSubscribers.add(subscriber);
    return () => {
      this.instanceSubscribers.delete(subscriber);
      this.unsubscribed += 1;
    };
  }

  emit(owner: string, frame: string): void {
    for (const subscriber of this.subscribers.get(owner) ?? []) {
      subscriber(frame);
    }
  }

  emitInstance(frame: string): void {
    for (const subscriber of this.instanceSubscribers) subscriber(frame);
  }
}

const sessions = new Map<string, string>([
  ['token-a', 'user-a'],
  ['token-b', 'user-b'],
]);

let sessionLookupFails = false;

const auth: LiveAuth = {
  validateToken: (token: string) =>
    sessionLookupFails
      ? Promise.reject(new Error('database unavailable'))
      : Promise.resolve(
          sessions.has(token)
            ? { userId: sessions.get(token) ?? '', sessionId: token }
            : undefined,
        ),
};

let server: Server;
let hub: FakeHub;
let gateway: LiveGatewayService;
let url: string;
const clients: Array<WebSocket> = [];

beforeEach(async () => {
  server = createServer();
  hub = new FakeHub();
  gateway = new LiveGatewayService(
    { httpAdapter: { getHttpServer: () => server } },
    auth,
    hub,
  );
  gateway.onApplicationBootstrap();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || isString(address)) throw new Error('expected TCP address');
  url = `ws://127.0.0.1:${address.port}${LIVE_PATH}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) client.terminate();
  gateway.onModuleDestroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function open(token: string, options: { autoPong?: boolean } = {}) {
  const client = new WebSocket(url, {
    headers: { authorization: `Bearer ${token}` },
    ...options,
  });
  clients.push(client);
  const frames: Array<string> = [];
  client.on('message', (data) => {
    if (Buffer.isBuffer(data)) frames.push(data.toString('utf8'));
  });
  const closed = new Promise<number>((resolve) =>
    client.on('close', (code) => resolve(code)),
  );
  const opened = new Promise<void>((resolve, reject) => {
    client.on('open', () => resolve());
    client.on('unexpected-response', (_req, res) =>
      reject(new Error(`HTTP ${res.statusCode}`)),
    );
    client.on('error', reject);
  });
  return { client, frames, closed, opened };
}

describe('LiveGatewayService lifecycle', () => {
  it('attaches an accepted socket to its owner and delivers frames', async () => {
    const a = open('token-a');
    await a.opened;

    expect(hub.subscribers.get('user-a')?.size).toBe(1);
    hub.emit('user-a', '{"type":"resync"}');
    hub.emitInstance('{"type":"machine.upserted"}');

    await vi.waitFor(() =>
      expect(a.frames).toEqual([
        '{"type":"resync"}',
        '{"type":"machine.upserted"}',
      ]),
    );
    expect(hub.instanceSubscribers.size).toBe(1);
  });

  it('refuses an invalid session before the upgrade', async () => {
    await expect(open('nope').opened).rejects.toThrow('HTTP 401');
    expect(hub.subscribers.size).toBe(0);
  });

  it('refuses a user at the socket cap and counts sockets per user', async () => {
    const opened = Array.from({ length: MAX_SOCKETS_PER_USER }, () =>
      open('token-a'),
    );
    await Promise.all(opened.map((o) => o.opened));

    await expect(open('token-a').opened).rejects.toThrow('HTTP 429');
    await open('token-b').opened;
  });

  it('unsubscribes when the client closes and skips closed sockets', async () => {
    const a = open('token-a');
    await a.opened;
    const subscriber = [...(hub.subscribers.get('user-a') ?? [])][0];

    a.client.close();
    await a.closed;
    // Both streams are torn down: the owner's, and the instance-wide one.
    await vi.waitFor(() => expect(hub.unsubscribed).toBe(2));
    expect(() => subscriber?.('{"type":"resync"}')).not.toThrow();
  });

  it('closes a socket that falls too far behind', async () => {
    const a = open('token-a');
    await a.opened;
    a.client.pause();
    const big = 'x'.repeat(4 * 1024 * 1024);

    for (let i = 0; i < 8; i += 1) hub.emit('user-a', big);
    a.client.resume();

    expect(await a.closed).toBe(4408);
    expect(a.frames.length).toBeLessThan(8);
  });

  it('keeps a socket that answers pings and closes one whose session ended', async () => {
    const a = open('token-a');
    await a.opened;

    await gateway.checkHeartbeats();
    await new Promise((resolve) => setTimeout(resolve, 50));
    sessions.delete('token-a');
    try {
      await gateway.checkHeartbeats();
      expect(await a.closed).toBe(4401);
    } finally {
      sessions.set('token-a', 'user-a');
    }
  });

  it('keeps the socket when the session lookup fails', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const a = open('token-a');
    await a.opened;

    sessionLookupFails = true;
    try {
      await gateway.checkHeartbeats();
    } finally {
      sessionLookupFails = false;
    }
    hub.emit('user-a', 'still-open');

    await vi.waitFor(() => expect(a.frames).toContain('still-open'));
    expect(warn).toHaveBeenCalledWith(
      'Live session check failed; keeping the socket: database unavailable',
    );
  });

  it('terminates a socket that did not answer the previous ping', async () => {
    const a = open('token-a', { autoPong: false });
    await a.opened;

    await gateway.checkHeartbeats();
    await gateway.checkHeartbeats();

    expect(await a.closed).toBe(1006);
  });

  it('closes every socket and stops accepting upgrades on shutdown', async () => {
    const a = open('token-a');
    await a.opened;

    gateway.onModuleDestroy();

    expect(await a.closed).toBe(1001);
    // The server's own close event can follow the client's.
    await vi.waitFor(() => expect(hub.unsubscribed).toBe(2));
    expect(hub.instanceSubscribers.size).toBe(0);
    expect(server.listenerCount('upgrade')).toBe(0);
  });

  it('survives a client reset while its session is being validated', async () => {
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = new LiveGatewayService(
      { httpAdapter: { getHttpServer: () => server } },
      {
        validateToken: (token: string) =>
          pending.then(() => auth.validateToken(token)),
      },
      hub,
    );
    gateway.onModuleDestroy();
    slow.onApplicationBootstrap();
    gateway = slow;
    const address = server.address();
    if (!address || isString(address)) throw new Error('expected TCP address');

    const raw = connect(address.port, '127.0.0.1');
    await new Promise<void>((resolve) => raw.on('connect', () => resolve()));
    raw.write(
      [
        `GET ${LIVE_PATH} HTTP/1.1`,
        'Host: 127.0.0.1',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
        'Authorization: Bearer token-a',
        '',
        '',
      ].join('\r\n'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    raw.resetAndDestroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(hub.subscribers.size).toBe(0);
  });

  it('refuses a server that is not a Node HTTP server', () => {
    const broken = new LiveGatewayService(
      { httpAdapter: { getHttpServer: () => ({}) } },
      auth,
      hub,
    );
    expect(() => broken.onApplicationBootstrap()).toThrow(
      'LiveGatewayService requires a Node HTTP server',
    );
  });
});
