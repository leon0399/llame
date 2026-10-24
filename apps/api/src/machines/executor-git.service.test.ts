import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type GitInspectSuccess } from '@workspace/git-executor';

import { type InstanceConfigService } from '../instance-config/instance-config.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import {
  createProtocolPeer,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';
import { isRecord, isString } from '@workspace/runtime-safety';

import { ExecutorGitError } from './executor-git-error';
import {
  ExecutorGit,
  localGitSurface,
  MACHINE_GIT_BUDGET_MS,
  type LocalGit,
} from './executor-git.service';
import { MachineConnector } from './machine-connector.service';

/**
 * The executor dispatch: which executor a submitted path runs on, how a Machine
 * call carries it, and how a Machine failure maps. The git operations
 * themselves are pinned by `@workspace/git-executor`'s own suite and by the
 * daemon's; this suite covers the derivation, the locator form, the canonical
 * address, and the failure mapping.
 */
const NAS = 'nas';
const LOCAL_EXECUTOR = 'hub-host';
const MACHINE_PATH = '/srv/app';
const LOCATOR = `machine://${NAS}${MACHINE_PATH}`;

const MACHINE_ENDPOINTS = {
  ssh: { knownHostsFile: '/dev/null' },
  hosts: { [NAS]: { destination: 'nas.example' } },
};

function configWith(
  tools: Partial<LlameConfig['tools']>,
): Pick<InstanceConfigService, 'config'> {
  return {
    config: {
      ...BUILT_IN_DEFAULTS,
      tools: { ...BUILT_IN_DEFAULTS.tools, ...tools },
    },
  };
}

const opened: Array<MachineConnector> = [];

/** One ExecutorGit over a connector whose peer answers `options`. */
function hub(
  options: ProtocolPeerOptions = {},
  local: LocalGit = localGitSurface(),
  tools: Partial<LlameConfig['tools']> = { nativeExecutorId: LOCAL_EXECUTOR },
) {
  const peer = createProtocolPeer({ roots: ['/srv'], ...options });
  const connector = new MachineConnector({
    hubVersion: 'test-hub',
    machines: MACHINE_ENDPOINTS,
    transportFactory: peer.factory,
    idleCloseMs: 1000,
  });
  opened.push(connector);
  return {
    executors: new ExecutorGit(configWith(tools), connector, local),
    peer,
  };
}

/** An ExecutorGit whose connector has no configured Machine at all. */
function unconfiguredHub(): ExecutorGit {
  const connector = new MachineConnector({
    hubVersion: 'test-hub',
    machines: undefined,
    transportFactory: createProtocolPeer().factory,
    idleCloseMs: 1000,
  });
  opened.push(connector);
  return new ExecutorGit(
    configWith({ nativeExecutorId: LOCAL_EXECUTOR }),
    connector,
    localGitSurface(),
  );
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

const created: Array<string> = [];

afterEach(() => {
  for (const connector of opened.splice(0)) connector.onModuleDestroy();
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
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

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'executor-git-'));
  created.push(directory);
  return directory;
}

describe('ExecutorGit.locate', () => {
  it('runs an absolute local path on the serving process executor', () => {
    const { executors } = hub();

    expect(executors.locate('/srv/app')).toEqual({
      executorId: LOCAL_EXECUTOR,
      machine: undefined,
      path: '/srv/app',
    });
  });

  it('refuses a local path on a process without a native executor', () => {
    const { executors } = hub({}, localGitSurface(), {
      nativeExecutorId: undefined,
    });

    expect(() => executors.locate('/srv/app')).toThrow(
      expect.objectContaining({ code: 'executor_unavailable' }),
    );
  });

  it.each([
    ['srv/app'],
    ['/srv/app\0'],
    [''],
    ['machine://nas'],
    ['machine://Not A Name/srv/app'],
    ['machine://nas/srv/app:12-14'],
  ])('refuses %j as an invalid path', (path) => {
    const { executors } = hub();

    expect(() => executors.locate(path)).toThrow(
      expect.objectContaining({ code: 'invalid_path' }),
    );
  });

  it('refuses a locator that names no configured Machine', () => {
    const executors = unconfiguredHub();

    expect(() => executors.locate(LOCATOR)).toThrow(
      expect.objectContaining({ code: 'executor_unavailable' }),
    );
  });

  it('derives the Machine executor and its own path from a locator', () => {
    const { executors } = hub();

    expect(executors.locate(LOCATOR)).toEqual({
      executorId: `machine:${NAS}`,
      machine: NAS,
      path: MACHINE_PATH,
    });
  });
});

