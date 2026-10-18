import { drizzle } from 'drizzle-orm/postgres-js';

import {
  BYTES_CHUNK_BYTES,
  PATH_NOT_REGISTERED_MESSAGE,
} from '@workspace/machine-protocol';
import { type MediaReadHook } from '@workspace/native-file-tools';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { MachineConnector } from '../machines/machine-connector.service';
import { type MachineStatusView } from '../machines/machines-status';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import {
  createProtocolPeer,
  type PeerSession,
  type ProtocolPeer,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';
import { bashTool } from './bash';
import {
  nativeEditTool,
  nativeReadTool,
  nativeWriteTool,
} from './native-files';
import { runTool } from './runner';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import { type ToolContext } from './types';
import { type ToolMediaStore } from '../media/tool-media-store';
import { createWorkspaceRootCell } from './workspace-path';

const MACHINES = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: {
    devl: { destination: 'box' },
    gpu: { destination: 'me@gpu.lan:2222' },
  },
};

const STATUS: ReadonlyArray<MachineStatusView> = [
  {
    name: 'devl',
    status: 'online',
    lastSeenAt: '2026-10-18T00:00:00.000Z',
    failureReason: null,
    hubProtocolVersion: 1,
    daemonProtocolVersion: 1,
    daemonVersion: '1.0.0',
    roots: ['/srv/app'],
  },
  {
    name: 'gpu',
    status: 'offline',
    lastSeenAt: null,
    failureReason: 'unreachable',
    hubProtocolVersion: 1,
    daemonProtocolVersion: null,
    daemonVersion: null,
    roots: [],
  },
];

type Fixture = {
  readonly peer: ProtocolPeer;
  readonly connector: MachineConnector;
};

function fixture(options: ProtocolPeerOptions = {}): Fixture {
  const peer = createProtocolPeer(options);
  const connector = new MachineConnector({
    machines: MACHINES,
    hubVersion: '9.9.9',
    transportFactory: peer.factory,
    handshakeTimeoutMs: 2000,
  });
  return { peer, connector };
}

function context(
  connector: MachineConnector,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  const db: Db = drizzle.mock({ schema });
  return {
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    nativeDeliverySequence: 1,
    toolCallId: 'call',
    permissionPolicy: compileTestPermissionPolicy(),
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    machines: connector,
    machineStatus: { list: () => Promise.resolve(STATUS) },
    machineAttemptKey: 'attempt-1',
    ...overrides,
  };
}

/** The durable fence, stubbed: these tests are about what the tool asks for. */
function stubFence() {
  const begin = vi
    .spyOn(NativeFilesRepository.prototype, 'begin')
    .mockResolvedValue(undefined);
  const append = vi
    .spyOn(RunEventsRepository.prototype, 'append')
    .mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });
  return { begin, append };
}

function mediaStore(result: 'image' | 'not-media' = 'image') {
  const handed: Array<{ locator: string; byteSize: number; bytes: Buffer }> =
    [];
  const store: ToolMediaStore = {
    readMedia:
      (locator): MediaReadHook =>
      async ({ byteSize, readBytes }) => {
        const bytes = await readBytes();
        handed.push({ locator, byteSize, bytes });
        return result === 'not-media'
          ? { status: 'error', type: 'unsupported_media_type', message: 'no' }
          : {
              status: 'success',
              kind: 'image',
              mediaType: 'image/png',
              width: 10,
              height: 20,
            };
      },
    findMedia: () => Promise.resolve(undefined),
  };
  return { store, handed };
}

const READ_FILE = {
  status: 'success',
  kind: 'file',
  path: 'machine://devl/srv/app/README.md',
  content: '1: hello',
  truncated: false,
};

