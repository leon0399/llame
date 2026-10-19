/**
 * One Machine session over a real wire: the handshake, the effect fence
 * (`sent`), the refusal paths, and every stream event that ends a session.
 * `createProtocolPeer` answers the wire wherever a peer can; the cases a peer
 * cannot express — an oversize line, an unreadable handshake answer, a write
 * that throws — drive a hand-made pipe pair instead.
 */

import { PassThrough, Readable } from 'node:stream';

import {
  CANCEL_NOTIFICATION,
  CONTROL_STREAM_ID,
  createLineFramer,
  decodeFrame,
  encodeFrame,
  JSON_RPC_INVALID_PARAMS,
  MAX_CONCURRENT_STREAMS,
  MAX_FRAME_BYTES,
  MAX_MESSAGE_BYTES,
  MachineProtocolError,
  PING_NOTIFICATION,
  PROTOCOL_VERSION,
  StreamClosedError,
  type Frame,
  type JsonRpcError,
  type JsonRpcRequest,
} from '@workspace/machine-protocol';

import {
  createProtocolPeer,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';

import {
  MachineSession,
  MachineUnavailableError,
  type MachineCall,
  type MachineSessionOptions,
} from './machine-session';
import type { MachineLinkEnd, MachineTransport } from './machine-transport';

const NAME = 'devl';
const HUB_VERSION = '9.9.9';
/** Liveness has its own test; every other test keeps the session quiet. */
const HEARTBEAT_OFF_MS = 60_000;
const ENVELOPE = { budgetMs: 30_000 };
const HELLO = {
  protocolVersion: PROTOCOL_VERSION,
  daemonVersion: '1.2.3',
  roots: ['/srv/app'],
};
const ROOTS_CALL: MachineCall<'roots.list'> = {
  method: 'roots.list',
  params: { envelope: ENVELOPE },
};
const FS_STAT_CALL: MachineCall<'fs.stat'> = {
  method: 'fs.stat',
  params: { envelope: ENVELOPE, path: '/srv/app/a.ts' },
};
const MCP_OPEN_CALL: MachineCall<'mcp.open'> = {
  method: 'mcp.open',
  params: { envelope: ENVELOPE, root: '/srv/app', server: 'repo' },
};

/** Sessions this test opened, closed once it is done with them. */
const live: Array<MachineSession> = [];

afterEach(() => {
  for (const session of live.splice(0)) session.close();
});

type LocalLink = {
  readonly transport: MachineTransport;
  /** Every frame the session wrote, decoded as it reached the wire. */
  readonly frames: ReadonlyArray<Frame>;
  /** How many times the session asked the link to end. */
  readonly closes: () => number;
  /** The next frame the session writes that `match` accepts. */
  nextFrame(match: (frame: Frame) => boolean): Promise<Frame>;
  /** One well-formed frame from the Machine. */
  sendFrame(frame: Frame): void;
  /** One raw line from the Machine, exactly as it arrived. */
  sendLine(line: string): void;
  /** How the link ended: its exit status, its stderr, and who closed it. */
  resolveEnd(end: MachineLinkEnd): void;
  /** The Machine's side ended cleanly: EOF and no close. */
  endInput(): void;
  /** The link was killed: close and no EOF. */
  closeInput(): void;
  /** The input stream itself failed. */
  failInput(error: Error): void;
  /** The output stream itself failed. */
  failOutput(error: Error): void;
};

/**
 * The hub's side of the wire by hand, for what a peer cannot express. The
 * input is a `Readable` that never destroys itself, so EOF, an abrupt close,
 * and a stream error are each delivered alone — exactly one session event.
 */
function localLink(
  options: {
    readonly inputEmitClose?: boolean;
    /** Make the link's write side throw, as a broken pipe does. */
    readonly writeError?: Error;
  } = {},
): LocalLink {
  const input = new Readable({
    read() {},
    autoDestroy: false,
    emitClose: options.inputEmitClose ?? true,
  });
  const output = new PassThrough();
  if (options.writeError !== undefined) {
    const { writeError } = options;
    output.write = () => {
      throw writeError;
    };
  }
  const end = Promise.withResolvers<MachineLinkEnd>();
  const frames: Array<Frame> = [];
  const waiters: Array<{
    readonly match: (frame: Frame) => boolean;
    readonly resolve: (frame: Frame) => void;
  }> = [];
  const framer = createLineFramer();
  output.on('data', (chunk: Buffer) => {
    for (const event of framer.push(chunk)) {
      if (event.kind !== 'line') continue;
      const decoded = decodeFrame(event.line);
      if (!decoded.ok) continue;
      frames.push(decoded.frame);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (waiter === undefined || !waiter.match(decoded.frame)) continue;
        waiters.splice(index, 1);
        waiter.resolve(decoded.frame);
      }
    }
  });
  let closes = 0;
  return {
    transport: {
      input,
      output,
      close: () => {
        closes += 1;
      },
      ended: end.promise,
    },
    frames,
    closes: () => closes,
    nextFrame: (match) => {
      const seen = frames.find(match);
      if (seen !== undefined) return Promise.resolve(seen);
      const { promise, resolve } = Promise.withResolvers<Frame>();
      waiters.push({ match, resolve });
      return promise;
    },
    sendFrame: (frame) => input.push(encodeFrame(frame)),
    sendLine: (line) => input.push(`${line}\n`),
    resolveEnd: (linkEnd) => end.resolve(linkEnd),
    endInput: () => input.push(null),
    closeInput: () => input.destroy(),
    failInput: (error) => input.destroy(error),
    failOutput: (error) => output.destroy(error),
  };
}