describe('ExecutorGit.address', () => {
  it('keeps a local path and states a Machine path as its locator', () => {
    const { executors } = hub();

    const local = executors.locate('/srv/app');
    expect(executors.address(local, '/srv/app')).toBe('/srv/app');
    const machine = executors.locate(LOCATOR);
    expect(executors.address(machine, MACHINE_PATH)).toBe(LOCATOR);
  });
});

describe('ExecutorGit.canonical', () => {
  it('resolves a local symbolic link and refuses a missing path', async () => {
    const { executors } = hub();
    const directory = tempDirectory();
    const real = join(directory, 'real');
    mkdirSync(real);
    symlinkSync(real, join(directory, 'link'));
    const target = executors.locate('/srv/app');

    await expect(
      executors.canonical(target, join(directory, 'link')),
    ).resolves.toBe(real);
    await expect(
      executors.canonical(target, join(directory, 'missing')),
    ).rejects.toMatchObject({ code: 'invalid_path' });
  });

  it('refuses a local path that is not a directory', async () => {
    const { executors } = hub();
    const file = join(tempDirectory(), 'file.txt');
    writeFileSync(file, 'x\n');

    await expect(
      executors.canonical(executors.locate('/srv/app'), file),
    ).rejects.toMatchObject({ code: 'not_a_directory' });
  });

  it('asks the daemon for the real path and renders the canonical locator', async () => {
    const { executors, peer } = hub({
      methods: ['git.inspect'],
      answers: {
        'fs.stat': {
          value: {
            kind: 'directory',
            isLink: false,
            realPath: '/srv/a#b/100%',
          },
        },
      },
    });

    await expect(
      executors.canonical(executors.locate(LOCATOR), LOCATOR),
    ).resolves.toBe('machine://nas/srv/a%23b/100%25');
    const machine = await peer.session(0);
    expect(
      machine.calls.find((call) => call.method === 'fs.stat')?.params,
    ).toMatchObject({ path: MACHINE_PATH });
  });

  it('maps a daemon refusal and a missing directory to typed codes', async () => {
    const { executors } = hub({
      methods: ['git.inspect'],
      answer: (call) =>
        call.method === 'fs.stat'
          ? { value: { kind: 'missing', isLink: false } }
          : undefined,
    });

    await expect(
      executors.canonical(executors.locate(LOCATOR), LOCATOR),
    ).rejects.toMatchObject({ code: 'invalid_path' });

    const refused = hub({
      methods: ['git.inspect'],
      answers: { 'fs.stat': { error: 'path_not_registered' } },
    });
    await expect(
      refused.executors.canonical(refused.executors.locate(LOCATOR), LOCATOR),
    ).rejects.toMatchObject({ code: 'path_not_registered' });
  });

  it('refuses an answer that is not a directory or carries no real path', async () => {
    const { executors } = hub({
      methods: ['git.inspect'],
      answers: {
        'fs.stat': { value: { kind: 'file', isLink: false, size: 12 } },
      },
    });
    await expect(
      executors.canonical(executors.locate(LOCATOR), LOCATOR),
    ).rejects.toMatchObject({ code: 'not_a_directory' });

    const unusable = hub({
      methods: ['git.inspect'],
      answers: { 'fs.stat': { value: { kind: 'directory', isLink: false } } },
    });
    await expect(
      unusable.executors.canonical(unusable.executors.locate(LOCATOR), LOCATOR),
    ).rejects.toMatchObject({ code: 'git_failed' });
  });
});

