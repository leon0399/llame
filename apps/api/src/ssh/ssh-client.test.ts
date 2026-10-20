import { setImmediate as tick } from 'node:timers/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import {
  createSshClient,
  SSH_RESOLUTION_OUTPUT_BYTES,
  type SshClient,
} from './ssh-client';
import { defaultSshConfigFile } from './ssh-config';
import { type SshSpawn } from './ssh-process';

type FakeSsh = {
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly stdin: PassThrough;
  readonly kill: () => void;
  onError(handler: (error: Error) => void): void;
  onClose(handler: (code: number | null, signal: string | null) => void): void;
  error(error: Error): void;
  close(code: number | null, signal?: string | null): void;
  stdinText(): string;
};

type Harness = {
  readonly spawn: SshSpawn;
  readonly calls: Array<{
    readonly command: string;
    readonly args: ReadonlyArray<string>;
  }>;
  readonly processes: Array<FakeSsh>;
};

function fakeSpawn(): Harness {
  const calls: Harness['calls'] = [];
  const processes: Harness['processes'] = [];
  return {
    calls,
    processes,
    spawn: (command, args) => {
      calls.push({ command, args });
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      let input = '';
      stdin.on('data', (chunk: Buffer | string) => {
        input += String(chunk);
      });
      const errorHandlers: Array<(error: Error) => void> = [];
      const closeHandlers: Array<
        (code: number | null, signal: string | null) => void
      > = [];
      const process: FakeSsh = {
        stdout,
        stderr,
        stdin,
        kill: vi.fn(),
        onError: (handler) => errorHandlers.push(handler),
        onClose: (handler) => closeHandlers.push(handler),
        error: (error) => errorHandlers.forEach((handler) => handler(error)),
        close: (code, signal = null) =>
          closeHandlers.forEach((handler) => handler(code, signal)),
        stdinText: () => input,
      };
      processes.push(process);
      return process;
    },
  };
}

const SSH = { knownHostsFile: '/etc/llame/known_hosts' };

function fakeClient() {
  const harness = fakeSpawn();
  const configFile = {
    path: '/run/llame/ssh_config',
    text: 'Host *\n  BatchMode yes\n',
    dispose: vi.fn(),
  };
  const client = createSshClient({
    ssh: SSH,
    spawn: harness.spawn,
    configFile,
    resolutionDeadlineMs: 5000,
  });
  return { client, harness };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSshClient.resolve', () => {
  it('parses an ssh -G answer into user, host, and port', async () => {
    const { client, harness } = fakeClient();
    const pending = client.resolve({
      host: 'edge-1.lan',
      user: 'deploy',
      port: 2222,
    });
    const process = harness.processes[0];
    if (process === undefined) throw new Error('expected a spawned ssh');
    process.stdout.write(
      'user deploy\nhostname Edge-1.LAN\nport 2222\nproxycommand none\n',
    );
    process.close(0);

    await expect(pending).resolves.toEqual({
      outcome: 'resolved',
      destination: { user: 'deploy', host: 'edge-1.lan', port: 2222 },
    });
    expect(harness.calls[0]).toEqual({
      command: 'ssh',
      args: [
        '-F',
        '/run/llame/ssh_config',
        '-G',
        '-l',
        'deploy',
        '-p',
        '2222',
        '--',
        'edge-1.lan',
      ],
    });
  });

  it('parses an IPv6 hostname and omits -l/-p when the locator wrote none', async () => {
    const { client, harness } = fakeClient();
    const pending = client.resolve({ host: '2001:db8::1' });
    const process = harness.processes[0];
    if (process === undefined) throw new Error('expected a spawned ssh');
    process.stdout.write('user root\nhostname 2001:db8::1\nport 22\n');
    process.close(0);

    await expect(pending).resolves.toEqual({
      outcome: 'resolved',
      destination: { user: 'root', host: '2001:db8::1', port: 22 },
    });
    expect(harness.calls[0]?.args).toContain('--');
    expect(harness.calls[0]?.args).not.toContain('-l');
  });

  it('fails as config when ssh -G exits non-zero', async () => {
    const { client, harness } = fakeClient();
    const pending = client.resolve({ host: 'box' });
    const process = harness.processes[0];
    if (process === undefined) throw new Error('expected a spawned ssh');
    process.stderr.write('command-line: line 0: Bad configuration option\n');
    process.close(255);

    const resolution = await pending;
    expect(resolution).toMatchObject({ outcome: 'failed', reason: 'config' });
    if (resolution.outcome !== 'failed')
      throw new Error('expected a failed resolution');
    expect(resolution.diagnostic).toContain('Bad configuration option');
  });

  it('fails as config when ssh -G output is over its bound', async () => {
    const { client, harness } = fakeClient();
    const pending = client.resolve({ host: 'box' });
    const process = harness.processes[0];
    if (process === undefined) throw new Error('expected a spawned ssh');
    process.stdout.write('x'.repeat(SSH_RESOLUTION_OUTPUT_BYTES + 1));
    process.close(0);

    const resolution = await pending;
    expect(resolution).toMatchObject({ outcome: 'failed', reason: 'config' });
    expect(process.kill).toHaveBeenCalled();
  });

  it('fails as client_missing when ssh cannot be spawned', async () => {
    const { client, harness } = fakeClient();
    const pending = client.resolve({ host: 'box' });
    const process = harness.processes[0];
    if (process === undefined) throw new Error('expected a spawned ssh');
    process.error(
      Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' }),
    );

    await expect(pending).resolves.toMatchObject({
      outcome: 'failed',
      reason: 'client_missing',
    });
  });

  it('stops on abort without a connection', async () => {
    const { client, harness } = fakeClient();
    const controller = new AbortController();
    const pending = client.resolve({ host: 'box', signal: controller.signal });
    controller.abort();

    await expect(pending).resolves.toEqual({ outcome: 'cancelled' });
    expect(harness.processes[0]?.kill).toHaveBeenCalled();
  });
});