/** A hub session over a hand-made link. */
function pipeSession(
  link: LocalLink,
  options: Partial<MachineSessionOptions> = {},
): MachineSession {
  return track(
    new MachineSession({
      name: NAME,
      transport: link.transport,
      hubVersion: HUB_VERSION,
      handshakeTimeoutMs: 500,
      heartbeatIntervalMs: HEARTBEAT_OFF_MS,
      ...options,
    }),
  );
}

/** A hub session over the peer's real wire. */
function peerSession(options: ProtocolPeerOptions = {}) {
  const peer = createProtocolPeer(options);
  const session = track(
    new MachineSession({
      name: NAME,
      transport: peer.factory.open({ name: NAME, destination: 'box' }),
      hubVersion: HUB_VERSION,
      handshakeTimeoutMs: 2000,
      heartbeatIntervalMs: HEARTBEAT_OFF_MS,
    }),
  );
  return { peer, session };
}

function track(session: MachineSession): MachineSession {
  live.push(session);
  return session;
}

/** A frame the session wrote, narrowed to the request it carries. */
function isRequest(
  method: string,
): (frame: Frame) => frame is Frame & { readonly m: JsonRpcRequest } {
  return (frame): frame is Frame & { readonly m: JsonRpcRequest } =>
    'method' in frame.m && frame.m.method === method && 'id' in frame.m;
}

/** A frame the session wrote, narrowed to the refusal on one stream. */
function isErrorOn(
  streamId: number,
): (frame: Frame) => frame is Frame & { readonly m: JsonRpcError } {
  return (frame): frame is Frame & { readonly m: JsonRpcError } =>
    frame.s === streamId && 'error' in frame.m;
}

/** A frame the session wrote, narrowed to one notification. */
function isNotification(method: string): (frame: Frame) => boolean {
  return (frame) => 'method' in frame.m && frame.m.method === method;
}

/** The next frame the session writes that `match` accepts, narrowed by it. */
async function awaitFrame<T extends Frame>(
  link: LocalLink,
  match: (frame: Frame) => frame is T,
): Promise<T> {
  const frame = await within(link.nextFrame(match));
  if (!match(frame))
    throw new Error('The session wrote a frame this test did not await.');
  return frame;
}

