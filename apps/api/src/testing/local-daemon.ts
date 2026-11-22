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
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createLocalChildTransportFactory } from '../machines/local-child-transport';
import { MachineConnector } from '../machines/machine-connector.service';
import { processEnvironment } from '../tools/env';
import { DEFAULT_LOCAL_MACHINE_NAME } from './local-machine';

/** The daemon bundle the suites start; built by `pnpm --filter machine build`. */
export const MACHINE_BUNDLE = resolve(
  __dirname,
  '../../..',
  'machine/dist/llame-machine.cjs',
);

export type LocalDaemonOptions = {
  /** The roots the daemon serves; each is registered before the first spawn. */
  readonly roots: ReadonlyArray<string>;
  /** The program a daemon session starts, for an unreachable-Machine case. */
  readonly command?: string;
};

export type LocalDaemon = {
  readonly connector: MachineConnector;
  readonly name: string;
  /** Close every session and delete the temporary configuration directory. */
  dispose(): void;
};

export function startLocalDaemon(options: LocalDaemonOptions): LocalDaemon {
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
    dispose() {
      connector.onModuleDestroy();
      rmSync(configDir, { recursive: true, force: true });
    },
  };
}
