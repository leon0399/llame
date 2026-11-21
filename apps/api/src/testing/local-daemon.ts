/**
 * A real `llame-machine` child for the grep integration suite (host-as-machine
 * design D12): the bundle spawned through the local child transport, with a
 * temporary configuration directory whose roots this helper registers with the
 * daemon's own `roots add`. The connector is the ordinary hub connector, so a
 * test sees exactly the session, identity bind, `fs.grep` wire, and failure
 * vocabulary a running process sees.
 *
 * Deliberately under `src/testing/`: scaffolding, excluded from coverage and
 * mutation, never imported by production code.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createLocalChildTransportFactory } from '../machines/local-child-transport';
import { MachineConnector } from '../machines/machine-connector.service';
import { processEnvironment } from '../tools/env';

/** The daemon bundle the suite starts; built by `pnpm --filter machine build`. */
const BUNDLE = resolve(__dirname, '../../..', 'machine/dist/llame-machine.cjs');

/** The Machine name a started daemon answers to by default. */
export const LOCAL_DAEMON_NAME = 'host-a';

export type LocalDaemonOptions = {
  /** The roots the daemon serves; each is registered before the first spawn. */
  readonly roots: ReadonlyArray<string>;
  readonly name?: string;
  /** The program a daemon session starts, for an unreachable-Machine case. */
  readonly command?: string;
  /** Binds the Machine name to the daemon's instance id; `match` by default. */
  readonly bindIdentity?: (
    name: string,
    instanceId: string,
  ) => Promise<'match'>;
};

export type LocalDaemon = {
  readonly connector: MachineConnector;
  readonly name: string;
  /** Close every session and delete the temporary configuration directory. */
  dispose(): void;
};

export function startLocalDaemon(options: LocalDaemonOptions): LocalDaemon {
  const name = options.name ?? LOCAL_DAEMON_NAME;
  const configDir = mkdtempSync(join(tmpdir(), 'llame-machine-test-'));

  for (const root of options.roots) {
    execFileSync(
      process.execPath,
      [BUNDLE, 'roots', 'add', realpathSync(root)],
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
    hubVersion: '0.0.0-grep-integration',
    bindIdentity: options.bindIdentity ?? (() => Promise.resolve('match')),
    localTransportFactory: createLocalChildTransportFactory({
      command: options.command ?? `${process.execPath} ${BUNDLE}`,
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
    dispose() {
      connector.onModuleDestroy();
      rmSync(configDir, { recursive: true, force: true });
    },
  };
}
