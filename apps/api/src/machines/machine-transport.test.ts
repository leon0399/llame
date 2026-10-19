import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';

import {
  classifyLinkFailure,
  createMachineSshTransportFactory,
  createProcessTransport,
  LINK_DIAGNOSTIC_BYTES,
  type MachineLinkProcess,
} from './machine-transport';

type FakeLink = {
  readonly process: MachineLinkProcess;
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

describe('classifyLinkFailure', () => {
  it('reads ssh own refusal messages before the handshake', () => {
    expect(classifyLinkFailure(false, 'Host key verification failed.')).toBe(
      'host_key_mismatch',
    );
    expect(
      classifyLinkFailure(false, 'me@box: Permission denied (publickey).'),
    ).toBe('auth_failed');
    expect(
      classifyLinkFailure(
        false,
        'ssh: connect to host box port 22: Connection timed out',
      ),
    ).toBe('unreachable');
    expect(classifyLinkFailure(false, 'llame-machine: command not found')).toBe(
      'unreachable',
    );
    expect(classifyLinkFailure(false, '')).toBe('unreachable');
  });

  it('reads an end after the handshake as a lost session', () => {
    expect(classifyLinkFailure(true, 'Host key verification failed.')).toBe(
      'session_lost',
    );
    expect(
      classifyLinkFailure(
        true,
        'kex_exchange_identification: read: Connection reset by peer',
      ),
    ).toBe('session_lost');
  });
});

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
      link.pairs.stderr.write('x'.repeat(LINK_DIAGNOSTIC_BYTES));
    link.close(1, null);
    const end = await transport.ended;
    expect(end.diagnostic.length).toBe(LINK_DIAGNOSTIC_BYTES);
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
    expect(transport.input).toBe(link.pairs.stdout);
    expect(transport.output).toBe(link.pairs.stdin);
  });
});

