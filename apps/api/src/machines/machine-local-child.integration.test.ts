/**
 * The local Machine link end to end (host-as-machine design D4/D12): the real
 * `llame-machine` binary spawned as a child through
 * `createLocalChildTransportFactory`, with a temporary configuration directory
 * whose root the binary's own `roots add` registered. The same session,
 * version check, and file reads the SSH suite exercises, minus the network.
 *
 * The child's environment is the contract under test: the worker's own
 * variables (a secret in this suite) must not reach it, while its
 * configuration directory must.
 */

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROTOCOL_VERSION,
  type JsonValue,
  type MachineMethod,
  type MachineMethodParams,
} from '@workspace/machine-protocol';
import { isRecord, isString } from '@workspace/runtime-safety';

import { MACHINE_BINARY } from '../testing/local-daemon';
import { createLocalChildTransportFactory } from './local-child-transport';
import { readFsReadResult } from './machine-results';
import { MachineSession } from './machine-session';

const HUB_VERSION = '0.0.0-local-child-test';

const MCP_FIXTURE = join(
  __dirname,
  '../../../../apps/machine/src/testing/mcp-stdio-server-fixture.mjs',
);

const NAME = 'host-a';
const NOTES = 'hello from the host\n';
const ENVELOPE = { budgetMs: 60_000 };

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }

    const turn = Promise.withResolvers<void>();
    setImmediate(turn.resolve);
    await turn.promise;
  }

  throw new Error(
    `MCP fixture process ${pid} did not exit after its channel closed.`,
  );
}

