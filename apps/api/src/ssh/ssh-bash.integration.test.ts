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

import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type StartedTestContainer } from 'testcontainers';

import { type Chat, type ChatJob } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { MachineConnector } from '../machines/machine-connector.service';
import { createMachineSshTransportFactory } from '../machines/machine-ssh-transport';
import type { MachineTransport } from '../machines/machine-transport';
import { hostBashJobs } from '../testing/host-bash-jobs';
import { waitFor } from '../testing/support';
import {
  MACHINE_SSHD_NAME,
  MACHINE_SSHD_SH_ALIAS,
  MACHINE_SSHD_ROOT,
  startMachineSshd,
  type MachineSshd,
} from '../testing/machine-sshd/machine-sshd';
import { ArtifactsRepository } from '../tools/artifacts/artifacts-repository';
import { ChatsRepository } from '../chats/chats-repository';
import { bashTool } from '../tools/bash';
import { nativeReadTool } from '../tools/native-files';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import { runTool } from '../tools/runner';
import { type ToolContext } from '../tools/types';
import { createWorkspaceRootCell } from '../tools/workspace-path';
import { createSshClient, type SshClient } from './ssh-client';
import { spawnSshProcess, type SshSpawn } from './ssh-process';

function interruptCurrent(aborts: RunAbortRegistry, runId: string): void {
  const segment = aborts.segmentOf(runId);

  if (segment !== undefined) aborts.interrupt(runId, segment);
}

/** The call budget: enough for the containers' first SSH handshake. */
const CALL_TIMEOUT_SECONDS = 30;

/**
 * The configured byte bound, at the 16,000-unit inline budget so the cut
 * stream stays whole in the model text instead of a preview of it.
 */
const INLINE_BUDGET = 16_000;

/** The attempt ledger itself is stubbed; the context only needs a DB handle. */
const tenantDb: TenantRunner = {
  runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
    callback(drizzle.mock()),
};