describe('createMachineSshTransportFactory', () => {
  const ssh = {
    knownHostsFile: '/etc/llame/machine_known_hosts',
    identityFile: '/etc/llame/machine_ed25519',
  };

  function factory() {
    const links: Array<FakeLink> = [];
    const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
    const created = createMachineSshTransportFactory({
      ssh,
      spawn: (command, args) => {
        calls.push({ command, args });
        const link = fakeLink();
        links.push(link);
        return link.process;
      },
    });
    return { created, links, calls };
  }

  it('runs ssh through the generated configuration with -T and the forced command', () => {
    const { created, calls } = factory();
    try {
      created.open({ name: 'devl', destination: 'box' });
      created.open({ name: 'gpu', destination: 'me@gpu.lan:2222' });
      expect(calls).toHaveLength(2);
      expect(of(calls[0])).toEqual({
        command: 'ssh',
        args: [
          '-F',
          expect.any(String),
          '-T',
          '--',
          'box',
          'llame-machine',
          'serve',
          '--stdio',
        ],
      });
      // One generated configuration per process, reused by every Machine.
      expect(of(calls[1]).args[1]).toBe(of(calls[0]).args[1]);
      // A configured port reaches ssh in the URI form it parses.
      expect(of(calls[1]).args[4]).toBe('ssh://me@gpu.lan:2222');
    } finally {
      created.dispose();
    }
  });

  it('writes the safety block plus the include it was configured with, 0600', () => {
    const { created, calls } = factory();
    try {
      created.open({ name: 'devl', destination: 'box' });
      const path = of(calls[0]).args[1];
      const text = readFileSync(path, 'utf8');
      expect(statSync(path).mode & 0o777).toBe(0o600);
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
    const { created, calls } = factory();
    expect(created.sshConfigText()).toBeUndefined();
    created.open({ name: 'devl', destination: 'box' });
    const path = of(calls[0]).args[1];
    created.dispose();
    expect(created.sshConfigText()).toBeUndefined();
    expect(() => statSync(path)).toThrow(/ENOENT/u);
  });
});

describe('createMachineSshTransportFactory through the real spawn seam', () => {
  // Without a `spawn` seam the factory builds a real child process, found
  // through PATH. These tests point PATH at a private directory holding a
  // stand-in `ssh` script, so the spawn options, the stdio pipes, and the
  // close/error wiring are exercised without a network or a real ssh.
  const ssh = {
    knownHostsFile: '/etc/llame/machine_known_hosts',
    identityFile: '/etc/llame/machine_ed25519',
  };
  let bin: string;
  let previousPath: string | undefined;

  beforeEach(() => {
    bin = mkdtempSync(join(tmpdir(), 'llame-fake-ssh-'));
    previousPath = process.env['PATH'];
  });

  afterEach(() => {
    restorePath(previousPath);
    rmSync(bin, { recursive: true, force: true });
  });

  /** Put the stand-in `ssh` in PATH and close PATH to anything else. */
  function useSsh(script: string): void {
    const path = join(bin, 'ssh');
    writeFileSync(path, script, 'utf8');
    chmodSync(path, 0o755);
    process.env['PATH'] = bin;
  }

  it('runs the generated configuration through a real ssh process', async () => {
    useSsh(
      [
        '#!/bin/sh',
        'read -r greeting',
        String.raw`printf "daemon says %s\n" "$greeting"`,
        String.raw`printf "args:%s\n" "$*" >&2`,
        'exit 3',
        '',
      ].join('\n'),
    );
    const created = createMachineSshTransportFactory({ ssh });
    try {
      const link = created.open({ name: 'devl', destination: 'box' });
      const answer = firstChunk(link.input);
      link.output.write('ping\n');
      await expect(answer).resolves.toBe('daemon says ping\n');
      const end = await link.ended;
      expect(end.closedByHub).toBe(false);
      expect(end.code).toBe(3);
      expect(end.signal).toBeNull();
      expect(end.diagnostic).toMatch(
        /^args:-F .+ssh_config -T -- box llame-machine serve --stdio\n$/u,
      );
    } finally {
      created.dispose();
    }
  });

  it('ends with the spawn failure when no ssh exists to run', async () => {
    process.env['PATH'] = bin;
    const created = createMachineSshTransportFactory({ ssh });
    try {
      const link = created.open({ name: 'devl', destination: 'box' });
      const end = await link.ended;
      expect(end).toMatchObject({
        code: null,
        signal: null,
        closedByHub: false,
      });
      expect(end.diagnostic).toMatch(/^spawn ssh ENOENT$/u);
    } finally {
      created.dispose();
    }
  });

  it(
    'kills the link process when the hub closes the link',
    // Roomy, so a loaded test host cannot fail the kill itself: the mutant
    // that never kills is the one that has to burn this budget.
    { timeout: 60_000 },
    async () => {
      // The stand-in ssh waits on its own stdin, so it is still running when
      // the hub closes the link, and it needs no command outside the shell.
      useSsh(
        ['#!/bin/sh', 'echo up', 'read -r forever', 'exit 7', ''].join('\n'),
      );
      const created = createMachineSshTransportFactory({ ssh });
      try {
        const link = created.open({ name: 'devl', destination: 'box' });
        await expect(firstChunk(link.input)).resolves.toBe('up\n');
        link.close();
        link.close();
        const end = await link.ended;
        expect(end.closedByHub).toBe(true);
        expect(end.code).toBeNull();
        expect(end.signal).toBe('SIGTERM');
      } finally {
        created.dispose();
      }
    },
  );
});

/** Restore PATH exactly, including "there was none". */
function restorePath(previous: string | undefined): void {
  if (previous === undefined) delete process.env['PATH'];
  else process.env['PATH'] = previous;
}

/** The first chunk a link writes back, so a test can read one answer. */
function firstChunk(stream: Readable): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  stream.setEncoding('utf8');
  stream.once('data', (chunk: string) => {
    resolve(chunk);
  });
  stream.once('error', reject);
  return promise;
}

/** Index with a clear failure instead of a non-null assertion. */
function of<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('the fixture was not spawned');
  return value;
}
