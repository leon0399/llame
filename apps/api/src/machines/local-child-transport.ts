/**
 * The local Machine's link: a `llame-machine serve --stdio` child of this
 * process (host-as-machine design D4). The host serves its own Machine through
 * the same wire, session, identity bind, and failure vocabulary every other
 * Machine uses; only the bytes underneath differ, and only this file knows
 * that they are a pipe to a child rather than SSH.
 *
 * The child starts from a fixed base environment, never the worker's: a
 * Workspace's `{env:…}` tokens may resolve hub secrets, and a daemon that
 * inherited them would hand them to every process it starts. The allowlist is
 * identity (`PATH`, `HOME`, `TMPDIR`, `USER`, `LOGNAME`), the daemon's own
 * configuration directory, and its Sentry identity; nothing else crosses.
 */

import { spawn } from 'node:child_process';

import type { SshProcess } from '../ssh/ssh-process';
import { processEnvironment } from '../tools/env';

import {
  createProcessTransport,
  type MachineTransportFactory,
} from './machine-transport';
import { MachineUnavailableError } from './machine-session';

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
] as const;

/** The daemon's own Sentry identity, for its own errors only. */
const SENTRY_ENVIRONMENT_NAMES = [
  'SENTRY_DSN',
  'SENTRY_ENVIRONMENT',
  'SENTRY_RELEASE',
] as const;

/** The command a local daemon runs when the operator names none. */
export const DEFAULT_LOCAL_MACHINE_COMMAND = 'llame-machine';

/**
 * The fixed locale pair every managed child gets
 * (`packages/bash-executor/src/env.ts`): a daemon started under an operator's
 * interactive locale would otherwise pass it on to every tool it runs.
 */
const FIXED_LOCALE = {
  LANG: 'C.UTF-8',
  TERM: 'dumb',
} as const;

/** A child spawn, with the environment the link has to pass explicitly. */
export type LocalChildSpawn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly env: NodeJS.ProcessEnv },
) => SshProcess;

export type LocalChildTransportFactoryOptions = {
  /** The program and its arguments, defaulting to `LLAME_MACHINE_COMMAND`. */
  readonly command?: string;
  /** The environment the allowlist is copied FROM (defaults to the worker's). */
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam: where the child process comes from. */
  readonly spawn?: LocalChildSpawn;
};

/** The production spawn: one child with piped stdio, no shell. */
const spawnLocalChild: LocalChildSpawn = (command, args, options) => {
  const child = spawn(command, args, {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: options.env,
  });

  return {
    stdout: child.stdout,
    stdin: child.stdin,
    stderr: child.stderr,
    kill: () => {
      child.kill();
    },
    onError: (handler) => child.on('error', handler),
    onClose: (handler) => child.on('close', handler),
  };
};

/**
 * The argv prefix for the daemon: a command may be a program with arguments
 * (`node ../machine/dist/llame-machine.cjs`), so it splits on whitespace. An
 * empty word list means the operator's setting names no program at all.
 */
export function localMachineCommand(
  command: string = processEnvironment()['LLAME_MACHINE_COMMAND'] ??
    DEFAULT_LOCAL_MACHINE_COMMAND,
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
 * The local transport factory: one child process per session, spawned without
 * a shell so the operator's command is argv, never a string a Workspace could
 * extend. A spawn failure (`ENOENT`/`EACCES`, or an `error` event) ends the
 * transport before the handshake, which the session reports as `unreachable`;
 * a child that exits afterwards is a lost session.
 */
export function createLocalChildTransportFactory(
  options: LocalChildTransportFactoryOptions = {},
): MachineTransportFactory {
  const spawnLink = options.spawn ?? spawnLocalChild;
  const workerEnvironment = options.env ?? processEnvironment();

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

      return createProcessTransport(
        spawnLink(program, [...words.slice(1), 'serve', '--stdio'], {
          env: localChildEnvironment(workerEnvironment),
        }),
      );
    },
  };
}
