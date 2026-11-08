import {
  type GitFailure,
  type GitLocateResult,
  type GitStateResult,
  type GitStateSuccess,
} from '@workspace/machine-protocol';

import { ExecutorGitError } from '../machines/executor-git-error';
import { type ExecutorTarget } from '../machines/executor-git.service';
import {
  GIT_OBSERVATION_DEADLINE_MS,
  GitSnapshotService,
} from './git-snapshot.service';
import { renderGitObservation } from './git-state-render';

const LOCAL: ExecutorTarget = {
  executorId: 'hub',
  machine: undefined,
  path: '/work/app',
};
const MACHINE: ExecutorTarget = {
  executorId: 'machine:nas',
  machine: 'nas',
  path: '/srv/app',
};
const ROOT = '/work/app';
const ENTRY = '/work/app/.git';

const OK_LOCATE: GitLocateResult = {
  status: 'ok',
  gitEntry: ENTRY,
  kind: 'directory',
};

const OK_STATE: GitStateSuccess = {
  status: 'ok',
  toplevel: '/work/app',
  rootRelative: '',
  branch: 'main',
  detached: false,
  head: 'a'.repeat(40),
  upstream: null,
  operation: null,
  counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
  entries: [],
  omitted: 0,
  submodules: [],
  commits: [],
  remotes: [],
};

const failure = (type: Exclude<GitFailure['type'], 'invalid_input'>) =>
  ({ status: 'error', type, stderr: 'fatal: dubious ownership' }) as const;

type Calls = {
  locate: Array<{ address: string; signal: AbortSignal | undefined }>;
  state: Array<{
    address: string;
    input: {
      gitEntry: string;
      limit: number;
      submodules: string;
      timeoutMs?: number;
    };
    signal: AbortSignal | undefined;
  }>;
};

function harness(
  locate: () => Promise<GitLocateResult> = () => Promise.resolve(OK_LOCATE),
  state: () => Promise<GitStateResult> = () => Promise.resolve(OK_STATE),
) {
  const calls: Calls = { locate: [], state: [] };
  const service = new GitSnapshotService({
    locateEntry: (_target, address, options) => {
      calls.locate.push({ address, signal: options?.signal });
      return locate();
    },
    state: (_target, address, input, options) => {
      calls.state.push({ address, input, signal: options?.signal });
      return state();
    },
  });
  return { service, calls };
}

async function line(
  service: GitSnapshotService,
  overrides: Partial<Parameters<GitSnapshotService['observe']>[0]> = {},
): Promise<string> {
  const observation = await service.observe({
    target: LOCAL,
    root: ROOT,
    admit: () => true,
    ...overrides,
  });
  return renderGitObservation(observation);
}

