/**
 * A real `llame-machine` child for the host file and grep integration suites:
 * the static binary runs through the local child transport with a temporary
 * configuration directory whose roots this helper registers via `roots add`.
 * The ordinary hub connector gives each test the same session, identity bind,
 * `fs.*` wire, and failure vocabulary as a running process.
 *
 * Deliberately under `src/testing/`: scaffolding, excluded from coverage and
 * mutation, never imported by production code.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';

import { type Db } from '../db/tenant-db.service';
import { createLocalChildTransportFactory } from '../machines/local-child-transport';
import { MachineConnector } from '../machines/machine-connector.service';
import { formatMachineLocator } from '../machines/machine-locator';
import { processEnvironment } from '../tools/env';
import { type ToolContext } from '../tools/types';
import { DEFAULT_LOCAL_MACHINE_NAME } from './local-machine';
import { compileTestPermissionPolicy } from './tool-permission-policy';
import { daemonBinary } from '@workspace/machine-protocol';

/** The daemon binary the suites start; built by `pnpm --filter machine build`. */
export const MACHINE_BINARY = daemonBinary();

/** Check that the Rust daemon binary exists before a suite spawns it. */
export function assertBuiltBinary(binary: string): void {
  if (existsSync(binary)) return;

  throw new Error(
    `The Machine integration suites need the daemon binary at ${binary}: run \`pnpm --filter machine build\`.`,
  );
}

export type LocalDaemonOptions = {
  /** The roots the daemon serves; each is registered before the first spawn. */
  readonly roots: ReadonlyArray<string>;
  /** The program a daemon session starts, for an unreachable-Machine case. */
  readonly command?: string;
};

export type LocalDaemon = {
  readonly connector: MachineConnector;
  readonly name: string;
  /** The canonical Machine locator of one absolute path on this daemon. */
  locator(path: string): string;
  /** Close every session and delete the temporary configuration directory. */
  dispose(): void;
};

/** The canonical locator of one path on the daemon named `name`. */
function daemonLocator(name: string, path: string): string {
  const locator = formatMachineLocator(name, path);

  if (locator === undefined)
    throw new Error(`the daemon cannot address ${path}`);

  return locator;
}

function registerRoots(
  roots: ReadonlyArray<string>,
  configDir: string,
  stateDir: string,
): void {
  for (const root of roots) {
    execFileSync(MACHINE_BINARY, ['roots', 'add', realpathSync(root)], {
      env: {
        LLAME_MACHINE_CONFIG_DIR: configDir,
        LLAME_MACHINE_STATE_DIR: stateDir,
      },
      stdio: 'pipe',
    });
  }
}
/** Stop the daemon started for one fixture and wait for its lock to release. */

export function stopLocalDaemon(stateDir: string): void {
  const lockPath = join(stateDir, 'daemon.lock');

  if (!existsSync(lockPath)) return;

  const pid = Number(readFileSync(lockPath, 'utf8').trim());

  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('The local Machine daemon lock does not contain a pid.');

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
      return;

    throw error;
  }

  const pause = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  );

  const waitForExit = (deadline: number): boolean => {
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
          return true;

        throw error;
      }

      Atomics.wait(pause, 0, 0, 20);
    }

    return false;
  };

  if (waitForExit(Date.now() + 2000)) return;

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
      return;

    throw error;
  }

  if (!waitForExit(Date.now() + 2000))
    throw new Error(`Local Machine daemon ${pid} did not exit after SIGKILL.`);
}

export function startLocalDaemon(options: LocalDaemonOptions): LocalDaemon {
  assertBuiltBinary(MACHINE_BINARY);
  const name = DEFAULT_LOCAL_MACHINE_NAME;
  const configDir = mkdtempSync(join(tmpdir(), 'llame-machine-test-'));
  const stateDir = mkdtempSync(join(tmpdir(), 'llame-machine-state-test-'));

  registerRoots(options.roots, configDir, stateDir);

  const connector = new MachineConnector({
    machines: { local: name, default: name, hosts: { [name]: {} } },
    hubVersion: '0.0.0-local-daemon-test',
    bindIdentity: () => Promise.resolve('match'),
    localTransportFactory: createLocalChildTransportFactory({
      command: options.command ?? MACHINE_BINARY,
      env: {
        ...processEnvironment(),
        LLAME_MACHINE_CONFIG_DIR: configDir,
        LLAME_MACHINE_STATE_DIR: stateDir,
      },
    }),
    handshakeTimeoutMs: 30_000,
  });

  return {
    connector,
    name,
    locator: (path) => daemonLocator(name, path),
    dispose() {
      connector.onModuleDestroy();

      try {
        stopLocalDaemon(stateDir);
      } finally {
        rmSync(configDir, { recursive: true, force: true });
        rmSync(stateDir, { recursive: true, force: true });
      }
    },
  };
}

/** Start the real daemon over `roots`, and dispose it after the body. */
export async function withLocalDaemon<T>(
  roots: ReadonlyArray<string>,
  body: (daemon: LocalDaemon) => Promise<T>,
): Promise<T> {
  const daemon = startLocalDaemon({ roots });

  try {
    return await body(daemon);
  } finally {
    daemon.dispose();
  }
}

/**
 * The context a native `read` needs to address the running daemon, so a suite
 * exercises the machine read a Chat issues instead of a local shortcut.
 */
export function daemonReadContext(
  daemon: LocalDaemon,
  extra: Partial<ToolContext> = {},
): ToolContext {
  const db: Db = drizzle.mock();

  return {
    configuredCredentials: [],
    userId: 'owner',
    chatId: 'chat',
    tenantDb: {
      runAs: <T>(_userId: string, operation: (tx: Db) => Promise<T>) =>
        operation(db),
    },
    localMachine: daemon.name,
    defaultMachine: daemon.name,
    machines: daemon.connector,
    permissionPolicy: compileTestPermissionPolicy(['read']),
    ...extra,
  };
}
