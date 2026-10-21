import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  classifySshLinkFailure,
  spawnOneShotSshProcess,
  spawnSshProcess,
} from './ssh-process';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('classifySshLinkFailure', () => {
  it('reads ssh own refusal messages before the handshake', () => {
    expect(classifySshLinkFailure(false, 'Host key verification failed.')).toBe(
      'host_key_mismatch',
    );
    expect(
      classifySshLinkFailure(false, 'me@box: Permission denied (publickey).'),
    ).toBe('auth_failed');
    expect(
      classifySshLinkFailure(
        false,
        'ssh: connect to host box port 22: Connection timed out',
      ),
    ).toBe('unreachable');
    expect(
      classifySshLinkFailure(false, 'llame-machine: command not found'),
    ).toBe('unreachable');
    expect(classifySshLinkFailure(false, '')).toBe('unreachable');
  });

  it('reads an end after the handshake as a lost session', () => {
    expect(classifySshLinkFailure(true, 'Host key verification failed.')).toBe(
      'session_lost',
    );
    expect(
      classifySshLinkFailure(
        true,
        'kex_exchange_identification: read: Connection reset by peer',
      ),
    ).toBe('session_lost');
  });
});

describe('spawnOneShotSshProcess', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'llame-ssh-process-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('kills its own process group, so a child ssh started dies with it', async () => {
    // A `Match exec` or ProxyCommand runs in the same group; killing only the
    // parent would reparent it and leave it running.
    const leader = path.join(directory, 'leader.pid');
    const child = path.join(directory, 'child.pid');
    const ssh = spawnOneShotSshProcess('sh', [
      '-c',
      `sleep 60 & echo "$!" > "${child}"; echo $$ > "${leader}"; wait`,
    ]);

    const leaderPid = await waitForPid(leader);
    const childPid = await waitForPid(child);
    expect(processGroupOf(leaderPid)).toBe(leaderPid);
    ssh.kill();

    await waitForExit(leaderPid);
    await waitForExit(childPid);
  });

  it('does not throw when the group already ended', async () => {
    const ssh = spawnOneShotSshProcess('sh', ['-c', 'exit 0']);
    await new Promise<void>((resolve) => {
      ssh.onClose(() => resolve());
    });

    expect(() => {
      ssh.kill();
    }).not.toThrow();
  });

  it('kills a child that never got a pid', async () => {
    const ssh = spawnOneShotSshProcess(
      path.join(directory, 'missing-ssh-binary'),
      [],
    );
    // The binary does not exist, so the spawn fails before any pid exists.
    await new Promise<void>((resolve) => {
      ssh.onError(() => resolve());
    });

    expect(() => {
      ssh.kill();
    }).not.toThrow();
  });

  it('wires the streams and the close status to the caller', async () => {
    const ssh = spawnOneShotSshProcess('sh', ['-c', 'cat']);
    let stdout = '';
    ssh.stdout.setEncoding('utf8');
    ssh.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    const closed = new Promise<number | null>((resolve) => {
      ssh.onClose((code) => resolve(code));
    });

    ssh.stdin.end('llame\n');
    const code = await closed;

    expect(code).toBe(0);
    expect(stdout).toBe('llame\n');
  });
});

describe('spawnSshProcess', () => {
  it('runs a command and kills the child alone', async () => {
    const ssh = spawnSshProcess('sh', ['-c', 'cat']);
    let stdout = '';
    ssh.stdout.setEncoding('utf8');
    ssh.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    const closed = new Promise<void>((resolve) => {
      ssh.onClose(() => resolve());
    });

    ssh.stdin.end('machine\n');
    await closed;

    expect(stdout).toBe('machine\n');
    expect(() => {
      ssh.kill();
    }).not.toThrow();
  });
});

/** The process group id a pid belongs to, read from the process table. */
function processGroupOf(pid: number): number {
  const output = execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  const group = Number(output.trim());
  if (!Number.isInteger(group) || group <= 0)
    throw new Error(`no process group for ${pid}`);
  return group;
}

/** Wait for a pid file the fixture shell writes, and return its pid. */
async function waitForPid(file: string): Promise<number> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const text = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
    if (/^[0-9]+$/u.test(text)) return Number(text);
    await delay(25);
  }
  throw new Error(`no pid was written to ${file}`);
}

/**
 * Wait until the pid is dead, proving the group kill reached it. A killed
 * orphan stays a zombie under a PID 1 that does not reap, so a zombie counts.
 */
async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (!isRunning(pid)) return;
    await delay(25);
  }
  throw new Error(`process ${pid} survived the kill`);
}

function isRunning(pid: number): boolean {
  let fields: string;
  try {
    fields = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return false;
  }
  return fields.charAt(fields.lastIndexOf(')') + 2) !== 'Z';
}
