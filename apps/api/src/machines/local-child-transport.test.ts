import { PassThrough } from 'node:stream';

import type { SshProcess } from '../ssh/ssh-process';

import {
  createLocalChildTransportFactory,
  localChildEnvironment,
} from './local-child-transport';
import { MachineUnavailableError } from './machine-session';

type FakeChild = {
  readonly process: SshProcess;
  readonly pairs: {
    readonly stdout: PassThrough;
    readonly stdin: PassThrough;
    readonly stderr: PassThrough;
  };
  close(code: number | null, signal: string | null): void;
  fail(error: Error): void;
  readonly killCount: () => number;
};

function fakeChild(): FakeChild {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const stderr = new PassThrough();

  let onClose:
    | ((code: number | null, signal: string | null) => void)
    | undefined;

  let onError: ((error: Error) => void) | undefined;
  let kills = 0;

  return {
    pairs: { stdout, stdin, stderr },
    process: {
      stdout,
      stdin,
      stderr,
      kill: () => {
        kills += 1;
      },
      onError: (handler) => {
        onError = handler;
      },
      onClose: (handler) => {
        onClose = handler;
      },
    },
    close: (code, signal) => onClose?.(code, signal),
    fail: (error) => onError?.(error),
    killCount: () => kills,
  };
}

/** A factory whose spawn records its argv and environment. */
function fixture() {
  const children: Array<FakeChild> = [];

  const calls: Array<{
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly env: NodeJS.ProcessEnv;
  }> = [];

  const created = createLocalChildTransportFactory({
    command: 'node /repo/apps/machine/dist/llame-machine.cjs',
    env: {},
    spawn: (command, args, options) => {
      calls.push({ command, args, env: options.env });
      const child = fakeChild();
      children.push(child);

      return child.process;
    },
  });

  return { created, calls, children };
}

/** Index with a clear failure instead of a non-null assertion. */
function of<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('the fixture was not spawned');

  return value;
}

describe('createLocalChildTransportFactory', () => {
  it('runs a two-word command as argv with the stdio serve command', () => {
    const { created, calls } = fixture();

    created.open({ name: 'host-a' });
    expect(calls).toEqual([
      {
        command: 'node',
        args: ['/repo/apps/machine/dist/llame-machine.cjs', 'serve', '--stdio'],
        env: { LANG: 'C.UTF-8', TERM: 'dumb' },
      },
    ]);
  });

  it('starts the child with exactly the allowlisted environment', () => {
    const calls: Array<{ readonly env: NodeJS.ProcessEnv }> = [];

    const created = createLocalChildTransportFactory({
      command: 'llame-machine',
      env: {
        PATH: '/usr/bin:/bin',
        HOME: '/home/operator',
        TMPDIR: '/tmp',
        USER: 'operator',
        LOGNAME: 'operator',
        LANG: 'fr_FR.UTF-8',
        LLAME_MACHINE_CONFIG_DIR: '/srv/llame/machine',
        XDG_CONFIG_HOME: '/home/operator/.config',
        SENTRY_DSN: 'https://dsn.example/1',
        SENTRY_ENVIRONMENT: 'production',
        POSTGRES_URL: 'postgres://secret@db/llame',
        SENTRY_AUTH_TOKEN: 'release-token',
      },
      spawn: (_command, _args, options) => {
        calls.push({ env: options.env });

        return fakeChild().process;
      },
    });

    created.open({ name: 'host-a' });

    expect(of(calls[0]).env).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/home/operator',
      TMPDIR: '/tmp',
      USER: 'operator',
      LOGNAME: 'operator',
      LLAME_MACHINE_CONFIG_DIR: '/srv/llame/machine',
      XDG_CONFIG_HOME: '/home/operator/.config',
      SENTRY_DSN: 'https://dsn.example/1',
      SENTRY_ENVIRONMENT: 'production',
      LANG: 'C.UTF-8',
      TERM: 'dumb',
    });
    expect(of(calls[0]).env).not.toHaveProperty('POSTGRES_URL');
    expect(of(calls[0]).env).not.toHaveProperty('SENTRY_AUTH_TOKEN');
  });

  it('keeps an unset identity variable unset rather than empty', () => {
    expect(localChildEnvironment({ PATH: '/usr/bin' })).toEqual({
      PATH: '/usr/bin',
      LANG: 'C.UTF-8',
      TERM: 'dumb',
    });
  });

  it('ends the link when the child never starts', async () => {
    const { created, children } = fixture();
    const transport = created.open({ name: 'host-a' });
    of(children[0]).fail(new Error('spawn llame-machine ENOENT'));

    await expect(transport.ended).resolves.toEqual({
      code: null,
      signal: null,
      diagnostic: 'spawn llame-machine ENOENT',
      closedByHub: false,
    });
  });

  it('reports a child exit as an end the hub did not cause', async () => {
    const { created, children } = fixture();
    const transport = created.open({ name: 'host-a' });
    of(children[0]).close(1, null);

    await expect(transport.ended).resolves.toMatchObject({
      code: 1,
      closedByHub: false,
    });
  });

  it('closes the child once when the hub ends the link', () => {
    const { created, children } = fixture();
    const transport = created.open({ name: 'host-a' });
    transport.close();
    transport.close();
    expect(of(children[0]).killCount()).toBe(1);
  });

  it('refuses a command that names no program', () => {
    const created = createLocalChildTransportFactory({
      command: '  ',
      spawn: () => fakeChild().process,
    });

    expect(() => created.open({ name: 'host-a' })).toThrow(
      MachineUnavailableError,
    );
    expect(() => created.open({ name: 'host-a' })).toThrow(
      'LLAME_MACHINE_COMMAND names no program to run.',
    );
  });
});
