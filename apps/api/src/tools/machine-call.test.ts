import { drizzle } from 'drizzle-orm/postgres-js';

import {
  BUDGET_EXHAUSTED_MESSAGE,
  MachineProtocolError,
  PATH_NOT_REGISTERED_MESSAGE,
} from '@workspace/machine-protocol';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  MachineConnector,
  MachineUnavailableError,
} from '../machines/machine-connector.service';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import {
  createProtocolPeer,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';
import { compileTestPermissionPolicy } from '../testing/tool-permission-policy';
import {
  MACHINE_BASH_BUDGET_MS,
  MACHINE_FILE_BUDGET_MS,
  machineBudgetMs,
  machineCallAttemptKey,
  machineCallEnvelope,
  machineConnector,
  machineNotFoundResult,
  machineProtocolFailureResult,
  machineReadResult,
  machineUnknownResult,
  machineUnavailableResult,
  machineUnusableResult,
  readBytesChunk,
  readProcBashResult,
  runMachineMutation,
} from './machine-call';
import { type ToolContext, type ToolResult } from './types';

const MACHINES = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: { devl: { destination: 'box' } },
};

function connectorFor(options: ProtocolPeerOptions = {}) {
  const peer = createProtocolPeer(options);
  return {
    peer,
    connector: new MachineConnector({
      machines: MACHINES,
      hubVersion: '9.9.9',
      transportFactory: peer.factory,
      handshakeTimeoutMs: 2000,
    }),
  };
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  const db: Db = drizzle.mock({ schema });
  return {
    userId: 'owner',
    chatId: 'chat',
    runId: 'run',
    nativeDeliverySequence: 1,
    toolCallId: 'call',
    permissionPolicy: compileTestPermissionPolicy(),
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    machineAttemptKey: 'attempt-1',
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

describe('machineBudgetMs', () => {
  it('uses the operation ceiling when the call has no deadline', () => {
    expect(machineBudgetMs(context({ timeoutMs: undefined }), 60_000)).toBe(
      60_000,
    );
  });

  it('uses the call deadline when it is shorter than the ceiling', () => {
    expect(machineBudgetMs(context({ timeoutMs: 5000 }), 60_000)).toBe(5000);
  });

  it('caps the call deadline at the operation ceiling', () => {
    expect(machineBudgetMs(context({ timeoutMs: 90_000 }), 60_000)).toBe(
      60_000,
    );
  });

  it('never sends a budget below one millisecond', () => {
    expect(machineBudgetMs(context({ timeoutMs: 0 }), 60_000)).toBe(1);
  });

  it('names the file and bash ceilings', () => {
    expect(MACHINE_FILE_BUDGET_MS).toBe(60_000);
    expect(MACHINE_BASH_BUDGET_MS).toBe(300_000);
  });
});

describe('machineCallEnvelope', () => {
  it('takes its identity and budget from the tool context', () => {
    expect(machineCallEnvelope(context(), 1234)).toEqual({
      runId: 'run',
      attemptId: 'attempt-1',
      toolCallId: 'call',
      deliverySeq: 1,
      budgetMs: 1234,
    });
  });

  it('omits every identity the context does not carry', () => {
    expect(
      machineCallEnvelope(
        context({
          runId: undefined,
          toolCallId: undefined,
          nativeDeliverySequence: undefined,
          machineAttemptKey: undefined,
        }),
        7,
      ),
    ).toEqual({ budgetMs: 7 });
  });
});

describe('machineCallAttemptKey', () => {
  it('prefers the attempt key the context carries', () => {
    expect(machineCallAttemptKey(context({ machineAttemptKey: 'a-key' }))).toBe(
      'a-key',
    );
  });

  it('falls back to the Run and delivery sequence', () => {
    expect(
      machineCallAttemptKey(
        context({
          machineAttemptKey: undefined,
          runId: 'run-1',
          nativeDeliverySequence: 3,
        }),
      ),
    ).toBe('run-1\u00003');
  });

  it('substitutes an empty Run id and a missing sequence', () => {
    expect(
      machineCallAttemptKey(
        context({
          machineAttemptKey: undefined,
          runId: undefined,
          nativeDeliverySequence: undefined,
        }),
      ),
    ).toBe('\u0000none');
  });
});

describe('machineConnector', () => {
  it('returns the connector when Machines are configured', () => {
    const { connector } = connectorFor();
    expect(machineConnector(context({ machines: connector }))).toBe(connector);
  });

  it('returns undefined without a connector', () => {
    expect(machineConnector(context())).toBeUndefined();
  });

  it('returns undefined when the feature is absent', () => {
    const disabled = new MachineConnector({
      machines: undefined,
      hubVersion: '9.9.9',
    });
    expect(machineConnector(context({ machines: disabled }))).toBeUndefined();
  });
});

describe('Machine failure vocabulary', () => {
  it('names the Machine a locator did not match', () => {
    expect(machineNotFoundResult('devl')).toEqual({
      status: 'error',
      type: 'machine_not_found',
      message: 'No Machine named "devl" is configured.',
    });
  });

  it('reports an unavailable Machine without a reason', () => {
    expect(machineUnavailableResult('devl')).toEqual({
      status: 'error',
      type: 'machine_unavailable',
      message: 'The Machine "devl" is unavailable.',
    });
  });

  it.each([
    ['unreachable', 'it could not be reached'],
    ['host_key_mismatch', 'its host key does not match the pinned one'],
    ['auth_failed', 'authentication failed'],
    [
      'incompatible_version',
      'its daemon speaks an incompatible protocol version',
    ],
    ['session_lost', 'the session was lost'],
  ] as const)('names the reason for %s', (reason, text) => {
    expect(machineUnavailableResult('devl', reason)).toEqual({
      status: 'error',
      type: 'machine_unavailable',
      message: `The Machine "devl" is unavailable because ${text}.`,
    });
  });

  it('warns that a mutation may have executed', () => {
    expect(machineUnknownResult('devl')).toEqual({
      status: 'error',
      type: 'outcome_unknown',
      message:
        'The operation on Machine "devl" may have executed; inspect it before retrying. It will not be repeated automatically.',
    });
  });

  it('reports an unusable answer', () => {
    expect(machineUnusableResult('devl')).toEqual({
      status: 'error',
      type: 'machine_protocol_error',
      message: 'The Machine "devl" answered an unusable result.',
    });
  });
});

describe('machineProtocolFailureResult', () => {
  it('reports an unregistered path with the shared message', () => {
    expect(
      machineProtocolFailureResult(
        'devl',
        new MachineProtocolError('path_not_registered', 'outside every root'),
      ),
    ).toEqual({
      status: 'error',
      type: 'path_not_registered',
      message: PATH_NOT_REGISTERED_MESSAGE,
    });
  });

  it('reports an exhausted budget as a timeout', () => {
    expect(
      machineProtocolFailureResult(
        'devl',
        new MachineProtocolError('budget_exhausted', 'already spent'),
      ),
    ).toEqual({
      status: 'error',
      type: 'timed_out',
      message: BUDGET_EXHAUSTED_MESSAGE,
    });
  });

  it('reports an incompatible version as an unavailable Machine', () => {
    expect(
      machineProtocolFailureResult(
        'devl',
        new MachineProtocolError('incompatible_version', 'mismatch'),
      ),
    ).toEqual({
      status: 'error',
      type: 'machine_unavailable',
      message:
        'The Machine "devl" is unavailable because its daemon speaks an incompatible protocol version.',
    });
  });

  it('reports invalid parameters as invalid input', () => {
    expect(
      machineProtocolFailureResult(
        'devl',
        new MachineProtocolError('invalid_params', 'bad params'),
      ),
    ).toEqual({
      status: 'error',
      type: 'invalid_input',
      message: 'The Machine refused the request as invalid.',
    });
  });

  it('reports any other code as an unavailable Machine', () => {
    expect(
      machineProtocolFailureResult(
        'devl',
        new MachineProtocolError('internal', 'boom'),
      ),
    ).toEqual({
      status: 'error',
      type: 'machine_unavailable',
      message: 'The Machine "devl" is unavailable.',
    });
  });
});

describe('machineReadResult', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the answer of an effect-free exchange', async () => {
    const answer: ToolResult = { status: 'success', content: 'body' };
    await expect(
      machineReadResult('devl', () => Promise.resolve(answer)),
    ).resolves.toEqual(answer);
  });

  it('never calls an unanswered read an unknown outcome', async () => {
    await expect(
      machineReadResult('devl', () =>
        Promise.reject(
          new MachineUnavailableError('devl', 'unreachable', true, 'lost'),
        ),
      ),
    ).resolves.toEqual(machineUnavailableResult('devl', 'unreachable'));
  });

  it('reports an unreachable Machine that never saw the request', async () => {
    await expect(
      machineReadResult('devl', () =>
        Promise.reject(
          new MachineUnavailableError('devl', 'auth_failed', false, 'no auth'),
        ),
      ),
    ).resolves.toEqual(machineUnavailableResult('devl', 'auth_failed'));
  });

  it('maps a protocol refusal onto the settled vocabulary', async () => {
    await expect(
      machineReadResult('devl', () =>
        Promise.reject(
          new MachineProtocolError('path_not_registered', 'outside'),
        ),
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'path_not_registered',
      message: PATH_NOT_REGISTERED_MESSAGE,
    });
  });

  it('rethrows an error that is not a Machine failure', async () => {
    await expect(
      machineReadResult('devl', () =>
        Promise.reject(new Error('a bug in the caller')),
      ),
    ).rejects.toThrow('a bug in the caller');
  });
});