describe('Machine native reads', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads on the configured Machine and reports its locator', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.read': { value: READ_FILE } },
    });
    const result = await runTool(
      nativeReadTool,
      { path: 'machine://devl/srv/app/README.md' },
      context(connector),
      5,
    );
    expect(result).toEqual(READ_FILE);
    const session = await peer.session(0);
    expect(session.calls).toEqual([
      {
        method: 'fs.read',
        params: {
          envelope: {
            runId: 'run',
            attemptId: 'attempt-1',
            toolCallId: 'call',
            deliverySeq: 1,
            budgetMs: 5000,
          },
          path: '/srv/app/README.md',
          options: { displayPrefix: 'machine://devl' },
        },
      },
    ]);
  });

  it('splits a selector off the locator and sends the decoded path', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.read': { value: READ_FILE } },
    });
    await runTool(
      nativeReadTool,
      { path: 'MACHINE://DEVL/srv/app/README.md:1-5' },
      context(connector),
      5,
    );
    const session = await peer.session(0);
    expect(session.calls[0]?.params).toMatchObject({
      path: '/srv/app/README.md',
      options: { displayPrefix: 'machine://devl', selector: '1-5' },
    });
  });

  it('re-encodes a reported path so a locator with # round-trips', async () => {
    const { peer, connector } = fixture({
      answers: {
        'fs.read': {
          value: {
            status: 'success',
            kind: 'file',
            path: 'machine://devl/srv/a#b.md',
            realPath: 'machine://devl/srv/a#b.md',
            content: '1: body',
            truncated: false,
          },
        },
      },
    });
    const result = await runTool(
      nativeReadTool,
      { path: 'machine://devl/srv/a%23b.md' },
      context(connector),
      5,
    );
    expect(result).toMatchObject({
      status: 'success',
      path: 'machine://devl/srv/a%23b.md',
      realPath: 'machine://devl/srv/a%23b.md',
    });
    const session = await peer.session(0);
    expect(session.calls[0]?.params).toMatchObject({ path: '/srv/a#b.md' });
  });

  it('re-encodes a directory listing header', async () => {
    const { connector } = fixture({
      answers: {
        'fs.read': {
          value: {
            status: 'success',
            kind: 'directory',
            path: 'machine://devl/srv/a#b',
            content: 'machine://devl/srv/a#b\n  - note.md',
            truncated: false,
          },
        },
      },
    });
    const result = await runTool(
      nativeReadTool,
      { path: 'machine://devl/srv/a%23b' },
      context(connector),
      5,
    );
    expect(result).toMatchObject({
      path: 'machine://devl/srv/a%23b',
      content: 'machine://devl/srv/a%23b\n  - note.md',
    });
  });

  it('refuses an unconfigured Machine without opening a link', async () => {
    const { peer, connector } = fixture();
    await expect(
      runTool(
        nativeReadTool,
        { path: 'machine://nope/etc/hostname' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'machine_not_found' });
    expect(peer.sessions).toHaveLength(0);
  });

  it('refuses a malformed locator as invalid_path', async () => {
    const { connector } = fixture();
    await expect(
      runTool(
        nativeReadTool,
        { path: 'machine://Dev_L/etc/hostname' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'invalid_path' });
  });

  it('reports an unreachable Machine as machine_unavailable', async () => {
    const { connector } = fixture({
      openFailure: () => 'ssh: connect to host box port 22: Connection refused',
    });
    const result = await runTool(
      nativeReadTool,
      { path: 'machine://devl/srv/app/a.ts' },
      context(connector),
      5,
    );
    expect(result).toMatchObject({
      status: 'error',
      type: 'machine_unavailable',
    });
    expect(result).toHaveProperty(
      'message',
      expect.stringContaining('could not be reached'),
    );
  });

  it('maps a bare absolute path inside a Machine Workspace', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.read': { value: READ_FILE } },
    });
    const result = await runTool(
      nativeReadTool,
      { path: '/srv/app/README.md' },
      context(connector, {
        workspaceRoot: createWorkspaceRootCell('machine://devl/srv/app'),
      }),
      5,
    );
    expect(result).toMatchObject({ path: 'machine://devl/srv/app/README.md' });
    const session = await peer.session(0);
    expect(session.calls[0]?.params).toMatchObject({
      path: '/srv/app/README.md',
      options: { displayPrefix: 'machine://devl' },
    });
  });

  it('resolves a relative path on a Machine Workspace', async () => {
    const { peer, connector } = fixture({
      answers: { 'fs.read': { value: READ_FILE } },
    });
    await runTool(
      nativeReadTool,
      { path: 'README.md' },
      context(connector, {
        workspaceRoot: createWorkspaceRootCell('machine://devl/srv/app'),
      }),
      5,
    );
    const session = await peer.session(0);
    expect(session.calls[0]?.params).toMatchObject({
      path: '/srv/app/README.md',
    });
  });

  it('still refuses a local path without a native executor', async () => {
    const { connector } = fixture();
    await expect(
      runTool(
        nativeReadTool,
        { path: '/etc/hostname' },
        context(connector, { nativeExecutorId: undefined }),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'executor_unavailable' });
  });

  it('treats an unconfigured feature as an unknown scheme', async () => {
    const peer = createProtocolPeer();
    const connector = new MachineConnector({
      machines: undefined,
      hubVersion: '9.9.9',
    });
    await expect(
      runTool(
        nativeReadTool,
        { path: 'machine://devl/srv/app/a.ts' },
        context(connector),
        5,
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme is not available.',
    });
    expect(peer.sessions).toHaveLength(0);
  });
});

