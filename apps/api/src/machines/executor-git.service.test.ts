import { type GitInspectSuccess } from '@workspace/git-executor';

import { type InstanceConfigService } from '../instance-config/instance-config.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { createProtocolPeer } from '../testing/machine-protocol-peer';
import {
  ExecutorGit,
  ExecutorGitError,
  localGitSurface,
  MACHINE_GIT_BUDGET_MS,
} from './executor-git.service';
import { MachineConnector } from './machine-connector.service';

/**
 * The executor dispatch: which executor a submitted path runs on, and how a
 * Machine call carries it. The git operations themselves are pinned by
 * `@workspace/git-executor`'s own suite and by the daemon's; this suite covers
 * the derivation, the locator form, and the failure mapping.
 */
const NAS = 'nas';
const LOCAL_EXECUTOR = 'hub-host';
const MACHINE_PATH = '/srv/app';

function configWith(tools: Partial<LlameConfig['tools']>) {
  return {
    config: {
      ...BUILT_IN_DEFAULTS,
      tools: { ...BUILT_IN_DEFAULTS.tools, ...tools },
    },
  } satisfies Pick<InstanceConfigService, 'config'>;
}

function connectors() {
  const options = {
    hubVersion: 'test-hub',
    machines: {
      ssh: { knownHostsFile: '/dev/null' },
      hosts: { [NAS]: { destination: 'nas.example' } },
    },
    idleCloseMs: 1000,
  };
  const configured = new MachineConnector({
    ...options,
    transportFactory: createProtocolPeer({ roots: ['/srv'] }).factory,
  });
  const unconfigured = new MachineConnector({
    ...options,
    machines: undefined,
  });
  return { configured, unconfigured };
}

const IMPORTED: GitInspectSuccess = {
  status: 'ok',
  toplevel: '/srv/app',
  commonDir: '/srv/app/.git',
  linked: false,
  mainWorktree: null,
  remotes: [{ name: 'origin', url: 'github.com/leon0399/llame' }],
  branch: 'main',
  head: 'a'.repeat(40),
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** The typed rejection of one dispatch, for its code and message. */
async function rejectionOf(
  promise: Promise<unknown>,
): Promise<ExecutorGitError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ExecutorGitError) return error;
    throw error;
  }
  throw new Error('The call resolved instead of failing.');
}

describe('ExecutorGit.locate', () => {
  it('runs an absolute local path on the serving process executor', () => {
    const { configured } = connectors();
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      configured,
      localGitSurface(),
    );

    expect(executors.locate('/srv/app')).toEqual({
      executorId: LOCAL_EXECUTOR,
      machine: undefined,
      path: '/srv/app',
    });
    configured.onModuleDestroy();
  });

  it('refuses a local path on a process without a native executor', () => {
    const { configured } = connectors();
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: undefined }),
      configured,
      localGitSurface(),
    );

    expect(() => executors.locate('/srv/app')).toThrow(
      expect.objectContaining({ code: 'executor_unavailable' }),
    );
    configured.onModuleDestroy();
  });

  it.each([
    ['srv/app'],
    ['/srv/app\0'],
    [''],
    ['machine://nas'],
    ['machine://Not A Name/srv/app'],
  ])('refuses %j as an invalid path', (path) => {
    const { configured } = connectors();
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      configured,
      localGitSurface(),
    );

    expect(() => executors.locate(path)).toThrow(
      expect.objectContaining({ code: 'invalid_path' }),
    );
    configured.onModuleDestroy();
  });

  it('refuses a locator that carries a read selector', () => {
    const { configured } = connectors();
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      configured,
      localGitSurface(),
    );

    expect(() => executors.locate('machine://nas/srv/app:12-14')).toThrow(
      expect.objectContaining({ code: 'invalid_path' }),
    );
    configured.onModuleDestroy();
  });

  it('refuses a locator that names no configured Machine', () => {
    const { unconfigured } = connectors();
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      unconfigured,
      localGitSurface(),
    );

    expect(() => executors.locate('machine://nas/srv/app')).toThrow(
      expect.objectContaining({ code: 'executor_unavailable' }),
    );
    unconfigured.onModuleDestroy();
  });

  it('derives the Machine executor and its own path from a locator', () => {
    const { configured } = connectors();
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      configured,
      localGitSurface(),
    );

    expect(executors.locate('machine://nas/srv/app')).toEqual({
      executorId: `machine:${NAS}`,
      machine: NAS,
      path: MACHINE_PATH,
    });
    configured.onModuleDestroy();
  });
});