function lockedChat(): Chat {
  return {
    id: 'chat',
    ownerUserId: 'owner',
    title: null,
    visibility: 'private',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    archivedAt: null,
    projectId: null,
    skillCatalogBaseline: null,
    skillCatalogRebakedFrom: null,
    skillCatalogTold: null,
    workspaceRoot: null,
    workspaceExecutorId: null,
    workspaceGeneration: 0,
    workspaceTold: null,
    artifactSeq: 0,
    workspaceToldAvailable: null,
    workspaceToldFrom: null,
    workspaceDetachReason: null,
    modelSelection: null,
  };
}

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
      configuredCredentials: overrides.configuredCredentials ?? [],
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

  function machineBashRuntime(machines: MachineConnector) {
    const daemonJobId = { value: '' };

    const row: ChatJob = {
      id: randomUUID(),
      chatId: 'chat',
      ownerUserId: 'owner',
      kind: 'bash',
      seq: 1,
      state: 'running',
      stoppedBy: null,
      runId: 'run',
      toolCallId: 'call',
      machineName: MACHINE_SSHD_NAME,
      daemonInstanceId: '00000000-0000-4000-8000-000000000013',
      daemonJobId: '',
      delivery: 'foreground',
      startedAt: new Date(),
      settledAt: null,
      deadlineAt: null,
      stopRequestedAt: null,
      stopRequestedBy: null,
      result: null,
      outputs: ['stdout', 'stderr'],
      artifactId: null,
      artifactReadable: false,
      settings: { selector: 'test-model', permissionMode: 'default' },
    };

    vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(lockedChat());
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(1);
    vi.spyOn(ChatJobsRepository.prototype, 'insert').mockImplementation(
      (input) => {
        daemonJobId.value = input.daemonJobId;

        return Promise.resolve({ ...row, daemonJobId: input.daemonJobId });
      },
    );
    vi.spyOn(
      ChatJobsRepository.prototype,
      'promoteToBackground',
    ).mockImplementation(() => {
      const { promise, resolve } = Promise.withResolvers<ChatJob | undefined>();

      // Exercise the real 750 ms abort fence while a promotion transaction commits.
      setTimeout(() => resolve({ ...row, delivery: 'background' }), 800);

      return promise;
    });
    vi.spyOn(
      NativeFilesRepository.prototype,
      'recoverHostPromotion',
    ).mockImplementation((input) =>
      Promise.resolve({ disposition: 'recovery_won', result: input.result }),
    );

    return {
      ...hostBashJobs(tenantDb, machines, {
        wakeForChatInTransaction: () => Promise.resolve(false),
      }),
      daemonJobId,
    };
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
    // A small artifact bound keeps this test above the bound it configures,
    // and keeps the cut stream within the inline budget, so the model text is
    // the whole bounded stream rather than a preview of it.
    const result = await bash(
      {
        command: String.raw`head -c 40000 /dev/zero | tr '\0' 'x'`,
        cwd: 'ssh://box/tmp',
      },
      client(),
      { artifactMaxBytes: INLINE_BUDGET },
    );

    expect(result).toMatchObject({ status: 'success', cut: true });
    const stdout = String(result['stdout']);
    expect(stdout).toMatch(/^x+$/u);
    expect(stdout.length).toBeGreaterThan(0);
    // Bounded by the managed bound and then by the runner's result cap; either
    // way the 40,000 bytes the command wrote cannot reach the model.
    expect(stdout.length).toBeLessThanOrEqual(INLINE_BUDGET);
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

  it('An interrupt cancels SSH bash even though its segment also yields', async () => {
    const aborts = new RunAbortRegistry();
    aborts.register('run', 'owner');
    const segment = aborts.beginSegment('run', 'attempt');

    if (segment === undefined) throw new Error('Missing active segment');

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
          queueMicrotask(() => interruptCurrent(aborts, 'run'));
        }
      });

      return process;
    };

    const result = await bash(
      { command: 'sleep 30', cwd: 'ssh://box/tmp' },
      client({ spawn }),
      { abortSignal: segment.abort.signal, yieldSignal: segment.yield.signal },
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });
  }, 60_000);

  it('An interrupt backgrounds a Machine Workspace command with omitted cwd', async () => {
    const connection = fixture.connection();

    const transport = createMachineSshTransportFactory({
      ssh: connection.machines.ssh,
    });

    const machines = new MachineConnector({
      machines: connection.machines,
      hubVersion: '0.0.0-yield-test',
      bindIdentity: () => Promise.resolve('match'),
      transportFactory: transport,
    });

    const aborts = new RunAbortRegistry();
    aborts.register('run', 'owner');
    const segment = aborts.beginSegment('run', 'attempt');
    const jobRuntime = machineBashRuntime(machines);

    if (segment === undefined) throw new Error('Missing active segment');
    const marker = `${MACHINE_SSHD_ROOT}/yield-${crypto.randomUUID()}`;

    try {
      const call = runTool(
        bashTool,
        { command: `echo $$ > ${marker}; exec sleep 30` },
        context(client(), {
          ...jobRuntime,
          attemptId: 'attempt',
          machines,
          workspaceRoot: createWorkspaceRootCell(
            `machine://devl${MACHINE_SSHD_ROOT}`,
          ),
          abortSignal: segment.abort.signal,
          yieldSignal: segment.yield.signal,
        }),
        CALL_TIMEOUT_SECONDS,
      );

      const pid = await waitFor(
        async () => {
          const result = await fixture.box.exec(['cat', marker]);

          return result.exitCode === 0
            ? result.stdout.trim() || undefined
            : undefined;
        },
        10_000,
        'the Machine command to start',
      );

      interruptCurrent(aborts, 'run');
      await expect(call).resolves.toMatchObject({
        status: 'success',
        backgrounded: true,
        cause: 'message',
      });

      const stopFactory = createMachineSshTransportFactory({
        ssh: connection.machines.ssh,
      });

      const stopper = new MachineConnector({
        machines: connection.machines,
        hubVersion: '0.0.0-yield-stop-test',
        bindIdentity: () => Promise.resolve('match'),
        transportFactory: stopFactory,
      });

      try {
        const session = await stopper.jobsClient(MACHINE_SSHD_NAME);

        await session.client.cancelJob(
          {
            requestId: jobRuntime.daemonJobId.value,
            jobId: jobRuntime.daemonJobId.value,
            owner: 'owner',
          },
          session.callOptions(),
        );
      } finally {
        stopper.onModuleDestroy();
        stopFactory.dispose();
      }

      await waitFor(
        async () => {
          const result = await fixture.box.exec(['kill', '-0', pid]);

          return result.exitCode !== 0 ? true : undefined;
        },
        10_000,
        'the Machine command to stop',
      );
    } finally {
      machines.onModuleDestroy();
      transport.dispose();
    }
  }, 60_000);

  it('backgrounds a Machine job on disconnect and stops it from a new session', async () => {
    const connection = fixture.connection();

    const factory = createMachineSshTransportFactory({
      ssh: connection.machines.ssh,
    });

    const links: Array<MachineTransport> = [];

    const machines = new MachineConnector({
      machines: connection.machines,
      hubVersion: '0.0.0-disconnect-test',
      bindIdentity: () => Promise.resolve('match'),
      transportFactory: {
        open: (request) => {
          const link = factory.open(request);
          links.push(link);

          return link;
        },
      },
    });

    const command = 'sleep 300';
    const daemonJobId = { value: '' };

    const row: ChatJob = {
      id: randomUUID(),
      chatId: 'chat',
      ownerUserId: 'owner',
      kind: 'bash',
      seq: 1,
      state: 'running',
      stoppedBy: null,
      runId: 'run',
      toolCallId: 'call',
      machineName: MACHINE_SSHD_NAME,
      daemonInstanceId: '00000000-0000-4000-8000-000000000013',
      daemonJobId: '',
      delivery: 'foreground',
      startedAt: new Date(),
      settledAt: null,
      deadlineAt: null,
      stopRequestedAt: null,
      stopRequestedBy: null,
      result: null,
      outputs: ['stdout', 'stderr'],
      artifactId: null,
      artifactReadable: false,
      settings: { selector: 'test-model', permissionMode: 'default' },
    };

    const runtime = hostBashJobs(tenantDb, machines, {
      wakeForChatInTransaction: () => Promise.resolve(false),
    });

    vi.spyOn(ChatsRepository.prototype, 'lock').mockResolvedValue(lockedChat());
    vi.spyOn(ArtifactsRepository.prototype, 'nextSeq').mockResolvedValue(1);
    vi.spyOn(ChatJobsRepository.prototype, 'insert').mockImplementation(
      (input) => {
        daemonJobId.value = input.daemonJobId;

        return Promise.resolve({ ...row, daemonJobId: input.daemonJobId });
      },
    );
    vi.spyOn(
      NativeFilesRepository.prototype,
      'recoverHostPromotion',
    ).mockImplementation((input) =>
      Promise.resolve({ disposition: 'recovery_won', result: input.result }),
    );

    try {
      const call = runTool(
        bashTool,
        { command, cwd: `machine://${MACHINE_SSHD_NAME}${MACHINE_SSHD_ROOT}` },
        {
          ...context(client()),
          ...runtime,
          attemptId: 'attempt',
          bashBackgroundAfterSeconds: 60,
          machines,
          workspaceRoot: createWorkspaceRootCell(
            `machine://${MACHINE_SSHD_NAME}${MACHINE_SSHD_ROOT}`,
          ),
        },
        CALL_TIMEOUT_SECONDS,
      );

      await waitFor(
        async () => {
          const result = await fixture.execIn(fixture.box, [
            'ps',
            '-eo',
            'args',
          ]);

          return result.stdout.includes(command) ? true : undefined;
        },
        10_000,
        'the Machine job to start',
      );

      const link = links.at(-1);

      if (link === undefined)
        throw new Error('The Machine job session was never opened.');
      link.close();

      await expect(call).resolves.toMatchObject({
        status: 'success',
        backgrounded: true,
        cause: 'disconnect',
      });

      const stopFactory = createMachineSshTransportFactory({
        ssh: connection.machines.ssh,
      });

      const stopper = new MachineConnector({
        machines: connection.machines,
        hubVersion: '0.0.0-disconnect-stop-test',
        bindIdentity: () => Promise.resolve('match'),
        transportFactory: stopFactory,
      });

      try {
        const session = await stopper.jobsClient(MACHINE_SSHD_NAME);

        await session.client.cancelJob(
          {
            requestId: daemonJobId.value,
            jobId: daemonJobId.value,
            owner: 'owner',
          },
          session.callOptions(),
        );
      } finally {
        stopper.onModuleDestroy();
        stopFactory.dispose();
      }

      await waitFor(
        async () => {
          const result = await fixture.execIn(fixture.box, [
            'ps',
            '-eo',
            'args',
          ]);

          return result.stdout.includes(command) ? undefined : true;
        },
        10_000,
        'the Machine job to stop',
      );
    } finally {
      machines.onModuleDestroy();
      factory.dispose();
    }
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
