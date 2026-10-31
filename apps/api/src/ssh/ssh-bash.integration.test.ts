/**
 * `bash` over `ssh://` against the sshd fixture (ssh-locator tasks 5.4 and
 * 5.5). The hub side is the production path end to end: the real `runTool`
 * admission resolves the destination through `ssh -G`, permission decides on
 * the resolved `cwd`, and execution spawns the system `ssh` with `bash -s` and
 * the script on stdin.
 *
 * The box is reached through the bastion alias the include declares; the
 * `shbox` container is the same image without `bash`; the durable native
 * attempt and its result event are stubbed because these tests are about the
 * wire, not the ledger. Requires a Docker daemon and the OpenSSH client tools.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { type StartedTestContainer } from 'testcontainers';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import {
  MACHINE_SSHD_SH_ALIAS,
  startMachineSshd,
  type MachineSshd,
} from '../testing/machine-sshd/machine-sshd';
import { createSshClient, type SshClient } from './ssh-client';
import { spawnSshProcess, type SshSpawn } from './ssh-process';

import { type TenantRunner } from '../db/tenant-db.service';
import { bashTool } from '../tools/bash';
import { nativeReadTool } from '../tools/native-files';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import { runTool } from '../tools/runner';
import { type ToolContext } from '../tools/types';
import { createWorkspaceRootCell } from '../tools/workspace-path';

/** The call budget: enough for the containers' first SSH handshake. */
const CALL_TIMEOUT_SECONDS = 30;

/** The output bound the local and remote `bash` share. */
const OUTPUT_BOUND = 32_000;

/** The attempt ledger itself is stubbed; the context only needs a DB handle. */
const tenantDb: TenantRunner = {
  runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
    callback(drizzle.mock({ schema })),
};

const policy = compileToolPermissionMap(
  { bash: { allow: true }, read: { allow: true } },
  'test-policy',
);