describe('readBytesChunk', () => {
  it('decodes the base64 payload of a bytes notification', () => {
    const chunk = readBytesChunk({
      seq: 1,
      data: Buffer.from('hello').toString('base64'),
    });
    expect(chunk?.toString('utf8')).toBe('hello');
  });

  it('rejects a payload that is not a record', () => {
    expect(readBytesChunk(undefined)).toBeUndefined();
    expect(readBytesChunk('data')).toBeUndefined();
    expect(readBytesChunk([1, 2])).toBeUndefined();
  });

  it('rejects a payload whose data is not a string', () => {
    expect(readBytesChunk({ seq: 1, data: 5 })).toBeUndefined();
    expect(readBytesChunk({ seq: 1 })).toBeUndefined();
  });
});

describe('readProcBashResult', () => {
  const MANAGED = {
    status: 'success',
    exitCode: 0,
    stdout: 'out',
    stderr: 'err',
    truncated: false,
  };

  it('rejects anything that is not a record with a known status', () => {
    expect(readProcBashResult('success')).toBeUndefined();
    expect(readProcBashResult(null)).toBeUndefined();
    expect(readProcBashResult({ status: 'weird' })).toBeUndefined();
    expect(readProcBashResult({})).toBeUndefined();
    // A managed shape whose status is outside the vocabulary is still not a
    // result: the guard runs before any field is trusted.
    expect(readProcBashResult({ ...MANAGED, status: 'weird' })).toBeUndefined();
  });

  it('rebuilds a managed success', () => {
    expect(readProcBashResult(MANAGED)).toEqual(MANAGED);
  });

  it('rebuilds a managed failure', () => {
    expect(
      readProcBashResult({ ...MANAGED, status: 'error', exitCode: 3 }),
    ).toEqual({ ...MANAGED, status: 'error', exitCode: 3 });
  });

  it("maps an old daemon's operation and executor away", () => {
    expect(
      readProcBashResult({
        ...MANAGED,
        operation: 'bash',
        executor: 'managed',
      }),
    ).toEqual(MANAGED);
    expect(
      readProcBashResult({
        ...MANAGED,
        operation: 'edit',
        executor: 'shell',
      }),
    ).toEqual(MANAGED);
  });

  it('keeps the wall time a daemon reports', () => {
    expect(readProcBashResult({ ...MANAGED, wallTimeMs: 1240 })).toEqual({
      ...MANAGED,
      wallTimeMs: 1240,
    });
  });

  it.each([
    ['a fractional exit code', { ...MANAGED, exitCode: 1.5 }],
    ['a string exit code', { ...MANAGED, exitCode: '0' }],
    ['a missing exit code', { ...MANAGED, exitCode: undefined }],
    ['a non-string stdout', { ...MANAGED, stdout: 5 }],
    ['a non-string stderr', { ...MANAGED, stderr: null }],
    ['a non-boolean truncation flag', { ...MANAGED, truncated: 'false' }],
    ['a fractional wall time', { ...MANAGED, wallTimeMs: 1.5 }],
    ['a negative wall time', { ...MANAGED, wallTimeMs: -1 }],
    ['a string wall time', { ...MANAGED, wallTimeMs: '10' }],
  ])('rejects a managed result with %s', (_label, value) => {
    expect(readProcBashResult(value)).toBeUndefined();
  });

  it('rebuilds the daemon deadline refusal', () => {
    expect(
      readProcBashResult({
        status: 'error',
        type: 'timed_out',
        durationMs: 100,
        stdout: 'partial',
        stderr: '',
        truncated: true,
      }),
    ).toEqual({
      status: 'error',
      type: 'timed_out',
      durationMs: 100,
      stdout: 'partial',
      stderr: '',
      truncated: true,
    });
  });

  it('keeps the wall time a daemon measured for a deadline refusal', () => {
    expect(
      readProcBashResult({
        status: 'error',
        type: 'timed_out',
        durationMs: 300_000,
        wallTimeMs: 29_940,
        stdout: 'partial',
        stderr: '',
        truncated: false,
      }),
    ).toEqual({
      status: 'error',
      type: 'timed_out',
      durationMs: 300_000,
      wallTimeMs: 29_940,
      stdout: 'partial',
      stderr: '',
      truncated: false,
    });
    // A daemon that predates the measured time sends none, and its result
    // still settles without one.
    expect(
      readProcBashResult({
        status: 'error',
        type: 'timed_out',
        durationMs: 300_000,
        wallTimeMs: -1,
        stdout: '',
        stderr: '',
        truncated: false,
      }),
    ).toBeUndefined();
  });

  it('accepts a zero duration and rejects a negative or fractional one', () => {
    const base = {
      status: 'error',
      type: 'timed_out',
      stdout: '',
      stderr: '',
      truncated: false,
    };
    expect(readProcBashResult({ ...base, durationMs: 0 })).toEqual({
      ...base,
      durationMs: 0,
    });
    expect(readProcBashResult({ ...base, durationMs: -1 })).toBeUndefined();
    expect(readProcBashResult({ ...base, durationMs: 1.5 })).toBeUndefined();
    expect(readProcBashResult({ ...base, durationMs: '10' })).toBeUndefined();
  });

  it('rejects a deadline refusal without its captured output', () => {
    expect(
      readProcBashResult({
        status: 'error',
        type: 'timed_out',
        durationMs: 10,
        stdout: 'partial',
      }),
    ).toBeUndefined();
  });

  it('rejects a deadline refusal without its truncation flag', () => {
    expect(
      readProcBashResult({
        status: 'error',
        type: 'timed_out',
        durationMs: 10,
        stdout: 'partial',
        stderr: '',
      }),
    ).toBeUndefined();
  });

  it('rebuilds an unattributable command outcome', () => {
    expect(
      readProcBashResult({
        status: 'error',
        type: 'outcome_unknown',
        attemptId: 'attempt-9',
        message: 'the link ended',
      }),
    ).toEqual({
      status: 'error',
      type: 'outcome_unknown',
      attemptId: 'attempt-9',
      message: 'the link ended',
    });
  });

  it('rejects an unattributable outcome without its identity', () => {
    expect(
      readProcBashResult({
        status: 'error',
        type: 'outcome_unknown',
        message: 'the link ended',
      }),
    ).toBeUndefined();
    expect(
      readProcBashResult({
        status: 'error',
        type: 'outcome_unknown',
        attemptId: 'attempt-9',
      }),
    ).toBeUndefined();
  });

  it.each(['unavailable', 'boundary_missing', 'cancelled'] as const)(
    'rebuilds the %s refusal',
    (type) => {
      expect(
        readProcBashResult({ status: 'error', type, message: `${type} now` }),
      ).toEqual({ status: 'error', type, message: `${type} now` });
    },
  );

  it('rejects a refusal type outside the closed set', () => {
    expect(
      readProcBashResult({
        status: 'error',
        type: 'exploded',
        message: 'nope',
      }),
    ).toBeUndefined();
  });

  it('rejects a refusal without a message', () => {
    expect(
      readProcBashResult({ status: 'error', type: 'cancelled' }),
    ).toBeUndefined();
  });

  it('refuses a typed result that claims success', () => {
    expect(
      readProcBashResult({ ...MANAGED, type: 'timed_out' }),
    ).toBeUndefined();
    for (const refusal of [
      { type: 'cancelled', message: 'stopped' },
      { type: 'outcome_unknown', attemptId: 'attempt-9', message: 'lost' },
      { type: 'unavailable', message: 'no shell' },
    ]) {
      expect(
        readProcBashResult({ status: 'success', ...refusal }),
      ).toBeUndefined();
    }
  });
});