describe('ExecutorGit.address', () => {
  it('keeps a local path and states a Machine path as its locator', () => {
    const { configured } = connectors();
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      configured,
      localGitSurface(),
    );

    const local = executors.locate('/srv/app');
    expect(executors.address(local, '/srv/app')).toBe('/srv/app');
    const machine = executors.locate(`${'machine://'}${NAS}${MACHINE_PATH}`);
    expect(executors.address(machine, MACHINE_PATH)).toBe(
      `machine://${NAS}${MACHINE_PATH}`,
    );
    configured.onModuleDestroy();
  });
});

describe('ExecutorGit.inspect', () => {
  it('inspects a local path in process', async () => {
    const { configured } = connectors();
    const inspect = vi.fn(() => Promise.resolve(IMPORTED));
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      configured,
      { ...localGitSurface(), inspect },
    );
    const target = executors.locate('/srv/app');

    await expect(executors.inspect(target, '/srv/app')).resolves.toEqual(
      IMPORTED,
    );
    expect(inspect).toHaveBeenCalledWith({ path: '/srv/app' });
    configured.onModuleDestroy();
  });

  it('answers the daemon locators for a Machine path', async () => {
    const peer = createProtocolPeer({
      roots: ['/srv'],
      methods: ['git.inspect', 'git.worktreeAdd'],
      answers: {
        'git.inspect': {
          value: {
            ...IMPORTED,
            toplevel: `machine://${NAS}${MACHINE_PATH}`,
            commonDir: `machine://${NAS}${MACHINE_PATH}/.git`,
          },
        },
      },
    });
    const connector = new MachineConnector({
      hubVersion: 'test-hub',
      machines: {
        ssh: { knownHostsFile: '/dev/null' },
        hosts: { [NAS]: { destination: 'nas.example' } },
      },
      transportFactory: peer.factory,
      idleCloseMs: 1000,
    });
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      connector,
      localGitSurface(),
    );
    const target = executors.locate(`machine://${NAS}${MACHINE_PATH}`);

    await expect(
      executors.inspect(target, `machine://${NAS}${MACHINE_PATH}`),
    ).resolves.toMatchObject({
      status: 'ok',
      toplevel: `machine://${NAS}${MACHINE_PATH}`,
    });
    const machine = await peer.session(0);
    expect(
      machine.calls.find((call) => call.method === 'git.inspect')?.params,
    ).toMatchObject({
      path: MACHINE_PATH,
      envelope: { budgetMs: MACHINE_GIT_BUDGET_MS },
      options: { displayPrefix: `machine://${NAS}` },
    });
    connector.onModuleDestroy();
  });

  it('fails as machine_update_required on a daemon without the method', async () => {
    const peer = createProtocolPeer({ roots: ['/srv'] });
    const connector = new MachineConnector({
      hubVersion: 'test-hub',
      machines: {
        ssh: { knownHostsFile: '/dev/null' },
        hosts: { [NAS]: { destination: 'nas.example' } },
      },
      transportFactory: peer.factory,
      idleCloseMs: 1000,
    });
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      connector,
      localGitSurface(),
    );
    const target = executors.locate(`machine://${NAS}${MACHINE_PATH}`);

    const error = await rejectionOf(
      executors.inspect(target, `machine://${NAS}${MACHINE_PATH}`),
    );

    expect(error.code).toBe('machine_update_required');
    expect(error.message).toContain('Update the daemon on that Machine');
    connector.onModuleDestroy();
  });

  it('fails as machine_unavailable when the session cannot open', async () => {
    const peer = createProtocolPeer({
      openFailure: () =>
        'ssh: connect to host nas.example port 22: No route to host',
    });
    const connector = new MachineConnector({
      hubVersion: 'test-hub',
      machines: {
        ssh: { knownHostsFile: '/dev/null' },
        hosts: { [NAS]: { destination: 'nas.example' } },
      },
      transportFactory: peer.factory,
      idleCloseMs: 1000,
    });
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      connector,
      localGitSurface(),
    );
    const target = executors.locate(`machine://${NAS}${MACHINE_PATH}`);

    await expect(
      executors.inspect(target, `machine://${NAS}${MACHINE_PATH}`),
    ).rejects.toThrow(expect.objectContaining({ code: 'machine_unavailable' }));
    connector.onModuleDestroy();
  });

  it('maps a daemon root refusal to permission_denied and another refusal to git_failed', async () => {
    const peer = createProtocolPeer({
      roots: ['/srv'],
      methods: ['git.inspect'],
      answers: { 'git.inspect': { error: 'path_not_registered' } },
    });
    const connector = new MachineConnector({
      hubVersion: 'test-hub',
      machines: {
        ssh: { knownHostsFile: '/dev/null' },
        hosts: { [NAS]: { destination: 'nas.example' } },
      },
      transportFactory: peer.factory,
      idleCloseMs: 1000,
    });
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      connector,
      localGitSurface(),
    );
    const target = executors.locate(`machine://${NAS}${MACHINE_PATH}`);

    await expect(
      executors.inspect(target, `machine://${NAS}${MACHINE_PATH}`),
    ).rejects.toBeInstanceOf(ExecutorGitError);
    await expect(
      executors.inspect(target, `machine://${NAS}${MACHINE_PATH}`),
    ).rejects.toThrow(expect.objectContaining({ code: 'permission_denied' }));

    const invalid = createProtocolPeer({
      roots: ['/srv'],
      methods: ['git.inspect'],
      answers: { 'git.inspect': { error: 'invalid_params' } },
    });
    const otherConnector = new MachineConnector({
      hubVersion: 'test-hub',
      machines: {
        ssh: { knownHostsFile: '/dev/null' },
        hosts: { [NAS]: { destination: 'nas.example' } },
      },
      transportFactory: invalid.factory,
      idleCloseMs: 1000,
    });
    const otherExecutors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      otherConnector,
      localGitSurface(),
    );

    await expect(
      otherExecutors.inspect(target, `machine://${NAS}${MACHINE_PATH}`),
    ).rejects.toThrow(expect.objectContaining({ code: 'git_failed' }));
    connector.onModuleDestroy();
    otherConnector.onModuleDestroy();
  });

  it('fails as git_failed on an answer it cannot read', async () => {
    const peer = createProtocolPeer({
      roots: ['/srv'],
      methods: ['git.inspect'],
      answers: { 'git.inspect': { value: { status: 'ok' } } },
    });
    const connector = new MachineConnector({
      hubVersion: 'test-hub',
      machines: {
        ssh: { knownHostsFile: '/dev/null' },
        hosts: { [NAS]: { destination: 'nas.example' } },
      },
      transportFactory: peer.factory,
      idleCloseMs: 1000,
    });
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      connector,
      localGitSurface(),
    );
    const target = executors.locate(`machine://${NAS}${MACHINE_PATH}`);

    const error = await rejectionOf(
      executors.inspect(target, `machine://${NAS}${MACHINE_PATH}`),
    );

    expect(error.code).toBe('git_failed');
    expect(error.message).toContain('unusable');
    connector.onModuleDestroy();
  });
});