describe('createSshClient.run', () => {
  it('writes byte-exact bounded stdout, bounded stderr, and stdin', async () => {
    const { client, harness } = fakeClient();
    const pending = client.run({
      destination: 'box',
      user: 'deploy',
      port: 2222,
      remoteCommand: ['sh', '-s'],
      input: 'echo hi\n',
      maxStdoutBytes: 4,
      deadlineMs: 5000,
    });
    const process = harness.processes[0];
    if (process === undefined) throw new Error('expected a spawned ssh');
    process.stdout.write(Buffer.from([0x00, 0xff, 0x41]));
    process.stdout.write(Buffer.from('bcdef'));
    process.stderr.write('w'.repeat(4096));
    process.stderr.write('x'.repeat(4096));
    process.stderr.write('y'.repeat(4096));
    process.close(0);

    const outcome = await pending;
    await tick();
    expect(process.stdinText()).toBe('echo hi\n');
    expect(outcome).toMatchObject({
      outcome: 'ended',
      stdoutOverflow: true,
      code: 0,
    });
    if (outcome.outcome !== 'ended') throw new Error('expected an end');
    expect(outcome.stdout).toEqual(Buffer.from([0x00, 0xff, 0x41, 0x62]));
    expect(outcome.diagnostic).toBe('w'.repeat(4096) + 'x'.repeat(4096));
    expect(harness.calls[0]).toEqual({
      command: 'ssh',
      args: [
        '-F',
        '/run/llame/ssh_config',
        '-T',
        '-l',
        'deploy',
        '-p',
        '2222',
        '--',
        'box',
        'sh',
        '-s',
      ],
    });
  });

  it('binds a resolved destination with -o and keeps the submitted host', async () => {
    const { client, harness } = fakeClient();
    const pending = client.run({
      destination: 'prod',
      resolved: { user: 'deploy', host: '10.0.0.5', port: 2222 },
      remoteCommand: ['sh', '-s'],
      maxStdoutBytes: 1024,
      deadlineMs: 5000,
    });
    const process = harness.processes[0];
    if (process === undefined) throw new Error('expected a spawned ssh');
    process.close(0);
    await pending;

    expect(harness.calls[0]?.args).toEqual([
      '-F',
      '/run/llame/ssh_config',
      '-T',
      '-o',
      'HostName=10.0.0.5',
      '-o',
      'Port=2222',
      '-o',
      'User=deploy',
      '--',
      'prod',
      'sh',
      '-s',
    ]);
  });

  it('fails as timed_out at its deadline and kills ssh', async () => {
    const { client, harness } = fakeClient();
    const outcome = await client.run({
      destination: 'box',
      remoteCommand: ['sh', '-s'],
      maxStdoutBytes: 1024,
      deadlineMs: 20,
    });

    expect(outcome).toMatchObject({ outcome: 'failed', reason: 'timed_out' });
    expect(harness.processes[0]?.kill).toHaveBeenCalled();
  });

  it('fails as cancelled when the call aborts', async () => {
    const { client, harness } = fakeClient();
    const controller = new AbortController();
    const pending = client.run({
      destination: 'box',
      remoteCommand: ['sh', '-s'],
      maxStdoutBytes: 1024,
      deadlineMs: 5000,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      outcome: 'failed',
      reason: 'cancelled',
    });
    expect(harness.processes[0]?.kill).toHaveBeenCalled();
  });
});

