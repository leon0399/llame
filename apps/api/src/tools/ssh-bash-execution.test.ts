/**
 * The bounds, limits, and verdicts of the `ssh://` `bash` execution: what the
 * call asks the client for, and what each non-command outcome becomes.
 */
import { drizzle } from 'drizzle-orm/postgres-js';

import { resetManagedExecutorForTests } from '@workspace/bash-executor';

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
import { SSH_READ_NOISE_BYTES } from '../ssh/ssh-script';
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

/** The local bounds this call shares with a local `bash`. */
function localBounds() {
  const { inputBound, outputBound } = managedBashContext(context(remote()));
  return { inputBound, outputBound };
}

/** A client whose answer is built from the nonce the script drew. */
function remote(reply: (nonce: string) => SshRunOutcome = completed()): Remote {
  const runs: Array<SshRunRequest> = [];
  const client: SshClient = {
    resolve: () =>
      Promise.resolve({
        outcome: 'resolved',
        destination: { user: 'box', host: 'box', port: 22 },
      }),
    run: (request) => {
      runs.push(request);
      const nonce =
        /printf '%s:start\\n' '([0-9a-f]+)'/u.exec(
          String(request.input),
        )?.[1] ?? '';
      return Promise.resolve(reply(nonce));
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
  overflow: { stdout?: boolean; stderr?: boolean } = {},
): SshRunOutcome {
  return {
    outcome: 'ended',
    stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout),
    stdoutOverflow: overflow.stdout ?? false,
    diagnostic: stderr,
    stderrOverflow: overflow.stderr ?? false,
    code,
    signal: null,
  };
}

/** One call's streams: the markers, no output, and the end trailer. */
function completed(): (nonce: string) => SshRunOutcome {
  return (nonce) =>
    ended(`${nonce}:start\n`, `${nonce}:start\n${nonce}:end:0\n`);
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
}

afterEach(() => {
  vi.restoreAllMocks();
  resetManagedExecutorForTests();
});

describe('ssh bash request bounds', () => {
  it('carries the call timeout, the local output bound, and no absent signal', async () => {
    const remoteClient = remote();
    stubFence();

    await executeSshBash(context(remoteClient, { timeoutMs: 1000 }), {
      command: 'true',
      cwd: CWD,
    });

    const { outputBound } = localBounds();
    const run = remoteClient.runs[0];
    expect(run?.deadlineMs).toBe(1000);
    expect(run?.maxStdoutBytes).toBe(outputBound * 3 + SSH_READ_NOISE_BYTES);
    expect(run).not.toHaveProperty('signal');
  });

  it('forwards the call abort signal to the ssh process', async () => {
    const remoteClient = remote();
    const controller = new AbortController();
    stubFence();

    await executeSshBash(
      context(remoteClient, { abortSignal: controller.signal }),
      { command: 'true', cwd: CWD },
    );

    expect(remoteClient.runs[0]?.signal).toBe(controller.signal);
  });

  it('refuses input one byte past the bound, counting the fixed -s argument', async () => {
    const remoteClient = remote();
    stubFence();

    // The command, `-s`, and the resolved directory measure one byte more
    // than the bound together.
    const { inputBound } = localBounds();
    const over = await executeSshBash(context(remoteClient), {
      command: 'x'.repeat(inputBound - 7),
      cwd: CWD,
    });
    expect(over).toEqual({
      status: 'error',
      type: 'unavailable',
      message: 'Command input exceeds the managed input bound.',
    });
    expect(remoteClient.runs).toHaveLength(0);

    const within = await executeSshBash(context(remoteClient), {
      command: 'x'.repeat(inputBound - 8),
      cwd: CWD,
    });
    expect(within).toMatchObject({ status: 'success' });
    expect(remoteClient.runs).toHaveLength(1);
  });
});

describe('ssh bash remote outcome', () => {
  it('leaves a cancellation that reached the transport an unknown outcome', async () => {
    // The script may already have reached the host, so a cancelled local ssh
    // cannot say the command did not run; only a pre-spawn cancel can.
    const remoteClient = remote(() => ({
      outcome: 'failed',
      reason: 'cancelled',
      diagnostic: '',
    }));
    stubFence();

    await expect(
      executeSshBash(context(remoteClient), { command: 'true', cwd: CWD }),
    ).resolves.toMatchObject({
      status: 'error',
      type: 'outcome_unknown',
    });
  });

  it('refuses a call cancelled before it spawned an ssh', async () => {
    const remoteClient = remote();
    stubFence();

    const result = await executeSshBash(
      context(remoteClient, { abortSignal: AbortSignal.abort() }),
      { command: 'true', cwd: CWD },
    );

    expect(result).toEqual({
      status: 'error',
      type: 'cancelled',
      message: 'Command was cancelled before start.',
    });
    expect(remoteClient.runs).toHaveLength(0);
  });

  it('marks stdout overflow as a truncated result', async () => {
    const remoteClient = remote((nonce) =>
      ended(`${nonce}:start\nout\n`, `${nonce}:start\n${nonce}:end:0\n`, 0, {
        stdout: true,
      }),
    );
    stubFence();

    const result = await executeSshBash(context(remoteClient), {
      command: 'true',
      cwd: CWD,
    });

    expect(result).toMatchObject({ status: 'success', truncated: true });
  });

  it('marks stderr overflow alone as a truncated result', async () => {
    const remoteClient = remote((nonce) =>
      ended(
        `${nonce}:start\nout\n`,
        `${nonce}:start\nwarn\n${nonce}:end:0\n`,
        0,
        { stderr: true },
      ),
    );
    stubFence();

    const result = await executeSshBash(context(remoteClient), {
      command: 'true',
      cwd: CWD,
    });

    expect(result).toMatchObject({ status: 'success', truncated: true });
  });

  it('treats a refusal that is not the cwd as an outcome it cannot attribute', async () => {
    const remoteClient = remote((nonce) =>
      ended(
        Buffer.alloc(0),
        `${nonce}:refuse:not_regular_file\n${nonce}:end:0\n`,
      ),
    );
    stubFence();

    const result = await executeSshBash(context(remoteClient), {
      command: 'true',
      cwd: CWD,
    });

    expect(result).toMatchObject({ status: 'error', type: 'outcome_unknown' });
  });
});

describe('ssh bash pre-start and authority limits', () => {
  it('reports a deadline that ended the call before start with an empty result', async () => {
    const remoteClient = remote();
    stubFence();

    const result = await executeSshBash(
      context(remoteClient, { timeoutSignal: AbortSignal.abort() }),
      { command: 'true', cwd: CWD },
    );

    expect(result).toEqual({
      status: 'error',
      type: 'timed_out',
      message:
        'Command exceeded its deadline of 300000 ms.\nstdout:\n\nstderr:\n',
    });
    expect(remoteClient.runs).toHaveLength(0);
  });

  it('refuses without the Run identity the durable attempt needs', async () => {
    const remoteClient = remote();
    stubFence();

    const result = await executeSshBash(
      context(remoteClient, { toolCallId: undefined }),
      { command: 'true', cwd: CWD },
    );

    expect(result).toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    });
    expect(remoteClient.runs).toHaveLength(0);
  });
});