/** A promise that must settle within `ms`, so a session that never ends fails a test instead of hanging it. */
function within<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  const bounded = Promise.withResolvers<T>();
  const timer = setTimeout(
    () =>
      bounded.reject(new Error(`The promise did not settle within ${ms}ms.`)),
    ms,
  );
  timer.unref();
  void promise.then(
    (value) => {
      clearTimeout(timer);
      bounded.resolve(value);
    },
    (error: unknown) => {
      clearTimeout(timer);
      bounded.reject(error);
    },
  );
  return bounded.promise;
}

/** Let the session's own stream and promise callbacks run, with no guessed delay. */
async function settle(): Promise<void> {
  const turn = Promise.withResolvers<void>();
  setImmediate(turn.resolve);
  await turn.promise;
  await Promise.resolve();
}

/** A call that must have failed: its rejection as an Error. */
async function failedCall(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('The call resolved instead of failing.');
}

/** A call that must have thrown before it could send: its error as an Error. */
function thrownCall(call: () => void): Error {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error('The call returned instead of throwing.');
}

/** The refusal a call failed with, for the assertions on its fields. */
function refusal(error: unknown): MachineUnavailableError {
  if (error instanceof MachineUnavailableError) return error;
  throw error;
}

/** The Machine's own refusal, for the assertions on its code. */
function protocolError(error: unknown): MachineProtocolError {
  if (error instanceof MachineProtocolError) return error;
  throw error;
}

describe('MachineSession link ends', () => {
  it("ends on the Machine's EOF with the link's own diagnostic", async () => {
    const link = localLink();
    const session = pipeSession(link);
    link.resolveEnd({
      code: 255,
      signal: null,
      diagnostic: 'me@box: Permission denied (publickey).',
      closedByHub: false,
    });
    link.endInput();
    await expect(within(session.ended)).resolves.toEqual({
      reason: 'auth_failed',
      established: false,
    });
    expect(session.endReason).toEqual({
      reason: 'auth_failed',
      established: false,
    });
    expect(session.isReady).toBe(false);
    expect(link.closes()).toBe(1);
  });

  it("ends when the link is killed, reading ssh's host key refusal", async () => {
    const link = localLink();
    const session = pipeSession(link);
    link.resolveEnd({
      code: 255,
      signal: null,
      diagnostic: 'Host key verification failed.',
      closedByHub: false,
    });
    link.closeInput();
    await expect(within(session.ended)).resolves.toEqual({
      reason: 'host_key_mismatch',
      established: false,
    });
  });

  it('ends when the input stream itself fails', async () => {
    const link = localLink({ inputEmitClose: false });
    const session = pipeSession(link);
    link.resolveEnd({
      code: 255,
      signal: null,
      diagnostic: 'ssh: connect to host box port 22: Connection timed out',
      closedByHub: false,
    });
    link.failInput(new Error('read ECONNRESET'));
    await expect(within(session.ended)).resolves.toEqual({
      reason: 'unreachable',
      established: false,
    });
  });

  it('ends when the output stream itself fails', async () => {
    const link = localLink();
    const session = pipeSession(link);
    link.resolveEnd({
      code: 255,
      signal: null,
      diagnostic: '',
      closedByHub: false,
    });
    link.failOutput(new Error('write EPIPE'));
    await expect(within(session.ended)).resolves.toEqual({
      reason: 'unreachable',
      established: false,
    });
  });

  it('pings once per interval, then ends the session on its own silence', async () => {
    const link = localLink();
    // Eight intervals of silence: on a loaded machine a late tick can only
    // shorten the ping run, never stretch it past the deadline the session
    // itself measured.
    const session = pipeSession(link, {
      heartbeatIntervalMs: 50,
      heartbeatMisses: 8,
    });
    const started = Date.now();
    await expect(within(session.ended)).resolves.toEqual({
      reason: 'session_lost',
      established: false,
    });
    // One ping per interval, and none once the peer stayed silent for the window.
    const written = link.frames.filter((frame) =>
      isNotification(PING_NOTIFICATION)(frame),
    );
    expect(written.length).toBeGreaterThan(1);
    expect(written.length).toBeLessThanOrEqual(7);
    // The third of the window would have ended the session far sooner.
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
  });

  it('closes politely, keeps the first reason, and closes the link once', async () => {
    const link = localLink();
    const session = pipeSession(link);
    link.resolveEnd({
      code: 255,
      signal: null,
      diagnostic: 'Host key verification failed.',
      closedByHub: false,
    });
    session.close();
    await expect(session.ended).resolves.toEqual({
      reason: 'closed',
      established: false,
    });
    expect(session.endReason).toEqual({
      reason: 'closed',
      established: false,
    });
    expect(link.closes()).toBe(1);
    // The input's own close runs the link classifier again; the first reason stands.
    await settle();
    expect(session.endReason).toEqual({
      reason: 'closed',
      established: false,
    });
    expect(link.closes()).toBe(1);
  });
});