describe('ExecutorGit.worktreeAdd', () => {
  it('sends the executor paths of both the source and the directory', async () => {
    const peer = createProtocolPeer({
      roots: ['/srv'],
      methods: ['git.worktreeAdd'],
      answers: {
        'git.worktreeAdd': {
          value: {
            status: 'ok',
            path: `machine://${NAS}/srv/trees/shop`,
            branch: 'llame/shop',
            head: 'b'.repeat(40),
          },
        },
      },
    });
    const connector = new MachineConnector({
      hubVersion: 'test-hub',
      machines: {
        ssh: { knownHostsFile: '/dev/null' },
        hosts: { [NAS]: { destination: 'nas.example' } },
      },
      transportFactory: peer.factory,
      idleCloseMs: 1000,
    });
    const executors = new ExecutorGit(
      configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
      connector,
      localGitSurface(),
    );
    const target = executors.locate(`machine://${NAS}${MACHINE_PATH}`);

    await expect(
      executors.worktreeAdd(target, {
        source: `machine://${NAS}${MACHINE_PATH}`,
        branch: 'llame/shop',
        baseRef: 'HEAD',
        directory: `machine://${NAS}/srv/trees/shop`,
      }),
    ).resolves.toMatchObject({ status: 'ok', branch: 'llame/shop' });
    const machine = await peer.session(0);
    expect(
      machine.calls.find((call) => call.method === 'git.worktreeAdd')?.params,
    ).toMatchObject({
      source: MACHINE_PATH,
      branch: 'llame/shop',
      baseRef: 'HEAD',
      directory: '/srv/trees/shop',
      options: { displayPrefix: `machine://${NAS}` },
    });
    connector.onModuleDestroy();
  });
});
