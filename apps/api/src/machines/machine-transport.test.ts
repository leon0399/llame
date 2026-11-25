import { readFileSync, statSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { Socket } from 'node:net';

import { SSH_DIAGNOSTIC_BYTES, type SshProcess } from '../ssh/ssh-process';
import {
  createMachineSshTransportFactory,
  createProcessTransport,
} from './machine-transport';
import { MachineUnavailableError } from './machine-session-errors';

type FakeLink = {
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

function fakeLink(): FakeLink {
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

describe('createProcessTransport', () => {
  it('resolves the end with the exit status and the collected stderr', async () => {
    const link = fakeLink();
    const transport = createProcessTransport(link.process);
    link.pairs.stderr.write('Host key verification failed.\n');
    link.pairs.stderr.write('more');
    link.close(255, null);
    await expect(transport.ended).resolves.toEqual({
      code: 255,
      signal: null,
      diagnostic: 'Host key verification failed.\nmore',
      closedByHub: false,
    });
  });

  it('marks an end llame caused and kills the link once', async () => {
    const link = fakeLink();
    const transport = createProcessTransport(link.process);
    transport.close();
    transport.close();
    expect(link.killCount()).toBe(1);
    link.close(0, null);
    await expect(transport.ended).resolves.toMatchObject({ closedByHub: true });
  });

  it('ends on a link that never started', async () => {
    const link = fakeLink();
    const transport = createProcessTransport(link.process);
    link.fail(new Error('spawn ssh ENOENT'));
    await expect(transport.ended).resolves.toEqual({
      code: null,
      signal: null,
      diagnostic: 'spawn ssh ENOENT',
      closedByHub: false,
    });
  });

  it('keeps stderr bounded', async () => {
    const link = fakeLink();
    const transport = createProcessTransport(link.process);

    for (let index = 0; index < 3; index += 1)
      link.pairs.stderr.write('x'.repeat(SSH_DIAGNOSTIC_BYTES));
    link.close(1, null);
    const end = await transport.ended;
    expect(end.diagnostic.length).toBe(SSH_DIAGNOSTIC_BYTES);
  });

  it('swallows a stderr read error so a broken pipe cannot kill the hub', async () => {
    const link = fakeLink();
    const transport = createProcessTransport(link.process);
    expect(() =>
      link.pairs.stderr.emit('error', new Error('EIO: read')),
    ).not.toThrow();
    link.close(1, null);
    await expect(transport.ended).resolves.toMatchObject({ code: 1 });
  });

  it('exposes the link stdio as the transport streams', () => {
    const link = fakeLink();
    const transport = createProcessTransport(link.process);
    expect('input' in transport ? transport.input : undefined).toBe(
      link.pairs.stdout,
    );
    expect('output' in transport ? transport.output : undefined).toBe(
      link.pairs.stdin,
    );
  });
});

describe('createMachineSshTransportFactory', () => {
  const ssh = {
    knownHostsFile: '/etc/llame/machine_known_hosts',
    identityFile: '/etc/llame/machine_ed25519',
  };

  function factory() {
    const links: Array<FakeLink> = [];
    const commandCalls: Array<{
      readonly command: string;
      readonly args: ReadonlyArray<string>;
    }> = [];
    const spawnCalls: Array<{
      readonly command: string;
      readonly args: ReadonlyArray<string>;
    }> = [];
    const connected: Array<{ readonly path: string; readonly socket: Socket }> =
      [];

    const created = createMachineSshTransportFactory({
      ssh,
      runCommand: (command, args) => {
        commandCalls.push({ command, args });

        return '/run/llame-machine.sock\n';
      },
      connect: (path) => {
        const socket = new Socket();
        connected.push({ path, socket });

        return socket;
      },
      spawn: (command, args) => {
        spawnCalls.push({ command, args });
        const link = fakeLink();
        links.push(link);

        return link.process;
      },
    });

    return { created, links, commandCalls, spawnCalls, connected };
  }

  it('runs attach and opens an SSH socket tunnel', () => {
    const { created, commandCalls, spawnCalls, connected } = factory();

    try {
      created.open({ name: 'devl', destination: 'box' });
      created.open({ name: 'gpu', destination: 'me@gpu.lan:2222' });

      expect(commandCalls).toHaveLength(2);
      expect(of(commandCalls[0])).toEqual({
        command: 'ssh',
        args: [
          '-F',
          expect.any(String),
          '-T',
          '--',
          'box',
          'llame-machine',
          'attach',
          '--print-socket',
        ],
      });
      expect(of(commandCalls[1]).args[1]).toBe(of(commandCalls[0]).args[1]);
      expect(of(commandCalls[1]).args[4]).toBe('ssh://me@gpu.lan:2222');

      expect(spawnCalls).toHaveLength(2);
      expect(of(spawnCalls[0])).toEqual({
        command: 'ssh',
        args: [
          '-F',
          of(commandCalls[0]).args[1],
          '-N',
          '-o',
          'StreamLocalBindUnlink=yes',
          '-L',
          expect.stringMatching(
            /^\/tmp\/llame-machine-ssh-[^/]+\/machine\.sock:\/run\/llame-machine\.sock$/u,
          ),
          '--',
          'box',
        ],
      });
      expect(of(spawnCalls[1]).args.at(-1)).toBe('ssh://me@gpu.lan:2222');
      expect(connected.map(({ path }) => path)).toEqual(
        spawnCalls.map(({ args }) => args[6]?.split(':')[0]),
      );
    } finally {
      created.dispose();
    }
  });

  it('refuses a request with no destination without opening SSH', () => {
    const { created, commandCalls, spawnCalls } = factory();

    try {
      expect(() => created.open({ name: 'devl' })).toThrow(
        MachineUnavailableError,
      );
      expect(() => created.open({ name: 'devl' })).toThrow(
        'This Machine has no SSH destination.',
      );
      expect(commandCalls).toHaveLength(0);
      expect(spawnCalls).toHaveLength(0);
    } finally {
      created.dispose();
    }
  });

  it('writes the safety block plus the include it was configured with, 0600', () => {
    const { created, commandCalls } = factory();

    try {
      created.open({ name: 'devl', destination: 'box' });
      const path = of(commandCalls[0]).args[1];
      const text = readFileSync(path!, 'utf8');
      expect(statSync(path!).mode & 0o777).toBe(0o600);
      expect(created.sshConfigText()).toBe(text);
      expect(text).toContain('Host *');
      expect(text).toContain('StrictHostKeyChecking yes');
      expect(text).toContain(
        'UserKnownHostsFile "/etc/llame/machine_known_hosts"',
      );
      expect(text).toContain('IdentityFile "/etc/llame/machine_ed25519"');
      expect(text.trimEnd().endsWith('Include')).toBe(false);
      expect(text).toContain('Include "');
    } finally {
      created.dispose();
    }
  });

  it('reports no configuration before the first open and removes it on dispose', () => {
    const { created, commandCalls } = factory();
    expect(created.sshConfigText()).toBeUndefined();
    created.open({ name: 'devl', destination: 'box' });
    const path = of(commandCalls[0]).args[1]!;
    created.dispose();
    expect(created.sshConfigText()).toBeUndefined();
    expect(() => statSync(path)).toThrow(/ENOENT/u);
  });

  it('closes the socket and tunnel when the hub ends the link', async () => {
    const { created, links, connected } = factory();

    try {
      const transport = created.open({ name: 'devl', destination: 'box' });
      transport.close();
      of(links[0]).close(null, 'SIGTERM');
      const end = await transport.ended;
      expect(end.closedByHub).toBe(true);
      expect(of(links[0]).killCount()).toBe(1);
      expect(of(connected[0]).socket.destroyed).toBe(true);
    } finally {
      created.dispose();
    }
  });
});

function of<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('the fixture did not create a value');

  return value;
}