describe('MachineSession handshake', () => {
  it('answers the handshake once and remembers it', async () => {
    const link = localLink();
    const session = pipeSession(link);
    const answer = session.ready();
    const request = await awaitFrame(link, isRequest('hello'));
    expect(request.s).toBe(CONTROL_STREAM_ID);
    expect(request.m.params).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      hubVersion: HUB_VERSION,
    });
    link.sendFrame({
      s: CONTROL_STREAM_ID,
      m: { jsonrpc: '2.0', id: request.m.id, result: HELLO },
    });
    await expect(session.ready()).resolves.toEqual(HELLO);
    await expect(answer).resolves.toEqual(HELLO);
    expect(session.hello).toEqual(HELLO);
    expect(session.isReady).toBe(true);
    expect(
      link.frames.filter((frame) => isRequest('hello')(frame)),
    ).toHaveLength(1);
  });

  it('refuses an answer whose protocol version differs', async () => {
    const link = localLink();
    const session = pipeSession(link);
    const answer = session.ready();
    const request = await awaitFrame(link, isRequest('hello'));
    link.sendFrame({
      s: CONTROL_STREAM_ID,
      m: {
        jsonrpc: '2.0',
        id: request.m.id,
        result: { ...HELLO, protocolVersion: PROTOCOL_VERSION + 1 },
      },
    });
    const error = refusal(await failedCall(answer));
    expect(error.name).toBe('MachineUnavailableError');
    expect(error.machine).toBe(NAME);
    expect(error.reason).toBe('incompatible_version');
    expect(error.sent).toBe(false);
    expect(error.message).toBe('The Machine answered an unusable handshake.');
    expect(session.hello).toBeUndefined();
    await expect(session.ended).resolves.toEqual({
      reason: 'incompatible_version',
      established: false,
    });
  });

  it('refuses an answer it cannot read', async () => {
    const link = localLink();
    const session = pipeSession(link);
    const answer = session.ready();
    const request = await awaitFrame(link, isRequest('hello'));
    link.sendFrame({
      s: CONTROL_STREAM_ID,
      m: { jsonrpc: '2.0', id: request.m.id, result: { hello: 'yes' } },
    });
    const error = refusal(await failedCall(answer));
    expect(error.reason).toBe('incompatible_version');
    expect(error.message).toBe('The Machine answered an unusable handshake.');
  });

  it("reports the daemon's own refusal with its message", async () => {
    const { session } = peerSession({ helloProtocolVersion: 99 });
    const error = refusal(await failedCall(session.ready()));
    expect(error.reason).toBe('incompatible_version');
    expect(error.sent).toBe(false);
    expect(error.message).toBe(
      'The Machine refused the handshake: version mismatch',
    );
    await expect(session.ended).resolves.toEqual({
      reason: 'incompatible_version',
      established: false,
    });
  });

  it('gives up on a handshake that never answers', async () => {
    const link = localLink();
    const session = pipeSession(link, { handshakeTimeoutMs: 30 });
    const error = refusal(await failedCall(within(session.ready(), 1000)));
    expect(error.reason).toBe('unreachable');
    expect(error.sent).toBe(false);
    await expect(session.ended).resolves.toEqual({
      reason: 'unreachable',
      established: false,
    });
  });

  it('clears the handshake timer once the handshake answered', async () => {
    const link = localLink();
    const session = pipeSession(link, { handshakeTimeoutMs: 40 });
    const answer = session.ready();
    const request = await awaitFrame(link, isRequest('hello'));
    link.sendFrame({
      s: CONTROL_STREAM_ID,
      m: { jsonrpc: '2.0', id: request.m.id, result: HELLO },
    });
    await expect(answer).resolves.toEqual(HELLO);
    // A real wait: only the clock can show that the handshake timer is gone.
    const quiet = Promise.withResolvers<void>();
    setTimeout(quiet.resolve, 160);
    await quiet.promise;
    expect(session.endReason).toBeUndefined();
    expect(session.isReady).toBe(true);
  });
});