describe('ExecutorGit.canonicalTarget', () => {
  it('resolves the deepest existing ancestor of a future local directory', async () => {
    const { executors } = hub();
    const directory = tempDirectory();
    const real = join(directory, 'real');
    mkdirSync(real);
    symlinkSync(real, join(directory, 'worktrees'));
    const target = executors.locate('/srv/app');

    await expect(
      executors.canonicalTarget(target, join(directory, 'worktrees', 'a', 'b')),
    ).resolves.toBe(join(real, 'a', 'b'));
  });

  it('keeps a future local directory whose parent is missing', async () => {
    const { executors } = hub();
    const directory = tempDirectory();

    await expect(
      executors.canonicalTarget(
        executors.locate('/srv/app'),
        join(directory, 'missing', 'a'),
      ),
    ).resolves.toBe(join(directory, 'missing', 'a'));
  });

  it('refuses a relative, empty, or escaping path before touching the disk', async () => {
    const { executors } = hub();
    const target = executors.locate('/srv/app');

    for (const value of ['relative/path', '/srv/app/../etc', '/srv/./app']) {
      await expect(
        executors.canonicalTarget(target, value),
      ).rejects.toMatchObject({ code: 'invalid_path' });
    }
  });

  it('walks a Machine path through the daemon and renders one locator', async () => {
    const asked: Array<string> = [];
    const { executors } = hub({
      methods: ['git.inspect'],
      answer: (call) => {
        if (call.method !== 'fs.stat') return undefined;
        const path = isRecord(call.params) ? call.params['path'] : undefined;
        if (!isString(path)) return undefined;
        asked.push(path);
        return path === '/srv'
          ? { value: { kind: 'directory', isLink: false, realPath: '/srv' } }
          : { value: { kind: 'missing', isLink: false } };
      },
    });

    await expect(
      executors.canonicalTarget(
        executors.locate(LOCATOR),
        `${LOCATOR}/worktrees/a`,
      ),
    ).resolves.toBe(`${LOCATOR}/worktrees/a`);
    expect(asked).toStrictEqual([
      '/srv/app/worktrees/a',
      '/srv/app/worktrees',
      '/srv/app',
      '/srv',
    ]);
  });

  it('refuses a Machine ancestor that is not a directory', async () => {
    const { executors } = hub({
      methods: ['git.inspect'],
      answer: (call) =>
        call.method === 'fs.stat'
          ? { value: { kind: 'file', isLink: false, size: 4 } }
          : undefined,
    });

    await expect(
      executors.canonicalTarget(
        executors.locate(LOCATOR),
        `${LOCATOR}/worktrees/a`,
      ),
    ).rejects.toMatchObject({ code: 'invalid_path' });
  });

  it('answers a daemon refusal of an ancestor with its own code', async () => {
    const { executors } = hub({
      methods: ['git.inspect'],
      answers: { 'fs.stat': { error: 'path_not_registered' } },
    });

    await expect(
      executors.canonicalTarget(
        executors.locate(LOCATOR),
        `${LOCATOR}/elsewhere/a`,
      ),
    ).rejects.toMatchObject({ code: 'path_not_registered' });
  });
});

describe('ExecutorGit.exists', () => {
  it('answers a local path that exists and one that does not', async () => {
    const { executors } = hub();
    const directory = tempDirectory();
    const target = executors.locate('/srv/app');

    await expect(executors.exists(target, directory)).resolves.toBe(true);
    await expect(
      executors.exists(target, join(directory, 'missing')),
    ).resolves.toBe(false);
  });

  it('answers a Machine path from the daemon', async () => {
    const { executors } = hub({
      methods: ['git.inspect'],
      answer: (call) =>
        call.method === 'fs.stat'
          ? {
              value:
                call.params?.['path'] === MACHINE_PATH
                  ? { kind: 'directory', isLink: false, realPath: MACHINE_PATH }
                  : { kind: 'missing', isLink: false },
            }
          : undefined,
    });
    const target = executors.locate(LOCATOR);

    await expect(executors.exists(target, LOCATOR)).resolves.toBe(true);
    await expect(executors.exists(target, `${LOCATOR}/missing`)).resolves.toBe(
      false,
    );
  });
});