describe('GitSnapshotService.observe', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for 20 paths, no submodules, and a 3 second git limit', async () => {
    const { service, calls } = harness();
    const observation = await service.observe({
      target: LOCAL,
      root: ROOT,
      admit: () => true,
    });

    expect(observation.kind).toBe('state');
    expect(calls.locate.map((call) => call.address)).toEqual([ROOT]);
    expect(calls.state).toMatchObject([
      {
        address: ROOT,
        input: {
          gitEntry: ENTRY,
          limit: 20,
          submodules: 'skip',
          timeoutMs: 3000,
        },
      },
    ]);
  });

  it('hands the admission callback the located git entry', async () => {
    const admit = vi.fn(() => true);
    const { service } = harness();
    await service.observe({ target: LOCAL, root: ROOT, admit });

    expect(admit).toHaveBeenCalledExactlyOnceWith(ENTRY);
  });

  it('reports a plain folder as not a repository and starts no state call', async () => {
    const { service, calls } = harness(() =>
      Promise.resolve(failure('not_a_repository')),
    );

    expect(await line(service)).toBe('not a git repository');
    expect(calls.state).toHaveLength(0);
  });

  it.each([
    ['no_repository_in_root', 'no repository inside the registered root'],
    ['root_missing', 'Workspace root not found'],
    ['timed_out', 'timeout'],
    ['outside_registered_root', 'repository outside the registered root'],
    ['git_failed', 'git failed'],
    ['git_entry_changed', 'git failed'],
  ] as const)('maps the locate failure %s', async (type, label) => {
    const { service, calls } = harness(() => Promise.resolve(failure(type)));

    expect(await line(service)).toBe(`git state unavailable: ${label}`);
    expect(calls.state).toHaveLength(0);
  });

  it('refuses without a state call when admission fails', async () => {
    const { service, calls } = harness();

    expect(await line(service, { admit: () => false })).toBe(
      'git state unavailable: not permitted',
    );
    expect(calls.state).toHaveLength(0);
  });

  it.each([
    ['timed_out', 'timeout'],
    ['output_bound', 'too many changes'],
    ['outside_registered_root', 'repository outside the registered root'],
    ['git_entry_changed', 'git failed'],
    ['not_a_repository', 'git failed'],
    ['git_failed', 'git failed'],
    ['invalid_input', 'git failed'],
  ] as const)('maps the state failure %s', async (type, label) => {
    const { service } = harness(undefined, () =>
      Promise.resolve(
        type === 'invalid_input'
          ? { status: 'error', type: 'invalid_input', message: 'x' }
          : failure(type),
      ),
    );

    expect(await line(service)).toBe(`git state unavailable: ${label}`);
  });

  it('never surfaces the stderr of a failure', async () => {
    const { service } = harness(undefined, () =>
      Promise.resolve(failure('git_failed')),
    );

    expect(await line(service)).not.toContain('dubious');
  });

  it.each([
    [
      new ExecutorGitError('machine_unavailable', 'Machine nas is offline.'),
      'Machine unavailable',
    ],
    [
      new ExecutorGitError('machine_update_required', 'update nas'),
      'Machine daemon update required',
    ],
    [
      new ExecutorGitError('path_not_registered', 'secret detail'),
      'git failed',
    ],
    [new ExecutorGitError('executor_unavailable', 'no executor'), 'git failed'],
    [new Error('boom'), 'git failed'],
  ])('maps a thrown error %#', async (error, label) => {
    const { service } = harness(() => Promise.reject(error));
    const text = await line(service, { target: MACHINE });

    expect(text).toBe(`git state unavailable: ${label}`);
  });

  it('maps an error thrown by the state call', async () => {
    const { service } = harness(undefined, () =>
      Promise.reject(new ExecutorGitError('machine_unavailable', 'gone')),
    );

    expect(await line(service, { target: MACHINE })).toBe(
      'git state unavailable: Machine unavailable',
    );
  });

  it('sends no request to a Machine that is known offline', async () => {
    const { service, calls } = harness();

    expect(
      await line(service, {
        target: MACHINE,
        reachable: () => Promise.resolve(false),
      }),
    ).toBe('git state unavailable: Machine unavailable');
    expect(calls.locate).toHaveLength(0);
    expect(calls.state).toHaveLength(0);
  });

  it('proceeds when a Machine is reachable, and ignores reachability locally', async () => {
    const reachable = vi.fn(() => Promise.resolve(false));
    const machine = harness();
    const local = harness();

    expect(
      (
        await machine.service.observe({
          target: MACHINE,
          root: ROOT,
          admit: () => true,
          reachable: () => Promise.resolve(true),
        })
      ).kind,
    ).toBe('state');
    expect(
      (
        await local.service.observe({
          target: LOCAL,
          root: ROOT,
          admit: () => true,
          reachable,
        })
      ).kind,
    ).toBe('state');
    expect(reachable).not.toHaveBeenCalled();
  });

  it('times out a slow session after 5 seconds and aborts the executor calls', async () => {
    vi.useFakeTimers();
    const { service, calls } = harness(
      () => new Promise<GitLocateResult>(() => undefined),
    );
    const pending = service.observe({
      target: MACHINE,
      root: ROOT,
      admit: () => true,
    });

    await vi.advanceTimersByTimeAsync(GIT_OBSERVATION_DEADLINE_MS - 1);
    expect(calls.locate[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toEqual({ kind: 'unavailable', reason: 'timeout' });
    expect(calls.locate[0]?.signal?.aborted).toBe(true);
    expect(calls.state).toHaveLength(0);
  });

  it('covers the state call with the same deadline and signal', async () => {
    vi.useFakeTimers();
    const { service, calls } = harness(
      undefined,
      () => new Promise<GitStateResult>(() => undefined),
    );
    const pending = service.observe({
      target: LOCAL,
      root: ROOT,
      admit: () => true,
    });
    await vi.advanceTimersByTimeAsync(GIT_OBSERVATION_DEADLINE_MS);

    expect(await pending).toEqual({ kind: 'unavailable', reason: 'timeout' });
    expect(calls.state[0]?.signal?.aborted).toBe(true);
  });

  it('clears its timer when the observation ends first', async () => {
    vi.useFakeTimers();
    const { service } = harness();
    await service.observe({ target: LOCAL, root: ROOT, admit: () => true });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a caller abort to the executor calls', async () => {
    const caller = new AbortController();
    const { service, calls } = harness();
    await service.observe({
      target: LOCAL,
      root: ROOT,
      admit: () => true,
      signal: caller.signal,
    });
    caller.abort();

    expect(calls.locate[0]?.signal?.aborted).toBe(true);
  });

  it('keeps raw remote URLs out of the view', async () => {
    const { service } = harness(undefined, () =>
      Promise.resolve({
        ...OK_STATE,
        remotes: [
          { name: 'origin', url: 'https://ghp_secret@github.com/a/b.git' },
        ],
      }),
    );
    const observation = await service.observe({
      target: LOCAL,
      root: ROOT,
      admit: () => true,
    });

    expect(JSON.stringify(observation)).not.toContain('ghp_secret');
  });
});