describe('the local Machine link (host-as-machine)', () => {
  let configDir: string;
  let stateDir: string;
  let root: string;
  let serverPidFile: string;
  beforeAll(() => {
    configDir = mkdtempSync(join(tmpdir(), 'llame-local-machine-config-'));
    stateDir = mkdtempSync(join(tmpdir(), 'llame-local-machine-state-'));
    root = realpathSync(
      mkdtempSync(join(tmpdir(), 'llame-local-machine-root-')),
    );
    writeFileSync(join(root, 'notes.txt'), NOTES);
    serverPidFile = join(root, 'mcp-server.pid');

    const fixtureConfig = JSON.stringify({
      pidFile: serverPidFile,
      tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
    });

    writeFileSync(
      join(root, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          fixture: {
            command: process.execPath,
            args: [MCP_FIXTURE],
            env: { MACHINE_MCP_FIXTURE: fixtureConfig },
          },
        },
      }),
    );
    // Register the root with the daemon's own command, exactly as the dev
    // helper and an operator do.
    execFileSync(MACHINE_BINARY, ['roots', 'add', root], {
      env: {
        ...process.env,
        LLAME_MACHINE_CONFIG_DIR: configDir,
        LLAME_MACHINE_STATE_DIR: stateDir,
      },
      stdio: 'pipe',
    });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  /** One local session whose environment can be overridden per test. */
  function connect(_overrides: NodeJS.ProcessEnv = {}): MachineSession {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LLAME_MACHINE_CONFIG_DIR: configDir,
      LLAME_MACHINE_STATE_DIR: stateDir,
    };

    const factory = createLocalChildTransportFactory({
      command: MACHINE_BINARY,
      env,
    });

    const session = new MachineSession({
      name: NAME,
      transport: factory.open({ name: NAME }),
      hubVersion: HUB_VERSION,
      handshakeTimeoutMs: 30_000,
    });

    return session;
  }

  async function request<M extends MachineMethod>(
    session: MachineSession,
    method: M,
    params: MachineMethodParams[M],
  ): Promise<JsonValue> {
    return session.request({ method, params });
  }

  it('handshakes with an instance id, the protocol version, and the registered root', async () => {
    const session = connect();

    try {
      const hello = await session.ready();
      expect(hello.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(hello.instanceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
      expect(hello.roots).toEqual([root]);
      expect(hello.facts.rootDisks.map((disk) => disk.root)).toEqual([root]);
    } finally {
      session.close();
    }
  });

  it('reads a file through the same fs.read method a remote Machine answers', async () => {
    const session = connect();

    try {
      await session.ready();

      const answer = await request(session, 'fs.read', {
        path: join(root, 'notes.txt'),
        options: { displayPrefix: `machine://${NAME}` },
        envelope: ENVELOPE,
      });

      const read = readFsReadResult(answer);

      if (
        read === undefined ||
        read.status !== 'success' ||
        !('kind' in read)
      ) {
        throw new Error(
          `fs.read did not answer a file: ${JSON.stringify(answer)}`,
        );
      }

      expect(read.kind).toBe('file');
      // The read renders numbered lines, so the text is a substring.
      expect(read.kind === 'file' ? read.content : '').toContain(NOTES.trim());
    } finally {
      session.close();
    }
  });

  it('starts the child without the worker’s secrets', async () => {
    const session = connect({
      POSTGRES_URL: 'postgres://secret@db/llame',
      SENTRY_AUTH_TOKEN: 'release-token',
    });

    try {
      await session.ready();

      // `proc.bash` runs under the managed base environment of the DAEMON:
      // anything it prints came through the daemon's own process environment
      // (or the managed allowlist on top of it), so a leaked worker variable
      // would show up here.
      const answer = await request(session, 'proc.bash', {
        command: 'env',
        cwd: root,
        envelope: ENVELOPE,
      });

      if (!isRecord(answer)) {
        throw new Error('proc.bash answered with a non-object');
      }

      expect(answer['status']).toBe('success');
      const text = isString(answer['stdout']) ? answer['stdout'] : '';
      expect(text).toContain('PATH=');
      expect(text).not.toContain('POSTGRES_URL');
      expect(text).not.toContain('postgres://secret@db/llame');
      expect(text).not.toContain('SENTRY_AUTH_TOKEN');
      expect(text).not.toContain('release-token');
    } finally {
      session.close();
    }
  });

  it('streams media bytes and a failure through the real daemon', async () => {
    const session = connect();

    const media = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6fsAAAAASUVORK5CYII=',
      'base64',
    );

    const path = join(root, 'image.png');
    writeFileSync(path, media);

    try {
      await session.ready();
      const chunks: Array<Buffer> = [];

      const bytes = session.openChannel({
        method: 'fs.bytes',
        params: { path, envelope: ENVELOPE },
      });

      bytes.channel.onNotification((notification) => {
        if (notification.method !== 'bytes' || !isRecord(notification.params))
          return;

        if (isString(notification.params['data']))
          chunks.push(Buffer.from(notification.params['data'], 'base64'));
      });

      await expect(bytes.result).resolves.toEqual({
        size: media.byteLength,
        mediaType: 'image/png',
      });
      expect(Buffer.concat(chunks)).toEqual(media);
      bytes.channel.close();

      const refused = session.openChannel({
        method: 'fs.bytes',
        params: { path: join(root, 'notes.txt'), envelope: ENVELOPE },
      });

      await expect(refused.result).resolves.toMatchObject({
        status: 'error',
        type: 'unsupported_media_type',
      });
    } finally {
      session.close();
    }
  });

  it('lists and opens MCP bidirectionally, then stops the server when closed', async () => {
    const session = connect();

    try {
      await session.ready();
      await expect(
        request(session, 'mcp.servers', { root, envelope: ENVELOPE }),
      ).resolves.toMatchObject({
        servers: [{ name: 'fixture', state: 'available' }],
      });

      const handle = session.openChannel({
        method: 'mcp.open',
        params: { root, server: 'fixture', envelope: ENVELOPE },
      });

      await expect(handle.result).resolves.toEqual({ protectedValues: [] });
      const response = Promise.withResolvers<JsonValue>();
      handle.channel.onNotification((notification) => {
        if (
          notification.method !== 'mcp.message' ||
          !isRecord(notification.params)
        )
          return;
        const message = notification.params['message'];

        if (isRecord(message) && message['id'] === 1) response.resolve(message);
      });
      handle.channel.notify('mcp.message', {
        message: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'api-test', version: '1' },
          },
        },
      });
      await expect(response.promise).resolves.toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { serverInfo: { name: 'machine-stdio-fixture' } },
      });

      const pid = Number(readFileSync(serverPidFile, 'utf8'));
      handle.channel.close();
      await waitForProcessExit(pid);
    } finally {
      session.close();
    }
  });
});