describe('MachineSession readiness', () => {
  it('is ready only between the handshake and the end', async () => {
    const { peer, session } = peerSession();
    expect(session.isReady).toBe(false);
    await expect(session.ready()).resolves.toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(session.isReady).toBe(true);
    const machine = await peer.session(0);
    machine.drop();
    await expect(within(session.ended)).resolves.toEqual({
      reason: 'session_lost',
      established: true,
    });
    expect(session.isReady).toBe(false);
  });
});

describe('MachineSession request fence', () => {
  it('refuses a request whose signal was already aborted, passing it through', async () => {
    const link = localLink();
    const session = pipeSession(link);
    const given = new Error('the caller gave up');
    const error = await failedCall(
      session.request(ROOTS_CALL, { signal: AbortSignal.abort(given) }),
    );
    expect(error).toBe(given);
    expect(error).not.toBeInstanceOf(MachineUnavailableError);
    expect(link.frames).toHaveLength(0);
    expect(session.endReason).toBeUndefined();
  });

  it('fails a request and a channel on an ended session without sending', async () => {
    const link = localLink();
    const session = pipeSession(link);
    session.close();
    const error = refusal(await failedCall(session.request(ROOTS_CALL)));
    expect(error.name).toBe('MachineUnavailableError');
    expect(error.machine).toBe(NAME);
    expect(error.reason).toBe('session_lost');
    expect(error.sent).toBe(false);
    expect(error.message).toBe('The Machine session has already ended.');
    expect(() => session.openChannel(MCP_OPEN_CALL)).toThrow(
      MachineUnavailableError,
    );
    expect(link.frames).toHaveLength(0);
  });

  it('keeps the reason of a session that never started for a later request', async () => {
    const link = localLink();
    const session = pipeSession(link);
    link.resolveEnd({
      code: 255,
      signal: null,
      diagnostic: 'Host key verification failed.',
      closedByHub: false,
    });
    link.closeInput();
    await expect(within(session.ended)).resolves.toEqual({
      reason: 'host_key_mismatch',
      established: false,
    });
    const error = refusal(await failedCall(session.request(ROOTS_CALL)));
    expect(error.reason).toBe('host_key_mismatch');
    expect(error.sent).toBe(false);
    expect(error.message).toBe('The Machine session has already ended.');
    expect(link.frames).toHaveLength(0);
  });

  it('reports a request in flight when the session closes politely as lost', async () => {
    const { peer, session } = peerSession({
      answers: { 'roots.list': { hold: true } },
    });
    await session.ready();
    const call = failedCall(session.request(ROOTS_CALL));
    const machine = await peer.session(0);
    await machine.awaitRequests(1);
    session.close();
    const error = refusal(await call);
    expect(error.reason).toBe('session_lost');
    expect(error.sent).toBe(true);
  });

  it('reports a request lost after its frame was written as sent', async () => {
    const { peer, session } = peerSession({
      answers: { 'fs.stat': { hold: true } },
    });
    await session.ready();
    const call = failedCall(session.request(FS_STAT_CALL));
    const machine = await peer.session(0);
    await machine.awaitRequests(1);
    machine.drop({ code: 255, diagnostic: 'Connection reset by peer' });
    const error = refusal(await call);
    expect(error.reason).toBe('session_lost');
    expect(error.sent).toBe(true);
    expect(error.message).toBe('Stream 1 was closed.');
  });

  it('reports a request whose frame never reached the wire as unsent', async () => {
    const link = localLink({ writeError: new Error('write EPIPE') });
    const session = pipeSession(link);
    const error = refusal(await failedCall(session.request(ROOTS_CALL)));
    expect(error.reason).toBe('session_lost');
    expect(error.sent).toBe(false);
    await expect(within(session.ended)).resolves.toEqual({
      reason: 'session_lost',
      established: false,
    });
    expect(link.frames).toHaveLength(0);
  });

  it("passes the Machine's own refusal through unchanged", async () => {
    const { session } = peerSession({
      answers: { 'roots.list': { error: 'path_not_registered' } },
    });
    await session.ready();
    const error = protocolError(await failedCall(session.request(ROOTS_CALL)));
    expect(error.name).toBe('MachineProtocolError');
    expect(error.code).toBe('path_not_registered');
    expect(error.message).toBe('the peer refused roots.list');
  });

  it('refuses an answer above the frame byte bound without ending the session', async () => {
    const link = localLink();
    const session = pipeSession(link);
    const call = failedCall(
      session.request({
        method: 'fs.stat',
        params: {
          envelope: ENVELOPE,
          path: 'p'.repeat(MAX_MESSAGE_BYTES + 100),
        },
      }),
    );
    const refused = await awaitFrame(link, isErrorOn(1));
    expect(refused.m.error.message).toBe(
      'The answer exceeds the frame byte bound of this protocol.',
    );
    expect(refused.m.error.data).toEqual({ code: 'internal' });
    expect(refusal(await call).reason).toBe('session_lost');
    expect(session.endReason).toBeUndefined();
  });
});

