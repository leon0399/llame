/**
 * Live gateway — `GET /api/v1/live` WebSocket upgrade, owner-scoped.
 *
 * The socket is authorized before the `101` response: the session token comes
 * from the same bearer-or-cookie extraction the HTTP guard uses and is
 * validated by `AuthService`. A browser attaches cookies to a WebSocket
 * upgrade from any site and CORS does not apply to it, so a request whose
 * `Origin` is not an allowed web origin is refused (cross-site WebSocket
 * hijacking). Non-browser clients send no `Origin` and authenticate with a
 * bearer token or cookie like any API client.
 *
 * Each socket is bound to its authenticated owner at upgrade and receives only
 * that owner's messages; the client sends nothing the server acts on. The
 * session is re-validated on every heartbeat, so a logout or revocation closes
 * the socket within one interval.
 */

import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { IncomingMessage } from 'node:http';
import { Server } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';

import { getAllowedWebOrigins } from '../app.setup';
import { AuthService } from '../auth/auth.service';
import { getRequestToken } from '../auth/session-auth.guard';
import {
  ChangeHubService,
  type ChangeHubSubscriptions,
} from './change-hub.service';
import type { LiveMessage } from './live-messages';

export const LIVE_PATH = '/api/v1/live';
/** Heartbeat and session re-validation cadence. */
const HEARTBEAT_MS = 30_000;
/** Open sockets per user (tabs and devices). */
export const MAX_SOCKETS_PER_USER = 16;
/** A socket this far behind is closed rather than buffered without bound. */
const MAX_BUFFERED_BYTES = 1024 * 1024;

/** Close codes in the application range (4000-4999). */
const CLOSE_SESSION_ENDED = 4401;
const CLOSE_TOO_SLOW = 4408;

export type LiveAuth = Pick<AuthService, 'validateToken'>;

type LiveSocket = {
  socket: WebSocket;
  userId: string;
  token: string;
  alive: boolean;
  unsubscribe: () => void;
};

@Injectable()
export class LiveGatewayService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly sockets = new Set<LiveSocket>();
  private readonly allowedOrigins: ReadonlySet<string> = new Set(
    getAllowedWebOrigins(),
  );
  private heartbeat: NodeJS.Timeout | undefined;
  private server: Server | undefined;
  private readonly onUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void this.upgrade(request, socket, head);

  constructor(
    @Inject(HttpAdapterHost)
    private readonly adapterHost: HttpAdapterHost,
    @Inject(AuthService)
    private readonly auth: LiveAuth,
    @Inject(ChangeHubService)
    private readonly hub: ChangeHubSubscriptions,
  ) {}

  onApplicationBootstrap(): void {
    // The HTTP server exists from application creation, before listen(), so
    // tests that listen(0) get the upgrade handler too.
    // http.Server and https.Server both extend net.Server.
    const server: unknown = this.adapterHost.httpAdapter.getHttpServer();
    if (!(server instanceof Server)) {
      throw new Error('LiveGatewayService requires a Node HTTP server');
    }
    this.server = server;
    server.on('upgrade', this.onUpgrade);
    this.heartbeat = setInterval(() => void this.beat(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeat);
    this.server?.off('upgrade', this.onUpgrade);
    for (const live of this.sockets) {
      live.unsubscribe();
      live.socket.close(1001, 'server shutting down');
    }
    this.sockets.clear();
    this.wss.close();
  }

  private async upgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const decision = await decideUpgrade(request, {
      allowedOrigins: this.allowedOrigins,
      validateToken: (token) => this.auth.validateToken(token),
      openSockets: (userId) => this.countFor(userId),
    });
    if (decision.kind === 'ignore') return; // not ours; leave it for any other handler
    if (decision.kind === 'reject') {
      return reject(socket, decision.status, decision.reason);
    }
    this.wss.handleUpgrade(request, socket, head, (ws) =>
      this.attach(ws, decision.userId, decision.token),
    );
  }

  private attach(socket: WebSocket, userId: string, token: string): void {
    const live: LiveSocket = {
      socket,
      userId,
      token,
      alive: true,
      unsubscribe: () => undefined,
    };
    live.unsubscribe = this.hub.subscribe(userId, (message) =>
      this.deliver(live, message),
    );
    this.sockets.add(live);
    socket.on('pong', () => {
      live.alive = true;
    });
    socket.on('close', () => {
      live.unsubscribe();
      this.sockets.delete(live);
    });
    socket.on('error', () => socket.terminate());
    // Inbound frames are ignored: the client has nothing to subscribe to.
  }

  private deliver(live: LiveSocket, message: LiveMessage): void {
    if (live.socket.readyState !== WebSocket.OPEN) return;
    if (live.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      live.socket.close(CLOSE_TOO_SLOW, 'client too slow');
      return;
    }
    live.socket.send(JSON.stringify(message));
  }

  private async beat(): Promise<void> {
    for (const live of this.sockets) {
      if (!live.alive) {
        live.socket.terminate();
        continue;
      }
      live.alive = false;
      live.socket.ping();
      const session = await this.auth
        .validateToken(live.token)
        .catch(() => undefined);
      if (session?.userId !== live.userId) {
        live.socket.close(CLOSE_SESSION_ENDED, 'session ended');
      }
    }
  }

  private countFor(userId: string): number {
    let count = 0;
    for (const live of this.sockets) if (live.userId === userId) count += 1;
    return count;
  }
}

export type UpgradeDecision =
  | { kind: 'ignore' }
  | { kind: 'reject'; status: 401 | 403 | 429; reason: string }
  | { kind: 'accept'; userId: string; token: string };

export type UpgradeDeps = {
  allowedOrigins: ReadonlySet<string>;
  validateToken: LiveAuth['validateToken'];
  openSockets: (userId: string) => number;
};

/**
 * Whether to accept an upgrade request, and as whom. Another path is ignored.
 * A browser `Origin` outside the allowlist is refused before the session is
 * looked at; a missing, invalid, or failing session is refused; a user at the
 * socket cap is refused.
 */
export async function decideUpgrade(
  request: Pick<IncomingMessage, 'url' | 'headers'>,
  deps: UpgradeDeps,
): Promise<UpgradeDecision> {
  const path = (request.url ?? '').split('?')[0];
  if (path !== LIVE_PATH) return { kind: 'ignore' };
  const origin = request.headers.origin;
  if (origin !== undefined && !deps.allowedOrigins.has(origin)) {
    return { kind: 'reject', status: 403, reason: 'Forbidden' };
  }
  const token = getRequestToken(request);
  const session = token
    ? await deps.validateToken(token).catch(() => undefined)
    : undefined;
  if (!token || !session?.userId) {
    return { kind: 'reject', status: 401, reason: 'Unauthorized' };
  }
  if (deps.openSockets(session.userId) >= MAX_SOCKETS_PER_USER) {
    return { kind: 'reject', status: 429, reason: 'Too Many Requests' };
  }
  return { kind: 'accept', userId: session.userId, token };
}

function reject(socket: Duplex, status: number, reason: string): void {
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}
