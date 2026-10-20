import { drizzle } from 'drizzle-orm/postgres-js';

import {
  resetManagedExecutorForTests,
  reserveManagedProcessSlot,
} from '@workspace/bash-executor';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import {
  type SshBinding,
  type SshClient,
  type SshRunOutcome,
  type SshRunRequest,
} from '../ssh/ssh-client';
import { managedBashContext } from './bash-limits';
import { executeSshBash } from './ssh-bash';
import { type ToolContext } from './types';

const BINDING: SshBinding = {
  destination: 'box',
  user: 'box',
  host: 'box',
  port: 22,
  locator: 'ssh://box@box:22/tmp',
};

const CWD = 'ssh://box/tmp';

type Remote = {
  readonly client: SshClient;
  readonly runs: Array<SshRunRequest>;
};

/** A client whose answer is built from the nonce the script drew. */
function remote(
  reply: (nonce: string, request: SshRunRequest) => SshRunOutcome = completed(
    'command out\n',
    '',
    0,
  ),
): Remote {
  const runs: Array<SshRunRequest> = [];
  const client: SshClient = {
    resolve: () =>
      Promise.resolve({
        outcome: 'resolved',
        destination: { user: 'box', host: 'box', port: 22 },
      }),
    run: (request) => {
      runs.push(request);
      const nonce = /h='([0-9a-f]+)'/u.exec(String(request.input))?.[1] ?? '';
      return Promise.resolve(reply(nonce, request));
    },
    sshConfigText: () => undefined,
    dispose: () => undefined,
  };
  return { client, runs };
}

function ended(
  stdout: Buffer | string,
  stderr: string,
  code = 0,
): SshRunOutcome {
  return {
    outcome: 'ended',
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
    stdoutOverflow: false,
    diagnostic: stderr,
    stderrOverflow: false,
    code,
    signal: null,
  };
}

/** One call's streams: the markers, the output, and the end trailer. */
function completed(
  stdout: string,
  stderr: string,
  status: number,
): (nonce: string) => SshRunOutcome {
  return (nonce) =>
    ended(
      `${nonce}:start\n${stdout}`,
      `${nonce}:start\n${stderr}${nonce}:end:${String(status)}\n`,
    );
}

function context(
  remoteClient: Remote,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  const db: Db = drizzle.mock({ schema });
  return {
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    toolCallId: 'call',
    nativeDeliverySequence: 1,
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    sshClient: remoteClient.client,
    sshBinding: BINDING,
    ...overrides,
  };
}

/** The durable fence, stubbed: these tests are about what the call asks for. */
function stubFence() {
  const begin = vi
    .spyOn(NativeFilesRepository.prototype, 'begin')
    .mockResolvedValue(undefined);
  const append = vi
    .spyOn(RunEventsRepository.prototype, 'append')
    .mockResolvedValue({
      runId: 'run',
      sequence: 1,
      eventType: 'native.result',
      payload: null,
      createdAt: new Date(),
    });
  return { begin, append };
}