describe('createSshClient generated configuration', () => {
  it('writes the configuration lazily once and shares it with resolution and execution', async () => {
    const harness = fakeSpawn();
    const client = createSshClient({ ssh: SSH, spawn: harness.spawn });
    try {
      expect(client.sshConfigText()).toBeUndefined();
      const pending = client.resolve({ host: 'box' });
      const process = harness.processes[0];
      if (process === undefined) throw new Error('expected a spawned ssh');
      process.stdout.write('user root\nhostname box\nport 22\n');
      process.close(0);
      await pending;

      expect(client.sshConfigText()).toContain('Host *');
      expect(client.sshConfigText()).toContain(
        `Include "${defaultSshConfigFile()}"`,
      );
      const resolvingPath = harness.calls[0]?.args[1];
      const running = client.run({
        destination: 'box',
        remoteCommand: ['sh', '-s'],
        maxStdoutBytes: 1,
        deadlineMs: 5000,
      });
      harness.processes[1]?.close(0);
      await running;
      expect(harness.calls[1]?.args[1]).toBe(resolvingPath);
    } finally {
      client.dispose();
    }
  });
});

describe('real ssh -G resolution', () => {
  let directory: string;
  const clients: Array<SshClient> = [];

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'llame-ssh-client-'));
  });

  afterEach(() => {
    for (const client of clients.splice(0)) client.dispose();
    rmSync(directory, { recursive: true, force: true });
  });

  function realClient(
    configText: string,
    resolutionDeadlineMs = 5000,
  ): SshClient {
    const configFile = path.join(directory, 'config');
    writeFileSync(configFile, configText);
    writeFileSync(path.join(directory, 'known_hosts'), '');
    const client = createSshClient({
      ssh: {
        knownHostsFile: path.join(directory, 'known_hosts'),
        configFile,
      },
      resolutionDeadlineMs,
    });
    clients.push(client);
    return client;
  }

  it('shows the worker user and port 22 when the configuration sets neither', async () => {
    const client = realClient('');
    await expect(client.resolve({ host: 'edge-1.lan' })).resolves.toEqual({
      outcome: 'resolved',
      destination: {
        user: userInfo().username,
        host: 'edge-1.lan',
        port: 22,
      },
    });
  });

  it('fails as config for an invalid option in the included configuration', async () => {
    const client = realClient('ThisIsNotAnOption yes\n');
    await expect(client.resolve({ host: 'box' })).resolves.toMatchObject({
      outcome: 'failed',
      reason: 'config',
    });
  });

  it('stops a hanging Match exec at the resolution deadline', async () => {
    const client = realClient(
      'Match exec "sleep 10"\n  HostName hang.lan\n',
      300,
    );
    const started = Date.now();
    const resolution = await client.resolve({ host: 'hang' });
    expect(resolution).toMatchObject({ outcome: 'failed', reason: 'config' });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