describe('MachineSession channels', () => {
  it('refuses a channel past the session stream cap without ending it', async () => {
    const link = localLink();
    const session = pipeSession(link);
    const open = Array.from({ length: MAX_CONCURRENT_STREAMS }, () =>
      session.openChannel(MCP_OPEN_CALL),
    );
    const error = refusal(thrownCall(() => session.openChannel(MCP_OPEN_CALL)));
    expect(error.reason).toBe('session_lost');
    expect(error.sent).toBe(false);
    expect(error.message).toBe(
      'The Machine session already carries the maximum number of streams.',
    );
    expect(link.frames).toHaveLength(MAX_CONCURRENT_STREAMS);
    expect(session.openStreams).toBe(MAX_CONCURRENT_STREAMS);
    expect(session.endReason).toBeUndefined();
    // The cap holds 64 streams; closing them settles the answers they await.
    for (const handle of open) handle.channel.close();
    expect(session.openStreams).toBe(0);
    await Promise.allSettled(open.map((handle) => handle.result));
  });

  it("cancels a channel's stream when the caller aborts", async () => {
    const link = localLink();
    const session = pipeSession(link);
    const abort = new AbortController();
    const handle = session.openChannel(MCP_OPEN_CALL, {
      signal: abort.signal,
    });
    const request = await awaitFrame(link, isRequest('mcp.open'));
    expect(handle.channel.id).toBe(request.s);
    abort.abort();
    const cancel = await within(
      link.nextFrame(isNotification(CANCEL_NOTIFICATION)),
    );
    expect(cancel).toEqual({
      s: request.s,
      m: { jsonrpc: '2.0', method: CANCEL_NOTIFICATION },
    });
    await expect(handle.result).rejects.toBeInstanceOf(StreamClosedError);
    expect(session.endReason).toBeUndefined();
  });

  it('reports a channel lost with the session as sent', async () => {
    const { peer, session } = peerSession({
      answers: { 'mcp.open': { hold: true } },
    });
    await session.ready();
    const handle = session.openChannel(MCP_OPEN_CALL);
    const machine = await peer.session(0);
    await machine.awaitRequests(1);
    machine.drop({ diagnostic: 'Connection reset by peer' });
    const error = refusal(await failedCall(handle.result));
    expect(error.reason).toBe('session_lost');
    expect(error.sent).toBe(true);
  });

  it('reports a channel whose frame never reached the wire as unsent', async () => {
    const link = localLink({ writeError: new Error('write EPIPE') });
    const session = pipeSession(link);
    const handle = session.openChannel(MCP_OPEN_CALL);
    const error = refusal(await failedCall(handle.result));
    expect(error.reason).toBe('session_lost');
    expect(error.sent).toBe(false);
    expect(link.frames).toHaveLength(0);
  });
});

