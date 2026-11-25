import { Socket } from 'node:net';

import {
  createLocalChildTransportFactory,
  localChildEnvironment,
} from './local-child-transport';
import {
  MachineIdentityMismatchError,
  MachineUnavailableError,
} from './machine-session-errors';

function fixture(commandOutput = '/tmp/llame-machine/daemon.sock\n') {
  const calls: Array<{
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly env: NodeJS.ProcessEnv;
  }> = [];
  const connected: Array<{ readonly path: string; readonly socket: Socket }> =
    [];

  const created = createLocalChildTransportFactory({
    command: '/repo/apps/machine/dist/x86_64-unknown-linux-musl/llame-machine',
    env: {},
    runCommand: (command, args, options) => {
      calls.push({ command, args, env: options.env });

      return commandOutput;
    },
    connect: (path) => {
      const socket = new Socket();
      connected.push({ path, socket });

      return socket;
    },
  });

  return { created, calls, connected };
}

/** Index with a clear failure instead of a non-null assertion. */
function of<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('the fixture did not connect');

  return value;
}

describe('createLocalChildTransportFactory', () => {
  it('prints the daemon socket path with the attach command', () => {
    const { created, calls, connected } = fixture();

    created.open({ name: 'host-a' });

    expect(calls).toEqual([
      {
        command:
          '/repo/apps/machine/dist/x86_64-unknown-linux-musl/llame-machine',
        args: ['attach', '--print-socket'],
        env: { LANG: 'C.UTF-8', TERM: 'dumb' },
      },
    ]);
    expect(connected.map(({ path }) => path)).toEqual([
      '/tmp/llame-machine/daemon.sock',
    ]);
  });

  it('starts the daemon with exactly the allowlisted environment', () => {
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
      runCommand: (_command, _args, options) => {
        calls.push({ env: options.env });

        return '/tmp/llame-machine/daemon.sock';
      },
      connect: () => new Socket(),
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

  it('reports an unrequested socket close as a transport end', async () => {
    const { created, connected } = fixture();
    const transport = created.open({ name: 'host-a' });
    of(connected[0]).socket.destroy();

    await expect(transport.ended).resolves.toMatchObject({
      code: null,
      closedByHub: false,
    });
  });

  it('closes the socket when the hub ends the link', async () => {
    const { created, connected } = fixture();
    const transport = created.open({ name: 'host-a' });
    transport.close();

    await expect(transport.ended).resolves.toMatchObject({
      closedByHub: true,
    });
  });

  it('refuses a command that names no program', () => {
    const created = createLocalChildTransportFactory({
      command: '  ',
      runCommand: () => '/tmp/llame-machine/daemon.sock',
      connect: () => new Socket(),
    });

    expect(() => created.open({ name: 'host-a' })).toThrow(
      MachineUnavailableError,
    );
    expect(() => created.open({ name: 'host-a' })).toThrow(
      'LLAME_MACHINE_COMMAND names no program to run.',
    );
  });

  it('refuses an empty socket path before connecting', () => {
    const { created, connected } = fixture(' \n');

    expect(() => created.open({ name: 'host-a' })).toThrow(
      'The Machine daemon did not return a valid socket path.',
    );
    expect(connected).toHaveLength(0);
  });
  it('maps attach exit status 78 to identity mismatch', () => {
    const created = createLocalChildTransportFactory({
      command: 'llame-machine',
      runCommand: () => {
        throw Object.assign(new Error('identity mismatch'), { status: 78 });
      },
      connect: () => new Socket(),
    });

    expect(() => created.open({ name: 'host-a' })).toThrow(
      MachineIdentityMismatchError,
    );
  });

  it('maps other attach failures to unreachable', () => {
    const created = createLocalChildTransportFactory({
      command: 'llame-machine',
      runCommand: () => {
        throw Object.assign(new Error('daemon unavailable'), { status: 1 });
      },
      connect: () => new Socket(),
    });

    expect(() => created.open({ name: 'host-a' })).toThrow(
      MachineUnavailableError,
    );
  });
});
