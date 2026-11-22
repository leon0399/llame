/**
 * A real `llame-machine` child for the host file and grep integration suites
 * (host-as-machine design D12): the bundle spawned through the local child
 * transport, with a temporary configuration directory whose roots this helper
 * registers with the daemon's own `roots add`. The connector is the ordinary
 * hub connector, so a test sees exactly the session, identity bind, `fs.*`
 * wire, and failure vocabulary a running process sees.
 *
 * Deliberately under `src/testing/`: scaffolding, excluded from coverage and
 * mutation, never imported by production code.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';

import { type Db } from '../db/tenant-db.service';
import { createLocalChildTransportFactory } from '../machines/local-child-transport';
import { MachineConnector } from '../machines/machine-connector.service';
import { formatMachineLocator } from '../machines/machine-locator';
import { processEnvironment } from '../tools/env';
import { type ToolContext } from '../tools/types';
import { DEFAULT_LOCAL_MACHINE_NAME } from './local-machine';
import { compileTestPermissionPolicy } from './tool-permission-policy';

/** The daemon bundle the suites start; built by `pnpm --filter machine build`. */
export const MACHINE_BUNDLE = resolve(
  __dirname,
  '../../..',
  'machine/dist/llame-machine.cjs',
);

/**
 * The built daemon bundle, checked before a suite spawns it: a raw spawn error
 * names neither the missing file nor the command that writes it.
 */
export function assertBuiltBundle(bundle: string): void {
  if (existsSync(bundle)) return;

  throw new Error(
    `The Machine file and grep integration suites need the built daemon at ${bundle}: run \`pnpm --filter machine build\`.`,
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

export function startLocalDaemon(options: LocalDaemonOptions): LocalDaemon {
  assertBuiltBundle(MACHINE_BUNDLE);
  const name = DEFAULT_LOCAL_MACHINE_NAME;
  const configDir = mkdtempSync(join(tmpdir(), 'llame-machine-test-'));

  for (const root of options.roots) {
    execFileSync(
      process.execPath,
      [MACHINE_BUNDLE, 'roots', 'add', realpathSync(root)],
      {
        env: {
          ...processEnvironment(),
          LLAME_MACHINE_CONFIG_DIR: configDir,
        },
        stdio: 'pipe',
      },
    );
  }

  const connector = new MachineConnector({
    machines: { local: name, default: name, hosts: { [name]: {} } },
    hubVersion: '0.0.0-local-daemon-test',
    bindIdentity: () => Promise.resolve('match'),
    localTransportFactory: createLocalChildTransportFactory({
      command: options.command ?? `${process.execPath} ${MACHINE_BUNDLE}`,
      env: {
        ...processEnvironment(),
        LLAME_MACHINE_CONFIG_DIR: configDir,
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
      rmSync(configDir, { recursive: true, force: true });
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