describe('ssh bash over a real sshd', () => {
  let fixture: MachineSshd;
  const clients: Array<SshClient> = [];

  beforeAll(async () => {
    fixture = await startMachineSshd();
  }, 600_000);

  afterAll(async () => {
    for (const client of clients) client.dispose();
    await fixture.dispose();
  });

  beforeEach(() => {
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(
      undefined,
    );
    vi.spyOn(RunEventsRepository.prototype, 'append').mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });
  });

  afterEach(() => vi.restoreAllMocks());

  function client(options: { readonly spawn?: SshSpawn } = {}): SshClient {
    const connection = fixture.ssh();
    const created = createSshClient({
      ssh: {
        knownHostsFile: connection.knownHostsFile,
        identityFile: connection.identityFile,
        configFile: connection.includeFile,
      },
      ...(options.spawn !== undefined && { spawn: options.spawn }),
    });
    clients.push(created);
    return created;
  }

  function context(
    sshClient: SshClient,
    overrides: Partial<ToolContext> = {},
  ): ToolContext {
    return {
      userId: 'owner',
      chatId: 'chat',
      runId: 'run',
      toolCallId: 'call',
      nativeDeliverySequence: 1,
      tenantDb,
      permissionPolicy: policy,
      sshClient,
      ...overrides,
    };
  }

  function bash(
    input: {
      readonly command: string;
      readonly cwd: string;
      readonly env?: Record<string, string>;
    },
    sshClient: SshClient,
    overrides: Partial<ToolContext> = {},
    callTimeoutSeconds = CALL_TIMEOUT_SECONDS,
  ) {
    return runTool(
      bashTool,
      input,
      context(sshClient, overrides),
      callTimeoutSeconds,
    );
  }

  function read(path: string, sshClient: SshClient) {
    return runTool(
      nativeReadTool,
      { path },
      context(sshClient),
      CALL_TIMEOUT_SECONDS,
    );
  }

  async function hostnameOf(container: StartedTestContainer): Promise<string> {
    const result = await fixture.execIn(container, ['hostname']);
    return result.stdout.trim();
  }

  it('runs the command in the remote directory as the remote login user', async () => {
    const result = await bash(
      { command: 'pwd', cwd: 'ssh://box/tmp' },
      client(),
    );

    expect(result).toMatchObject({
      status: 'success',
      exitCode: 0,
      stdout: '/tmp\n',
    });
    expect(result).toHaveProperty('wallTimeMs', expect.any(Number));
    const who = await bash(
      { command: 'id -un; hostname', cwd: 'ssh://box/tmp' },
      client(),
    );
    expect(who).toMatchObject({ status: 'success' });
    expect(String(who['stdout'])).toContain('box');
    expect(String(who['stdout'])).toContain(await hostnameOf(fixture.box));
  });

  it('keeps a remote exit status of 255 as the command status', async () => {
    const result = await bash(
      { command: 'exit 255', cwd: 'ssh://box/tmp' },
      client(),
    );

    expect(result).toMatchObject({ status: 'error', type: 'command_failed' });
    expect(result.status === 'error' && result.message).toContain('exit 255');
  });

  it('refuses a missing cwd without running the command', async () => {
    const marker = `/tmp/llame-ssh-bash-cwd-${String(Date.now())}`;

    const result = await bash(
      { command: `printf ran > ${marker}`, cwd: 'ssh://box/no/such/dir' },
      client(),
    );

    expect(result).toEqual({
      status: 'error',
      type: 'unavailable',
      message:
        'Working directory argument "ssh://box/no/such/dir" is not usable. The command did not run; the argument was taken literally with no ~ or variable expansion. List its parent or create the directory.',
    });
    await expect(
      fixture.execIn(fixture.box, ['sh', '-c', `test ! -e ${marker}`]),
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  it('keeps env values out of every argv on the hub and the host', async () => {
    const token = 'llameTOKEN9f3a';
    const argv: Array<ReadonlyArray<string>> = [];
    const spawn: SshSpawn = (command, args) => {
      argv.push(args);
      return spawnSshProcess(command, args);
    };

    const result = await runTool(
      bashTool,
      {
        command: `printenv TOKEN_HINT; if grep -q ${token} /proc/[0-9]*/cmdline 2>/dev/null; then echo ARGV_LEAK; fi`,
        cwd: 'ssh://box/tmp',
        env: { TOKEN_HINT: token },
      },
      context(client({ spawn })),
      CALL_TIMEOUT_SECONDS,
    );

    expect(result).toMatchObject({ status: 'success' });
    expect(String(result['stdout'])).toContain(token);
    expect(String(result['stdout'])).not.toContain('ARGV_LEAK');
    expect(argv.length).toBeGreaterThan(0);
    for (const args of argv) expect(args.join('\u0000')).not.toContain(token);
  });

  it('bounds the output as a local command is bounded', async () => {
    const result = await bash(
      {
        command: String.raw`head -c 40000 /dev/zero | tr '\0' 'x'`,
        cwd: 'ssh://box/tmp',
      },
      client(),
    );

    expect(result).toMatchObject({ status: 'success', cut: true });
    const stdout = String(result['stdout']);
    expect(stdout).toMatch(/^x+$/u);
    expect(stdout.length).toBeGreaterThan(0);
    // Bounded by the managed bound and then by the runner's result cap; either
    // way the 40,000 bytes the command wrote cannot reach the model.
    expect(stdout.length).toBeLessThanOrEqual(OUTPUT_BOUND);
    expect(stdout.length).toBeLessThan(40_000);
  });

  it('runs an ssh:// cwd inside a Machine Workspace on the ssh host', async () => {
    const result = await bash(
      { command: 'pwd', cwd: 'ssh://box/tmp' },
      client(),
      {
        workspaceRoot: createWorkspaceRootCell('machine://devl/home/box/work'),
      },
    );

    expect(result).toMatchObject({ status: 'success', stdout: '/tmp\n' });
    expect(String(result['stdout'])).not.toContain('/home/box/work');
  });

  it('keeps an entry named like a script variable out of every frame', async () => {
    // `h` and `p` are the names the script used to read; an entry may still
    // carry them, and its value must reach the command without touching the
    // markers, the directory, or the trailer.
    const result = await bash(
      {
        command: 'pwd; printenv h; printenv p',
        cwd: 'ssh://box/tmp',
        env: { h: 'set-by-env', p: '/nope' },
      },
      client(),
    );

    expect(result).toMatchObject({ status: 'success', exitCode: 0 });
    expect(result['stdout']).toBe('/tmp\nset-by-env\n/nope\n');
  });

  it('refuses bash on the sh-only host while a read still works', async () => {
    const sshClient = client();
    const result = await bash(
      { command: 'printf never', cwd: `ssh://${MACHINE_SSHD_SH_ALIAS}/tmp` },
      sshClient,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'ssh_unsupported_host',
    });
    expect(result.status === 'error' && result.message).toContain('bash');

    const file = await read(
      `ssh://${MACHINE_SSHD_SH_ALIAS}/etc/hostname`,
      sshClient,
    );
    expect(file).toMatchObject({ status: 'success', kind: 'file' });
    expect(file['content']).toContain(await hostnameOf(fixture.shBox));
  });

  it('leaves a timed-out command an unknown outcome', async () => {
    const result = await bash(
      { command: 'sleep 30', cwd: 'ssh://box/tmp' },
      client(),
      {},
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });
  }, 60_000);

  it('leaves a command cancelled after it started an unknown outcome', async () => {
    const controller = new AbortController();
    // Cancel on the remote start marker itself, not on a guessed delay: the
    // abort lands in a microtask, after every stderr listener has the chunk,
    // so the frames say the command had started.
    const spawn: SshSpawn = (command, args) => {
      const process = spawnSshProcess(command, args);
      let seen = '';
      process.stderr.on('data', (chunk: Buffer | string) => {
        seen += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
        if (/[0-9a-f]{32}:start/u.test(seen)) {
          seen = '';
          queueMicrotask(() => controller.abort());
        }
      });
      return process;
    };

    const result = await bash(
      { command: 'sleep 30', cwd: 'ssh://box/tmp' },
      client({ spawn }),
      { abortSignal: controller.signal },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });
  }, 60_000);

  it('reports an unreachable host as a known refusal', async () => {
    const result = await bash(
      { command: 'printf never', cwd: 'ssh://127.0.0.1:1/tmp' },
      client(),
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'ssh_unavailable',
    });
    expect(result.status === 'error' && result.message).toContain(
      'unreachable',
    );
  });
});