describe('runMachineMutation', () => {
  afterEach(() => vi.restoreAllMocks());

  const TARGET = {
    name: 'devl',
    operation: 'edit' as const,
    locator: 'machine://devl/srv/app/a.ts',
  };

  it('refuses without a Machine surface', async () => {
    await expect(
      runMachineMutation(context(), TARGET, () =>
        Promise.resolve({ status: 'success' }),
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    });
  });

  it('refuses without a Run identity', async () => {
    const { connector } = connectorFor();
    await expect(
      runMachineMutation(
        context({ machines: connector, runId: undefined }),
        TARGET,
        (): Promise<ToolResult> => Promise.resolve({ status: 'success' }),
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    });
  });

  it('refuses a Machine the operator did not configure', async () => {
    const { connector, peer } = connectorFor();
    await expect(
      runMachineMutation(
        context({ machines: connector }),
        { ...TARGET, name: 'nope' },
        (): Promise<ToolResult> => Promise.resolve({ status: 'success' }),
      ),
    ).resolves.toEqual(machineNotFoundResult('nope'));
    expect(peer.sessions).toHaveLength(0);
  });

  it('records no attempt for a Machine that cannot be reached', async () => {
    const { begin } = stubFence();
    const { connector, peer } = connectorFor({
      openFailure: () => 'ssh: connect to host box port 22: Connection refused',
    });
    await expect(
      runMachineMutation(context({ machines: connector }), TARGET, () =>
        Promise.resolve({ status: 'success' }),
      ),
    ).resolves.toEqual(machineUnavailableResult('devl'));
    expect(begin).not.toHaveBeenCalled();
    expect(peer.sessions).toHaveLength(0);
  });

  it('fences the unbound attempt, runs the request, and records the result', async () => {
    const { begin, append } = stubFence();
    const { connector } = connectorFor();
    const settled: ToolResult = { status: 'success', path: TARGET.locator };
    const perform = vi.fn(() => Promise.resolve(settled));

    await expect(
      runMachineMutation(context({ machines: connector }), TARGET, perform),
    ).resolves.toEqual(settled);
    expect(begin).toHaveBeenCalledWith({
      runId: 'run',
      userId: 'owner',
      fence: { bound: false },
      deliverySequence: 1,
      toolCallId: 'call',
      operation: 'edit',
      path: TARGET.locator,
    });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith('run', 'native.result', {
      toolCallId: 'call',
      result: settled,
    });
  });

  it('replays a settled attempt instead of repeating the effect', async () => {
    const prior: ToolResult = {
      status: 'error',
      type: 'outcome_unknown',
      message: 'recorded',
    };
    vi.spyOn(NativeFilesRepository.prototype, 'begin').mockResolvedValue(prior);
    const append = vi.spyOn(RunEventsRepository.prototype, 'append');
    const { connector } = connectorFor();
    const perform = vi.fn((): Promise<ToolResult> =>
      Promise.resolve({ status: 'success' }),
    );

    await expect(
      runMachineMutation(context({ machines: connector }), TARGET, perform),
    ).resolves.toEqual(prior);
    expect(perform).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('settles a request that reached the link as an unknown outcome', async () => {
    const { append } = stubFence();
    const { connector } = connectorFor();
    const result = await runMachineMutation(
      context({ machines: connector }),
      TARGET,
      () =>
        Promise.reject(
          new MachineUnavailableError('devl', 'session_lost', true, 'lost'),
        ),
    );

    expect(result).toEqual(machineUnknownResult('devl'));
    expect(append).toHaveBeenCalledWith('run', 'native.result', {
      toolCallId: 'call',
      result,
    });
  });

  it('settles a request that never left as unavailable', async () => {
    stubFence();
    const { connector } = connectorFor();
    await expect(
      runMachineMutation(context({ machines: connector }), TARGET, () =>
        Promise.reject(
          new MachineUnavailableError('devl', 'auth_failed', false, 'no auth'),
        ),
      ),
    ).resolves.toEqual(machineUnavailableResult('devl', 'auth_failed'));
  });

  it('rethrows a failure that is not a Machine failure', async () => {
    stubFence();
    const { connector } = connectorFor();
    await expect(
      runMachineMutation(context({ machines: connector }), TARGET, () =>
        Promise.reject(new Error('a bug in the caller')),
      ),
    ).rejects.toThrow('a bug in the caller');
  });

  it('stops before the request when the call was aborted', async () => {
    stubFence();
    const { connector } = connectorFor();
    const controller = new AbortController();
    controller.abort();
    const perform = vi.fn((): Promise<ToolResult> =>
      Promise.resolve({ status: 'success' }),
    );

    await expect(
      runMachineMutation(
        context({ machines: connector, abortSignal: controller.signal }),
        TARGET,
        perform,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(perform).not.toHaveBeenCalled();
  });

  it('decides one attempt once across concurrent mutations', async () => {
    stubFence();
    const { connector, peer } = connectorFor();
    const call = () =>
      runMachineMutation(context({ machines: connector }), TARGET, () =>
        Promise.resolve({ status: 'success' }),
      );

    await Promise.all([call(), call()]);
    expect(peer.sessions).toHaveLength(1);
  });

  it('serializes mutations of one Machine', async () => {
    stubFence();
    const { connector } = connectorFor();
    const order: Array<string> = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runMachineMutation(
      context({ machines: connector }),
      TARGET,
      async () => {
        order.push('first:start');
        await firstGate;
        order.push('first:end');
        return { status: 'success' };
      },
    );
    const second = runMachineMutation(
      context({ machines: connector, toolCallId: 'call-2' }),
      TARGET,
      () => {
        order.push('second:start');
        return Promise.resolve({ status: 'success' });
      },
    );

    await vi.waitFor(() => expect(order).toContain('first:start'));
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
  });
});