describe('MachineSession unusable inbound lines', () => {
  it('refuses an oversize message that names a stream', async () => {
    const link = localLink();
    const session = pipeSession(link);
    const call = failedCall(session.request(FS_STAT_CALL));
    const request = await awaitFrame(link, isRequest('fs.stat'));
    // A message over the message bound inside a line still under the frame bound.
    link.sendLine(
      JSON.stringify({ s: request.s, m: 'x'.repeat(MAX_MESSAGE_BYTES + 64) }),
    );
    const refused = await awaitFrame(link, isErrorOn(request.s));
    expect(refused.m.id).toBe(request.m.id);
    expect(refused.m.error).toEqual({
      code: JSON_RPC_INVALID_PARAMS,
      message: 'The frame exceeds the byte bound of this protocol.',
      data: { code: 'invalid_params' },
    });
    expect(refusal(await call).reason).toBe('session_lost');
    expect(session.endReason).toBeUndefined();
  });

  it('refuses a malformed frame that names a stream', async () => {
    const link = localLink();
    const session = pipeSession(link);
    const call = failedCall(session.request(FS_STAT_CALL));
    const request = await awaitFrame(link, isRequest('fs.stat'));
    link.sendLine(JSON.stringify({ s: request.s, m: { jsonrpc: '2.0' } }));
    const refused = await awaitFrame(link, isErrorOn(request.s));
    expect(refused.m.error.message).toBe(
      'The frame is not a JSON-RPC message.',
    );
    expect(refused.m.error.data).toEqual({ code: 'invalid_params' });
    expect(refusal(await call).reason).toBe('session_lost');
    expect(session.endReason).toBeUndefined();
  });

  it('stays silent for an unusable line that names no stream', async () => {
    const link = localLink();
    const session = pipeSession(link);
    const call = session.request(ROOTS_CALL);
    const request = await awaitFrame(link, isRequest('roots.list'));
    link.sendLine('this is not a frame');
    link.sendLine(JSON.stringify({ s: 'one', m: { jsonrpc: '2.0' } }));
    link.sendFrame({
      s: request.s,
      m: { jsonrpc: '2.0', id: request.m.id, result: { roots: ['/srv/app'] } },
    });
    // The open request still answers: the two unusable lines were dropped, not sent back.
    await expect(call).resolves.toEqual({ roots: ['/srv/app'] });
    expect(link.frames).toHaveLength(1);
    expect(session.endReason).toBeUndefined();
  });

  it('ends the session when a line grows past the frame byte bound', async () => {
    const link = localLink();
    const session = pipeSession(link);
    link.sendLine('x'.repeat(MAX_FRAME_BYTES + 1));
    await expect(within(session.ended)).resolves.toEqual({
      reason: 'session_lost',
      established: false,
    });
  });
});
