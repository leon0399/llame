/**
 * The local Machine link end to end (host-as-machine design D4/D12): the real
 * `llame-machine` bundle spawned as a child through
 * `createLocalChildTransportFactory`, with a temporary configuration directory
 * whose root the bundle's own `roots add` registered. The same session, hello,
 * version check, and file reads the SSH suite exercises, minus the network.
 *
 * The child's environment is the contract under test: the worker's own
 * variables (a secret in this suite) must not reach it, while its
 * configuration directory must.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  PROTOCOL_VERSION,
  type JsonValue,
  type MachineMethod,
  type MachineMethodParams,
} from '@workspace/machine-protocol';
import { isRecord, isString } from '@workspace/runtime-safety';

import { createLocalChildTransportFactory } from './local-child-transport';
import { readFsReadResult } from './machine-results';
import { MachineSession } from './machine-session';

/** The daemon bundle the suite starts; built by `pnpm --filter machine build`. */
const BUNDLE = resolve(__dirname, '../../..', 'machine/dist/llame-machine.cjs');

const HUB_VERSION = '0.0.0-local-child-test';
const NAME = 'host-a';
const NOTES = 'hello from the host\n';
const ENVELOPE = { budgetMs: 60_000 };

describe('the local Machine link (host-as-machine)', () => {
  let configDir: string;
  let root: string;

  beforeAll(() => {
    configDir = mkdtempSync(join(tmpdir(), 'llame-local-machine-config-'));
    root = realpathSync(
      mkdtempSync(join(tmpdir(), 'llame-local-machine-root-')),
    );
    writeFileSync(join(root, 'notes.txt'), NOTES);
    // Register the root with the daemon's own command, exactly as the dev
    // helper and an operator do.
    execFileSync(process.execPath, [BUNDLE, 'roots', 'add', root], {
      env: { ...process.env, LLAME_MACHINE_CONFIG_DIR: configDir },
      stdio: 'pipe',
    });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(configDir, { recursive: true, force: true });
  });

  /** One local session whose worker environment carries `overrides`. */
  function connect(overrides: NodeJS.ProcessEnv = {}): MachineSession {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      LLAME_MACHINE_CONFIG_DIR: configDir,
      ...overrides,
    };

    const factory = createLocalChildTransportFactory({
      command: `${process.execPath} ${BUNDLE}`,
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
        throw new Error('fs.read did not answer a file');
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
});