describe('Machine listings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists the configured Machines with their status and no route', async () => {
    const { connector } = fixture();
    const result = await runTool(
      nativeReadTool,
      { path: 'machine://' },
      context(connector),
      5,
    );
    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      path: 'machine://',
      content:
        '- machine://devl (online)\n- machine://gpu (offline, unreachable)',
    });
    expect(JSON.stringify(result)).not.toContain('box');
    expect(JSON.stringify(result)).not.toContain('gpu.lan');
  });

  it('lists the names without status when no reader is supplied', async () => {
    const { connector } = fixture();
    const result = await runTool(
      nativeReadTool,
      { path: 'machine://' },
      context(connector, { machineStatus: undefined }),
      5,
    );
    expect(result).toMatchObject({
      content: '- machine://devl\n- machine://gpu',
    });
  });

  it('lists a Machine root set as locators', async () => {
    const { peer, connector } = fixture({
      answers: { 'roots.list': { value: { roots: ['/srv/app', '/home/me'] } } },
    });
    const result = await runTool(
      nativeReadTool,
      { path: 'machine://devl' },
      context(connector),
      5,
    );
    expect(result).toMatchObject({
      status: 'success',
      path: 'machine://devl',
      content: '- machine://devl/srv/app/\n- machine://devl/home/me/',
    });
    const session = await peer.session(0);
    expect(session.requests).toEqual(['roots.list']);
  });

  it('says so when a Machine has no registered roots', async () => {
    const { connector } = fixture({
      answers: { 'roots.list': { value: { roots: [] } } },
    });
    await expect(
      runTool(
        nativeReadTool,
        { path: 'machine://devl' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({ content: '(no registered roots)' });
  });

  it('refuses an unconfigured Machine root set without a link', async () => {
    const { peer, connector } = fixture();
    await expect(
      runTool(
        nativeReadTool,
        { path: 'machine://nope' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'machine_not_found' });
    expect(peer.sessions).toHaveLength(0);
  });

  it('refuses both listing forms for a mutation without effect', async () => {
    const { peer, connector } = fixture();
    for (const path of ['machine://', 'machine://devl']) {
      await expect(
        runTool(nativeWriteTool, { path, content: 'x' }, context(connector), 5),
      ).resolves.toMatchObject({
        status: 'error',
        type: 'unsupported_operation',
      });
    }
    expect(peer.sessions).toHaveLength(0);
  });

  it('reports a Machine refusal for roots as a settled result', async () => {
    const { connector } = fixture({
      answers: { 'roots.list': { error: 'path_not_registered' } },
    });
    const result = await runTool(
      nativeReadTool,
      { path: 'machine://devl' },
      context(connector),
      5,
    );
    expect(result).toMatchObject({
      status: 'error',
      type: 'path_not_registered',
      message: PATH_NOT_REGISTERED_MESSAGE,
    });
  });
});

describe('Machine media', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads a 5 MiB image through fs.bytes as a local read would', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(5 * 1024 * 1024, 7),
    ]);
    const { peer, connector } = fixture({
      answers: {
        'fs.read': {
          value: {
            status: 'error',
            type: 'invalid_utf8',
            message: 'The file is not valid UTF-8.',
          },
        },
        'fs.bytes': { hold: true },
      },
    });
    const { store, handed } = mediaStore();
    const call = runTool(
      nativeReadTool,
      { path: 'machine://devl/srv/shot.png' },
      context(connector, { media: store }),
      5,
    );
    const session = await peer.session(0);
    await session.awaitRequests(2);
    await flushMicrotasks();
    sendChunks(session, bytes);
    session.release('fs.bytes', {
      size: bytes.byteLength,
      mediaType: 'image/png',
    });
    await expect(call).resolves.toEqual({
      status: 'success',
      kind: 'image',
      mediaType: 'image/png',
      width: 10,
      height: 20,
      path: 'machine://devl/srv/shot.png',
    });
    expect(handed).toHaveLength(1);
    expect(handed[0]?.byteSize).toBe(bytes.byteLength);
    expect(handed[0]?.bytes.equals(bytes)).toBe(true);
  });

  it('refuses a selector on an image', async () => {
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 7),
    ]);
    const { peer, connector } = fixture({
      answers: {
        'fs.read': {
          value: { status: 'error', type: 'invalid_utf8', message: 'no' },
        },
        'fs.bytes': { hold: true },
      },
    });
    const call = runTool(
      nativeReadTool,
      { path: 'machine://devl/srv/shot.png:1-2' },
      context(connector, { media: mediaStore().store }),
      5,
    );
    const session = await peer.session(0);
    await session.awaitRequests(2);
    await flushMicrotasks();
    sendChunks(session, bytes);
    session.release('fs.bytes', {
      size: bytes.byteLength,
      mediaType: 'image/png',
    });
    await expect(call).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_selector',
      message: 'An image or PDF is read without a selector.',
    });
  });

  it('keeps the text refusal when the bytes are not media', async () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const { peer, connector } = fixture({
      answers: {
        'fs.read': {
          value: { status: 'error', type: 'invalid_utf8', message: 'no' },
        },
        'fs.bytes': { hold: true },
      },
    });
    const call = runTool(
      nativeReadTool,
      { path: 'machine://devl/srv/data.bin' },
      context(connector, { media: mediaStore().store }),
      5,
    );
    const session = await peer.session(0);
    await session.awaitRequests(2);
    await flushMicrotasks();
    sendChunks(session, bytes);
    session.release('fs.bytes', {
      size: bytes.byteLength,
      mediaType: 'application/octet-stream',
    });
    await expect(call).resolves.toMatchObject({
      status: 'error',
      type: 'invalid_utf8',
    });
  });

  it('refuses when the streamed byte count does not match the metadata', async () => {
    const { peer, connector } = fixture({
      answers: {
        'fs.read': {
          value: { status: 'error', type: 'invalid_utf8', message: 'no' },
        },
        'fs.bytes': { hold: true },
      },
    });
    const call = runTool(
      nativeReadTool,
      { path: 'machine://devl/srv/shot.png' },
      context(connector, { media: mediaStore().store }),
      5,
    );
    const session = await peer.session(0);
    await session.awaitRequests(2);
    await flushMicrotasks();
    session.release('fs.bytes', { size: 99, mediaType: 'image/png' });
    await expect(call).resolves.toMatchObject({
      status: 'error',
      type: 'machine_protocol_error',
    });
  });

  it('passes a byte-level refusal through', async () => {
    const { connector } = fixture({
      answers: {
        'fs.read': {
          value: { status: 'error', type: 'invalid_utf8', message: 'no' },
        },
        'fs.bytes': {
          value: { status: 'error', type: 'media_too_large', message: 'big' },
        },
      },
    });
    await expect(
      runTool(
        nativeReadTool,
        { path: 'machine://devl/srv/shot.png' },
        context(connector, { media: mediaStore().store }),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'media_too_large' });
  });

  it('does not take the media path without a media store', async () => {
    const { connector } = fixture({
      answers: {
        'fs.read': {
          value: { status: 'error', type: 'invalid_utf8', message: 'no' },
        },
      },
    });
    await expect(
      runTool(
        nativeReadTool,
        { path: 'machine://devl/srv/shot.png' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'invalid_utf8' });
  });
});