describe('ssh bash execution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetManagedExecutorForTests();
  });

  it('runs the command through one bash -s script over the resolved binding', async () => {
    const remoteClient = remote(completed('command out\n', 'command err\n', 0));
    const { begin, append } = stubFence();

    const result = await executeSshBash(context(remoteClient), {
      command: 'printenv TOKEN_HINT',
      cwd: CWD,
      env: { TOKEN_HINT: "it's data" },
    });

    expect(result).toEqual({
      status: 'success',
      operation: 'bash',
      executor: 'managed',
      exitCode: 0,
      stdout: 'command out\n',
      stderr: 'command err\n',
      truncated: false,
    });
    const run = remoteClient.runs[0];
    expect(run).toMatchObject({
      destination: 'box',
      resolved: { user: 'box', host: 'box', port: 22 },
      remoteCommand: ['bash', '-s'],
    });
    expect(run?.stderrTailBytes).toBe(512);
    const script = String(run?.input);
    expect(script).toContain("p='/tmp'");
    expect(script).toContain(String.raw`export TOKEN_HINT='it'\''s data'`);
    expect(script).toContain(`( eval 'printenv TOKEN_HINT' ) </dev/null`);
    // No model text reaches the argv of either process.
    expect(run?.remoteCommand).not.toContain('printenv TOKEN_HINT');
    expect(run?.remoteCommand.join(' ')).not.toContain('TOKEN_HINT');
    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({
        fence: { bound: false },
        operation: 'bash',
        path: BINDING.locator,
        deliverySequence: 1,
      }),
    );
    expect(append).toHaveBeenCalledWith(
      'run',
      'native.result',
      expect.objectContaining({ toolCallId: 'call' }),
    );
  });

  it('takes the exit status from the end trailer', async () => {
    const remoteClient = remote(completed('', 'boom\n', 7));
    stubFence();

    const result = await executeSshBash(context(remoteClient), {
      command: 'exit 7',
      cwd: CWD,
    });

    expect(result).toMatchObject({
      status: 'error',
      type: 'command_failed',
    });
    expect(result).toHaveProperty(
      'message',
      expect.stringContaining('Command exited with code 7.'),
    );
    expect(result.status === 'error' && result.message).toContain('boom');
  });

  it('keeps a 255 status the command chose, not a connection failure', async () => {
    const remoteClient = remote(completed('', '', 255));
    stubFence();

    const result = await executeSshBash(context(remoteClient), {
      command: 'exit 255',
      cwd: CWD,
    });

    expect(result).toMatchObject({
      status: 'error',
      type: 'command_failed',
    });
    expect(result).toHaveProperty(
      'message',
      expect.stringContaining('Command exited with code 255.'),
    );
  });

  it('refuses the cwd with the local result before the command can run', async () => {
    const remoteClient = remote((nonce) =>
      ended(Buffer.alloc(0), `${nonce}:refuse:cwd\n${nonce}:end:0\n`),
    );
    stubFence();

    const result = await executeSshBash(context(remoteClient), {
      command: 'printf never',
      cwd: 'ssh://box/no/such/dir',
    });

    expect(result).toEqual({
      status: 'error',
      type: 'unavailable',
      message:
        'Working directory argument "ssh://box/no/such/dir" is not usable. The command did not run; the argument was taken literally with no ~ or variable expansion. List its parent or create the directory.',
    });
    // The command sits after the failing guard, so it never ran.
    const script = String(remoteClient.runs[0]?.input);
    expect(script.indexOf('printf never')).toBeGreaterThan(
      script.indexOf('refuse:cwd'),
    );
  });

  it('clips the command output to the local output bound', async () => {
    const remoteClient = remote(completed('x'.repeat(40_000), '', 0));
    stubFence();

    const result = await executeSshBash(context(remoteClient), {
      command: 'yes x | head -c 40000',
      cwd: CWD,
    });

    expect(result).toMatchObject({ status: 'success', truncated: true });
    expect(String(result['stdout'])).toHaveLength(32_000);
  });

  it('reports a started command without its trailer as an unknown outcome', async () => {
    const remoteClient = remote((nonce) =>
      ended(`${nonce}:start\n`, `${nonce}:start\n`),
    );
    stubFence();

    const result = await executeSshBash(context(remoteClient), {
      command: 'sleep 1',
      cwd: CWD,
    });

    expect(result).toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });
  });

  it('keeps a pre-session ssh refusal typed', async () => {
    const auth = remote(() =>
      ended('', 'box: Permission denied (publickey).', 255),
    );
    stubFence();
    await expect(
      executeSshBash(context(auth), { command: 'true', cwd: CWD }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'ssh_unavailable',
    });
    const authResult = await executeSshBash(context(auth), {
      command: 'true',
      cwd: CWD,
    });
    expect(authResult).toHaveProperty(
      'message',
      expect.stringContaining('auth_failed'),
    );

    const missingBash = remote(() => ended('', 'sh: 1: bash: not found', 127));
    const result = await executeSshBash(context(missingBash), {
      command: 'true',
      cwd: CWD,
    });
    expect(result).toMatchObject({
      status: 'error',
      type: 'ssh_unsupported_host',
    });
    expect(result.status === 'error' && result.message).toContain('bash');
  });

  const envRefusals: ReadonlyArray<{
    readonly label: string;
    readonly env: Record<string, string>;
    readonly message: string;
  }> = [
    {
      label: 'a key carrying shell text',
      env: { 'X=1; id; Y': 'v' },
      message: 'is not a valid name',
    },
    { label: 'a NUL value', env: { TOKEN: 'a\0b' }, message: 'NUL' },
    {
      label: 'a managed base variable',
      env: { PATH: '/tmp' },
      message:
        'Environment variable PATH cannot replace a managed base variable.',
    },
  ];

  it.each(envRefusals)(
    'refuses $label before any attempt or process',
    async ({ env, message }) => {
      const remoteClient = remote();
      const { begin } = stubFence();

      const result = await executeSshBash(context(remoteClient), {
        command: 'printf never',
        cwd: CWD,
        env,
      });

      expect(result).toMatchObject({ status: 'error', type: 'unavailable' });
      expect(result.status === 'error' && result.message).toContain(message);
      expect(remoteClient.runs).toHaveLength(0);
      expect(begin).not.toHaveBeenCalled();
    },
  );

  it('refuses a command over the local input bound before any process', async () => {
    const remoteClient = remote();
    const { begin } = stubFence();

    const result = await executeSshBash(context(remoteClient), {
      command: 'x'.repeat(8001),
      cwd: CWD,
    });

    expect(result).toEqual({
      status: 'error',
      type: 'unavailable',
      message: 'Command input exceeds the managed input bound.',
    });
    expect(remoteClient.runs).toHaveLength(0);
    expect(begin).not.toHaveBeenCalled();
  });

  it('shares the managed process slot with local bash', async () => {
    const remoteClient = remote();
    const toolContext = context(remoteClient);
    stubFence();
    const slot = reserveManagedProcessSlot(managedBashContext(toolContext));
    if ('type' in slot) throw new Error('Expected a slot');

    try {
      await expect(
        executeSshBash(toolContext, { command: 'true', cwd: CWD }),
      ).resolves.toEqual({
        status: 'error',
        type: 'unavailable',
        message: 'Managed process limit reached.',
      });
      expect(remoteClient.runs).toHaveLength(0);
    } finally {
      slot.release();
    }
  });

  it('refuses a call cancelled before it starts', async () => {
    const remoteClient = remote();
    stubFence();

    await expect(
      executeSshBash(
        context(remoteClient, { abortSignal: AbortSignal.abort() }),
        { command: 'true', cwd: CWD },
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'cancelled',
      message: 'Command was cancelled before start.',
    });
    expect(remoteClient.runs).toHaveLength(0);

    const timedOut = await executeSshBash(
      context(remoteClient, { timeoutSignal: AbortSignal.abort() }),
      { command: 'true', cwd: CWD },
    );
    expect(timedOut).toMatchObject({ status: 'error', type: 'timed_out' });
  });

  it('replays a recorded attempt instead of running the command again', async () => {
    const remoteClient = remote();
    stubFence();
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue({
      status: 'error',
      type: 'outcome_unknown',
      message: 'recorded earlier',
    });

    const result = await executeSshBash(context(remoteClient), {
      command: 'true',
      cwd: CWD,
    });

    expect(result).toEqual({
      status: 'error',
      type: 'outcome_unknown',
      message: 'recorded earlier',
    });
    expect(remoteClient.runs).toHaveLength(0);
  });

  it('refuses an unhooked or selected cwd without a process', async () => {
    const remoteClient = remote();
    stubFence();

    await expect(
      executeSshBash(context(remoteClient), {
        command: 'true',
        cwd: 'ssh://box/tmp:1-2',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'An ssh:// working directory is one absolute path without a selector.',
    });
    await expect(
      executeSshBash(
        { ...context(remoteClient), sshBinding: undefined },
        { command: 'true', cwd: CWD },
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme is not available.',
    });
    expect(remoteClient.runs).toHaveLength(0);
  });
});