describe('ExecutorGit.inspect', () => {
  it('inspects a local path in process', async () => {
    const inspect = vi.fn(() => Promise.resolve(IMPORTED));
    const { executors } = hub({}, { ...localGitSurface(), inspect });
    const target = executors.locate('/srv/app');

    await expect(executors.inspect(target, '/srv/app')).resolves.toEqual(
      IMPORTED,
    );
    expect(inspect).toHaveBeenCalledWith({ path: '/srv/app' });
  });

  it('answers the daemon locators for a Machine path', async () => {
    const { executors, peer } = hub({
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
    const target = executors.locate(LOCATOR);

    await expect(executors.inspect(target, LOCATOR)).resolves.toMatchObject({
      status: 'ok',
      toplevel: LOCATOR,
    });
    const machine = await peer.session(0);
    expect(
      machine.calls.find((call) => call.method === 'git.inspect')?.params,
    ).toMatchObject({
      path: MACHINE_PATH,
      envelope: { budgetMs: MACHINE_GIT_BUDGET_MS },
      options: { displayPrefix: `machine://${NAS}` },
    });
  });

  it('fails as machine_update_required on a daemon without the method', async () => {
    const { executors } = hub();
    const target = executors.locate(LOCATOR);

    const error = await rejectionOf(executors.inspect(target, LOCATOR));

    expect(error.code).toBe('machine_update_required');
    expect(error.message).toContain('Update the daemon on that Machine');
  });

  it('fails as machine_unavailable without quoting the transport', async () => {
    const { executors } = hub({
      openFailure: () =>
        'ssh: connect to host nas.example port 22: No route to host',
    });
    const target = executors.locate(LOCATOR);

    const error = await rejectionOf(executors.inspect(target, LOCATOR));

    // Registration answers this error's message as the HTTP response body, so
    // the ssh diagnostic stays in the hub's own logs.
    expect(error.code).toBe('machine_unavailable');
    expect(error.message).toBe(
      `The Machine ${NAS} is unavailable (unreachable).`,
    );
    expect(error.message).not.toContain('ssh:');
  });

  it('keeps the daemon root refusal, and maps another refusal to git_failed', async () => {
    const refused = hub({
      methods: ['git.inspect'],
      answers: { 'git.inspect': { error: 'path_not_registered' } },
    });
    const target = refused.executors.locate(LOCATOR);

    await expect(refused.executors.inspect(target, LOCATOR)).rejects.toThrow(
      expect.objectContaining({ code: 'path_not_registered' }),
    );

    const invalid = hub({
      methods: ['git.inspect'],
      answers: { 'git.inspect': { error: 'invalid_params' } },
    });
    await expect(
      invalid.executors.inspect(invalid.executors.locate(LOCATOR), LOCATOR),
    ).rejects.toThrow(expect.objectContaining({ code: 'git_failed' }));
  });

  it('fails as git_failed on an answer it cannot read', async () => {
    const { executors } = hub({
      methods: ['git.inspect'],
      answers: { 'git.inspect': { value: { status: 'ok' } } },
    });
    const target = executors.locate(LOCATOR);

    const error = await rejectionOf(executors.inspect(target, LOCATOR));

    expect(error.code).toBe('git_failed');
    expect(error.message).toContain('unusable');
  });
});

describe('ExecutorGit.worktreeAdd', () => {
  it('sends the executor paths of both the source and the directory', async () => {
    const { executors, peer } = hub({
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
    const target = executors.locate(LOCATOR);

    await expect(
      executors.worktreeAdd(target, {
        source: LOCATOR,
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
  });
});

describe('ExecutorGit refusals', () => {
  it('states why a path cannot be addressed', async () => {
    const { executors } = hub();
    const machine = executors.locate(LOCATOR);

    expect(() => executors.locate('/srv/app\0')).toThrow(
      'A checkout path must not contain a NUL byte.',
    );
    expect(() => executors.locate('srv/app')).toThrow(
      'A checkout path must be absolute.',
    );
    expect(() => executors.locate('machine://Not A Name/srv/app')).toThrow(
      'A machine:// locator must name a Machine as [a-z0-9-], up to 63 characters.',
    );
    expect(() => executors.locate(`machine://${NAS}`)).toThrow(
      'A checkout path must name one Machine path.',
    );
    expect(() => executors.locate(`${LOCATOR}:12-14`)).toThrow(
      'A checkout path must not carry a read selector.',
    );
    expect(() => executors.address(machine, 'relative')).toThrow(
      'This path cannot be written as a Machine locator.',
    );
    await expect(
      executors.inspect(machine, `machine://${NAS}`),
    ).rejects.toThrow('This address does not name one Machine path.');
  });

  it('names the missing executor identity and the unconfigured Machine', () => {
    const unset = hub({}, localGitSurface(), { nativeExecutorId: undefined });

    expect(() => unset.executors.locate('/srv/app')).toThrow(
      'The serving process holds no tools.nativeExecutorId, so it cannot run git for a local path.',
    );
    expect(() => unconfiguredHub().locate(LOCATOR)).toThrow(
      `No Machine named ${NAS} is configured, so its git surface cannot run.`,
    );
  });

  it('states the local canonical refusal', async () => {
    const { executors } = hub();
    const target = executors.locate('/srv/app');
    const directory = tempDirectory();
    const file = join(directory, 'file.txt');
    writeFileSync(file, 'x\n');

    await expect(
      executors.canonical(target, join(directory, 'missing')),
    ).rejects.toThrow('The checkout path does not exist.');
    await expect(executors.canonical(target, file)).rejects.toThrow(
      'The checkout path is not a directory.',
    );
  });

  it('states the Machine canonical refusal', async () => {
    const missing = hub({
      methods: ['git.inspect'],
      answer: () => ({ value: { kind: 'missing', isLink: false } }),
    });
    await expect(
      missing.executors.canonical(missing.executors.locate(LOCATOR), LOCATOR),
    ).rejects.toThrow('The checkout path does not exist.');

    const file = hub({
      methods: ['git.inspect'],
      answer: () => ({ value: { kind: 'file', isLink: false, size: 12 } }),
    });
    await expect(
      file.executors.canonical(file.executors.locate(LOCATOR), LOCATOR),
    ).rejects.toThrow('The checkout path is not a directory.');

    const noRealPath = hub({
      methods: ['git.inspect'],
      answer: () => ({ value: { kind: 'directory', isLink: false } }),
    });
    await expect(
      noRealPath.executors.canonical(
        noRealPath.executors.locate(LOCATOR),
        LOCATOR,
      ),
    ).rejects.toThrow(`The Machine ${NAS} answered no real path for fs.stat.`);

    const unusable = hub({
      methods: ['git.inspect'],
      answer: () => ({ value: { kind: 'directory' } }),
    });
    await expect(
      unusable.executors.canonical(unusable.executors.locate(LOCATOR), LOCATOR),
    ).rejects.toThrow(
      `The Machine ${NAS} answered an unusable fs.stat result.`,
    );
  });

  it('names the method and the Machine of a refusal', async () => {
    const { executors } = hub({
      methods: ['git.inspect'],
      answers: { 'fs.stat': { error: 'invalid_params' } },
    });

    await expect(
      executors.canonical(executors.locate(LOCATOR), LOCATOR),
    ).rejects.toThrow(`fs.stat failed on ${NAS}:`);
  });
});
