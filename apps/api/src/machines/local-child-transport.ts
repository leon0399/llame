/**
 * The local Machine's link: the daemon's Unix socket (host-as-machine design
 * D4). The host serves its own Machine through the same wire, session,
 * identity bind, and failure vocabulary every other Machine uses.
 *
 * The daemon starts from a fixed base environment, never the worker's: a
 * Workspace's `{env:…}` tokens may resolve hub secrets, and a daemon that
 * inherited them would hand them to every process it starts. The allowlist is
 * identity (`PATH`, `HOME`, `TMPDIR`, `USER`, `LOGNAME`), the daemon's own
 * configuration directory, and its Sentry identity; nothing else crosses.
 */

import { connectSocket, daemonBinary } from '@workspace/machine-protocol';
import { execFileSync } from 'node:child_process';
import { connect as connectNetSocket, type Socket } from 'node:net';

import { processEnvironment } from '../tools/env';

import {
  machineSocketPath,
  type MachineLinkEnd,
  type MachineTransportFactory,
} from './machine-transport';
import {
  MachineIdentityMismatchError,
  MachineUnavailableError,
} from './machine-session-errors';

/**
 * The child env's identity and OS variables, copied only when the worker has
 * them: an unset variable stays unset rather than becoming an empty string.
 */
const COPIED_ENVIRONMENT_NAMES = [
  'PATH',
  'HOME',
  'TMPDIR',
  'USER',
  'LOGNAME',
] as const;

/**
 * Where the daemon keeps its own state. `LLAME_MACHINE_CONFIG_DIR` is the
 * daemon's documented override; `XDG_CONFIG_HOME` is its documented default.
 */
const MACHINE_CONFIGURATION_NAMES = [
  'LLAME_MACHINE_CONFIG_DIR',
  'XDG_CONFIG_HOME',
  'LLAME_MACHINE_STATE_DIR',
  'XDG_STATE_HOME',
] as const;

/** The daemon's own Sentry identity, for its own errors only. */
const SENTRY_ENVIRONMENT_NAMES = [
  'SENTRY_DSN',
  'SENTRY_ENVIRONMENT',
  'SENTRY_RELEASE',
] as const;

/**
 * The fixed locale pair every managed child gets
 * (`packages/bash-executor/src/env.ts`): a daemon started under an operator's
 * interactive locale would otherwise pass it on to every tool it runs.
 */
const FIXED_LOCALE = {
  LANG: 'C.UTF-8',
  TERM: 'dumb',
} as const;

export type LocalMachineCommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly env: NodeJS.ProcessEnv },
) => string;

export type LocalMachineSocketConnector = (path: string) => Socket;

export type LocalChildTransportFactoryOptions = {
  /** The program and its arguments, defaulting to `LLAME_MACHINE_COMMAND`. */
  readonly command?: string;
  /** The environment the allowlist is copied FROM (defaults to the worker's). */
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam for obtaining the daemon's socket path. */
  readonly runCommand?: LocalMachineCommandRunner;
  /** Test seam for opening the returned daemon socket. */
  readonly connect?: LocalMachineSocketConnector;
};

/**
 * The daemon argv from the operator override, or the binary built for this
 * installation when no override is set.
 */
export function localMachineCommand(
  command: string = processEnvironment()['LLAME_MACHINE_COMMAND'] ??
    daemonBinary(),
): ReadonlyArray<string> {
  return command
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
}

/** The exact environment a local daemon starts with. */
export function localChildEnvironment(
  worker: NodeJS.ProcessEnv = processEnvironment(),
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const name of [
    ...COPIED_ENVIRONMENT_NAMES,
    ...MACHINE_CONFIGURATION_NAMES,
    ...SENTRY_ENVIRONMENT_NAMES,
  ]) {
    const value = worker[name];

    if (value !== undefined) environment[name] = value;
  }

  return { ...environment, ...FIXED_LOCALE };
}

/**
 * Ensures the daemon is running and connects to its Unix socket. A real
 * `net.Socket` avoids Node's http2-over-JS-Duplex assertion on long-lived local
 * Machine connections.
 */
export function createLocalChildTransportFactory(
  options: LocalChildTransportFactoryOptions = {},
): MachineTransportFactory {
  const workerEnvironment = options.env ?? processEnvironment();
  const runCommand =
    options.runCommand ??
    ((command, args, { env }) =>
      execFileSync(command, [...args], { env, encoding: 'utf8' }));
  const connect = options.connect ?? connectNetSocket;

  return {
    open: (request) => {
      const words = localMachineCommand(options.command);
      const program = words[0];

      if (program === undefined)
        throw new MachineUnavailableError(
          request.name,
          'unreachable',
          false,
          'LLAME_MACHINE_COMMAND names no program to run.',
        );

      let socketOutput: string;

      try {
        socketOutput = runCommand(
          program,
          [...words.slice(1), 'attach', '--print-socket'],
          { env: localChildEnvironment(workerEnvironment) },
        );
      } catch (cause) {
        if (
          typeof cause === 'object' &&
          cause !== null &&
          'status' in cause &&
          cause.status === 78
        )
          throw new MachineIdentityMismatchError(request.name);

        throw new MachineUnavailableError(
          request.name,
          'unreachable',
          false,
          cause instanceof Error ? cause.message : String(cause),
        );
      }
      const socketPath = machineSocketPath(socketOutput);

      if (socketPath === undefined)
        throw new MachineUnavailableError(
          request.name,
          'unreachable',
          false,
          'The Machine daemon did not return a valid socket path.',
        );

      const socket = connect(socketPath);
      let closedByHub = false;
      const { promise: ended, resolve } =
        Promise.withResolvers<MachineLinkEnd>();
      socket.once('close', () =>
        resolve({
          code: null,
          signal: null,
          diagnostic: '',
          closedByHub,
        }),
      );
      socket.once('error', (error) =>
        resolve({
          code: null,
          signal: null,
          diagnostic: error.message,
          closedByHub,
        }),
      );

      return {
        rpcTransport: connectSocket(socket),
        close: () => {
          closedByHub = true;
          socket.destroy();
        },
        ended,
      };
    },
  };
}