/** The tool registers its notification handler on the microtask after it sends
 *  the request; the in-process peer writes from its own data event, so a test
 *  must let those microtasks run before it answers. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function sendChunks(session: PeerSession, bytes: Buffer): void {
  for (
    let offset = 0, seq = 1;
    offset < bytes.byteLength;
    offset += BYTES_CHUNK_BYTES, seq += 1
  ) {
    session.notify('fs.bytes', 'bytes', {
      seq,
      data: bytes
        .subarray(offset, offset + BYTES_CHUNK_BYTES)
        .toString('base64'),
    });
  }
}

describe('Machine mutations', () => {
  afterEach(() => vi.restoreAllMocks());

  it('edits through the unbound fence and reports the locator', async () => {
    const { begin, append } = stubFence();
    const { peer, connector } = fixture({
      answers: {
        'fs.edit': {
          value: {
            status: 'success',
            operation: 'edit',
            path: 'machine://devl/srv/app/a.ts',
            diff: '@@',
            content: 'new',
            truncated: false,
          },
        },
      },
    });
    const result = await runTool(
      nativeEditTool,
      {
        path: 'machine://devl/srv/app/a.ts',
        oldText: 'old',
        newText: 'new',
      },
      context(connector),
      5,
    );
    expect(result).toMatchObject({
      status: 'success',
      path: 'machine://devl/srv/app/a.ts',
    });
    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({
        fence: { bound: false },
        operation: 'edit',
        path: 'machine://devl/srv/app/a.ts',
      }),
    );
    expect(append).toHaveBeenCalledWith(
      'run',
      'native.result',
      expect.objectContaining({ toolCallId: 'call', result }),
    );
    const session = await peer.session(0);
    expect(session.calls.at(-1)?.params).toMatchObject({
      path: '/srv/app/a.ts',
      oldText: 'old',
      newText: 'new',
      options: { displayPrefix: 'machine://devl' },
    });
  });

  it('creates through fs.write and keeps created', async () => {
    stubFence();
    const { peer, connector } = fixture({
      answers: {
        'fs.write': {
          value: {
            status: 'success',
            operation: 'write',
            path: 'machine://devl/srv/app/new.txt',
            created: true,
            diff: '@@',
            content: 'x',
            truncated: false,
          },
        },
      },
    });
    await expect(
      runTool(
        nativeWriteTool,
        { path: 'machine://devl/srv/app/new.txt', content: 'x' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({ status: 'success', created: true });
    const session = await peer.session(0);
    expect(session.calls.at(-1)?.params).toMatchObject({
      path: '/srv/app/new.txt',
      content: 'x',
    });
  });

  it('refuses a selector before any effect', async () => {
    const { begin } = stubFence();
    const { peer, connector } = fixture();
    await expect(
      runTool(
        nativeEditTool,
        { path: 'machine://devl/srv/app/a.ts:1-2', oldText: 'a', newText: 'b' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'invalid_selector' });
    expect(begin).not.toHaveBeenCalled();
    expect(peer.sessions).toHaveLength(0);
  });

  it('records no attempt when the Machine is unreachable before dispatch', async () => {
    const { begin } = stubFence();
    const { connector } = fixture({
      openFailure: () => 'ssh: connect to host box port 22: Connection refused',
    });
    await expect(
      runTool(
        nativeEditTool,
        { path: 'machine://devl/srv/app/a.ts', oldText: 'a', newText: 'b' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'machine_unavailable',
    });
    expect(begin).not.toHaveBeenCalled();
  });

  it('settles a session lost after dispatch as outcome_unknown', async () => {
    const { append } = stubFence();
    const { peer, connector } = fixture({
      answers: { 'fs.edit': { hold: true } },
    });
    const call = runTool(
      nativeEditTool,
      { path: 'machine://devl/srv/app/a.ts', oldText: 'a', newText: 'b' },
      context(connector),
      5,
    );
    const session = await peer.session(0);
    await session.awaitRequests(1);
    session.drop({ code: 255, diagnostic: 'Connection reset by peer' });
    await expect(call).resolves.toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });
    expect(append).toHaveBeenCalledWith(
      'run',
      'native.result',
      expect.objectContaining({ toolCallId: 'call' }),
    );
    expect(append.mock.calls[0]?.[2]).toMatchObject({
      result: { type: 'outcome_unknown' },
    });
    expect(session.requests).toEqual(['fs.edit']);
  });

  it('reports a Machine refusal as a settled result', async () => {
    stubFence();
    const { connector } = fixture({
      answers: { 'fs.edit': { error: 'path_not_registered' } },
    });
    await expect(
      runTool(
        nativeEditTool,
        { path: 'machine://devl/srv/app/a.ts', oldText: 'a', newText: 'b' },
        context(connector),
        5,
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'path_not_registered',
      message: PATH_NOT_REGISTERED_MESSAGE,
    });
  });

  it('reports an exhausted budget as a timed-out attempt', async () => {
    stubFence();
    const { connector } = fixture({
      answers: { 'fs.edit': { error: 'budget_exhausted' } },
    });
    await expect(
      runTool(
        nativeEditTool,
        { path: 'machine://devl/srv/app/a.ts', oldText: 'a', newText: 'b' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'timed_out' });
  });

  it('replays a recorded attempt instead of repeating the effect', async () => {
    const prior = {
      status: 'error' as const,
      type: 'outcome_unknown',
      message: 'prior',
    };
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(prior);
    const append = vi.spyOn(RunEventsRepository.prototype, 'append');
    const { connector } = fixture();
    await expect(
      runTool(
        nativeEditTool,
        { path: 'machine://devl/srv/app/a.ts', oldText: 'a', newText: 'b' },
        context(connector),
        5,
      ),
    ).resolves.toEqual(prior);
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses an unconfigured Machine without opening a link', async () => {
    const { begin } = stubFence();
    const { peer, connector } = fixture();
    await expect(
      runTool(
        nativeEditTool,
        { path: 'machine://nope/srv/a.ts', oldText: 'a', newText: 'b' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'machine_not_found' });
    expect(begin).not.toHaveBeenCalled();
    expect(peer.sessions).toHaveLength(0);
  });
});

describe('Machine bash', () => {
  afterEach(() => vi.restoreAllMocks());

  const BASH_OK = {
    status: 'success',
    operation: 'bash',
    executor: 'managed',
    exitCode: 0,
    stdout: '/srv/app\n',
    stderr: '',
    truncated: false,
  };

  it('runs in the given Machine directory without a local executor', async () => {
    stubFence();
    const { peer, connector } = fixture({
      answers: { 'proc.bash': { value: BASH_OK } },
    });
    await expect(
      runTool(
        bashTool,
        { command: 'pwd', cwd: 'machine://devl/srv/app' },
        context(connector, { nativeExecutorId: undefined }),
        5,
      ),
    ).resolves.toMatchObject({ status: 'success', stdout: '/srv/app\n' });
    const session = await peer.session(0);
    expect(session.calls.at(-1)?.params).toMatchObject({
      command: 'pwd',
      cwd: '/srv/app',
      envelope: { budgetMs: 5000 },
    });
  });

  it('resolves a relative cwd inside a Machine Workspace on the Machine', async () => {
    stubFence();
    const { peer, connector } = fixture({
      answers: { 'proc.bash': { value: BASH_OK } },
    });
    await runTool(
      bashTool,
      { command: 'ls', cwd: 'packages/ui' },
      context(connector, {
        workspaceRoot: createWorkspaceRootCell('machine://devl/home/me/shop'),
      }),
      5,
    );
    const session = await peer.session(0);
    expect(session.calls.at(-1)?.params).toMatchObject({
      cwd: '/home/me/shop/packages/ui',
    });
  });

  it('uses the Machine Workspace root for an omitted cwd', async () => {
    stubFence();
    const { peer, connector } = fixture({
      answers: { 'proc.bash': { value: BASH_OK } },
    });
    await runTool(
      bashTool,
      { command: 'pwd' },
      context(connector, {
        workspaceRoot: createWorkspaceRootCell('machine://devl/home/me/shop'),
      }),
      5,
    );
    const session = await peer.session(0);
    expect(session.calls.at(-1)?.params).toMatchObject({
      cwd: '/home/me/shop',
    });
  });

  it('maps a bare absolute cwd in a Machine Workspace', async () => {
    stubFence();
    const { peer, connector } = fixture({
      answers: { 'proc.bash': { value: BASH_OK } },
    });
    await runTool(
      bashTool,
      { command: 'pwd', cwd: '/home/me/shop/src' },
      context(connector, {
        workspaceRoot: createWorkspaceRootCell('machine://devl/home/me/shop'),
      }),
      5,
    );
    const session = await peer.session(0);
    expect(session.calls.at(-1)?.params).toMatchObject({
      cwd: '/home/me/shop/src',
    });
  });

  it('still refuses a local cwd without a native executor', async () => {
    const { peer, connector } = fixture();
    await expect(
      runTool(
        bashTool,
        { command: 'pwd', cwd: '/tmp' },
        context(connector, { nativeExecutorId: undefined }),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'executor_unavailable' });
    expect(peer.sessions).toHaveLength(0);
  });

  it('settles a lost command session as outcome_unknown', async () => {
    stubFence();
    const { peer, connector } = fixture({
      answers: { 'proc.bash': { hold: true } },
    });
    const call = runTool(
      bashTool,
      { command: 'sleep 30', cwd: 'machine://devl/srv/app' },
      context(connector),
      5,
    );
    const session = await peer.session(0);
    await session.awaitRequests(1);
    session.drop({ code: 255, diagnostic: 'Connection reset by peer' });
    await expect(call).resolves.toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });
  });

  it('refuses a listing form as a cwd before any effect', async () => {
    const { peer, connector } = fixture();
    await expect(
      runTool(
        bashTool,
        { command: 'pwd', cwd: 'machine://devl' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'invalid_path' });
    expect(peer.sessions).toHaveLength(0);
  });

  it('reports a Machine refusal as a settled bash result', async () => {
    stubFence();
    const { connector } = fixture({
      answers: { 'proc.bash': { error: 'path_not_registered' } },
    });
    await expect(
      runTool(
        bashTool,
        { command: 'pwd', cwd: 'machine://devl/srv/app' },
        context(connector),
        5,
      ),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'path_not_registered',
    });
  });
});

describe('Machine permission matching', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses an encoded spelling that a reject names in decoded text', async () => {
    const { peer, connector } = fixture();
    const policy = compileToolPermissionMap(
      {
        read: {
          allow: true,
          reject: [
            { field: 'path', regex: '^machine://devl/home/me/\\.ssh(?:/|$)' },
          ],
        },
      },
      'machine-reject',
    );
    await expect(
      runTool(
        nativeReadTool,
        { path: 'machine://devl/home/me/%2Essh/id_ed25519' },
        context(connector, { permissionPolicy: policy }),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'permission_denied' });
    expect(peer.sessions).toHaveLength(0);
  });

  it('does not admit a mapped bare path through a local allow', async () => {
    const { peer, connector } = fixture();
    const policy = compileToolPermissionMap(
      { read: { allow: [{ field: 'path', regex: '^/home/me/' }] } },
      'local-allow',
    );
    await expect(
      runTool(
        nativeReadTool,
        { path: '/home/me/notes.md' },
        context(connector, {
          permissionPolicy: policy,
          workspaceRoot: createWorkspaceRootCell('machine://devl/home/me/shop'),
        }),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'permission_denied' });
    expect(peer.sessions).toHaveLength(0);
  });

  it('refuses a Machine another Machine rule does not admit', async () => {
    const { peer, connector } = fixture();
    const policy = compileToolPermissionMap(
      {
        read: { allow: [{ field: 'path', regex: '^machine://devl/home/me/' }] },
      },
      'machine-scoped',
    );
    await expect(
      runTool(
        nativeReadTool,
        { path: 'machine://gpu/home/me/notes.md' },
        context(connector, { permissionPolicy: policy }),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'permission_denied' });
    expect(peer.sessions).toHaveLength(0);
  });

  it('matches a read without its selector', async () => {
    const { connector } = fixture({
      answers: { 'fs.read': { value: READ_FILE } },
    });
    const policy = compileToolPermissionMap(
      {
        read: {
          allow: [
            { field: 'path', regex: '^machine://devl/srv/app/README\\.md$' },
          ],
        },
      },
      'selector-free',
    );
    await expect(
      runTool(
        nativeReadTool,
        { path: 'machine://devl/srv/app/README.md:1-5' },
        context(connector, { permissionPolicy: policy }),
        5,
      ),
    ).resolves.toMatchObject({ status: 'success' });
  });

  it('matches a Machine bash cwd as its canonical locator', async () => {
    stubFence();
    const { connector } = fixture({
      answers: {
        'proc.bash': {
          value: {
            status: 'success',
            operation: 'bash',
            executor: 'managed',
            exitCode: 0,
            stdout: '',
            stderr: '',
            truncated: false,
          },
        },
      },
    });
    const policy = compileToolPermissionMap(
      {
        bash: { allow: [{ field: 'cwd', literal: 'machine://devl/srv/app' }] },
      },
      'machine-bash',
    );
    await expect(
      runTool(
        bashTool,
        { command: 'pwd', cwd: 'MACHINE://DEVL/srv/app' },
        context(connector, { permissionPolicy: policy }),
        5,
      ),
    ).resolves.toMatchObject({ status: 'success' });
    await expect(
      runTool(
        bashTool,
        { command: 'pwd', cwd: 'machine://devl/srv/other' },
        context(connector, { permissionPolicy: policy }),
        5,
      ),
    ).resolves.toMatchObject({ status: 'error', type: 'permission_denied' });
  });
});
