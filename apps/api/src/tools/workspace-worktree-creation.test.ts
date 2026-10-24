import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type Checkout,
  type Repository,
  type WorktreeLease,
} from '../db/schema';
import {
  type Db,
  TenantDbService,
  type TenantRunner,
} from '../db/tenant-db.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { ExecutorGit, localGitSurface } from '../machines/executor-git.service';
import { MachineConnector } from '../machines/machine-connector.service';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { type ToolErrorResult } from '../tools/types';
import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import {
  addCreationWorktree,
  planCreationWorktree,
  type CreationPlan,
  type CreationWorktreeInput,
} from './workspace-worktree-creation';
import { type WorktreeName } from './workspace-worktree';

/*
 * The Run-free worktree step of chat creation (openspec `chat-start-location`,
 * "The creation worktree commits with its lease and binding"): the ordered
 * decisions of the plan, the one `git worktree add`, and the one transaction
 * that records the Worktree checkout, its lease, and the Chat's first bound
 * root.
 *
 * The clone is a real git repository and the executor is the real local
 * surface, so the branch rule, the placement, and git's own refusals are the
 * production ones. The catalog, the lease, and the binding are spied at their
 * repository seam, so each test reads the rows the step would write and never a
 * git call it means to prove.
 */

// A git hook exports GIT_DIR and friends; clear them so the fixtures' own git
// commands cannot be redirected at this checkout.
for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'])
  .toString()
  .split('\n')) {
  if (name !== '') delete process.env[name];
}

const CREATED_AT = new Date('2026-10-24T00:00:00.000Z');
const OWNER = 'owner-1';
const CHAT_ID = '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10';
const NAME: WorktreeName = {
  name: 'clear-field-0192',
  slug: 'clear-field-0192',
  branch: 'llame/clear-field-0192',
};

const created: Array<string> = [];
const connectors: Array<MachineConnector> = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const connector of connectors.splice(0)) connector.onModuleDestroy();
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempDirectory(prefix = 'creation-worktree-'): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  created.push(directory);
  return directory;
}

function runGit(cwd: string, args: ReadonlyArray<string>): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  });
}

/** One commit-holding clone in a directory of its own. */
function clone(): string {
  const directory = join(tempDirectory(), 'llame');
  mkdirSync(directory);
  runGit(directory, ['init', '--quiet', '--initial-branch=main', '.']);
  runGit(directory, ['config', 'user.name', 'llame tests']);
  runGit(directory, ['config', 'user.email', 'llame@test.invalid']);
  runGit(directory, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(directory, 'README.md'), 'readme\n');
  runGit(directory, ['add', 'README.md']);
  runGit(directory, ['commit', '--quiet', '--message', 'first']);
  return directory;
}

function headOf(directory: string): string {
  return runGit(directory, ['rev-parse', 'HEAD']).trim();
}

function linkedWorktree(main: string, branch: string): string {
  const target = join(tempDirectory('creation-linked-'), branch);
  runGit(main, ['worktree', 'add', '--quiet', '-b', branch, target]);
  return target;
}

function configWith(): LlameConfig {
  return {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      nativeExecutorId: 'creation-host',
    },
  };
}

function executors(): ExecutorGit {
  const connector = new MachineConnector({
    hubVersion: 'test-hub',
    machines: undefined,
    idleCloseMs: 1000,
  });
  connectors.push(connector);
  return new ExecutorGit(
    { config: configWith() },
    connector,
    localGitSurface(),
  );
}

function repositoryRow(overrides: Partial<Repository> = {}): Repository {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    ownerUserId: OWNER,
    displayName: 'llame',
    canonicalRemote: 'github.com/leon0399/llame',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function checkoutRow(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    ownerUserId: OWNER,
    repositoryId: '22222222-2222-4222-8222-222222222222',
    executorId: 'creation-host',
    path: '/srv/llame',
    kind: 'main',
    parentCheckoutId: null,
    branch: 'main',
    origin: 'registered',
    worktreeBase: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function leaseRow(overrides: Partial<WorktreeLease> = {}): WorktreeLease {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    ownerUserId: OWNER,
    chatId: CHAT_ID,
    checkoutId: '88888888-8888-4888-8888-888888888888',
    baseRef: 'main',
    baseCommit: 'a'.repeat(40),
    createdAt: CREATED_AT,
    ...overrides,
  };
}

function creationInput(
  source: string,
  overrides: Partial<CreationWorktreeInput> = {},
): CreationWorktreeInput {
  return {
    target: { executorId: 'creation-host', machine: undefined, path: source },
    source: {
      checkout: checkoutRow({ path: source }),
      repository: repositoryRow(),
    },
    canonical: source,
    name: NAME,
    baseRef: undefined,
    decide: () => undefined,
    ...overrides,
  };
}

function stubbedCatalog() {
  return {
    createCheckout: vi
      .spyOn(RepositoriesRepository.prototype, 'createCheckout')
      .mockImplementation((input) =>
        Promise.resolve(
          checkoutRow({
            id: '99999999-9999-4999-8999-999999999999',
            ...input,
          }),
        ),
      ),
    createLease: vi
      .spyOn(RepositoriesRepository.prototype, 'createLease')
      .mockResolvedValue(leaseRow()),
    bindAtCreation: vi
      .spyOn(WorkspaceBindingRepository.prototype, 'bindAtCreation')
      .mockResolvedValue({ status: 'bound', generation: 1 }),
  };
}

/** The Run-free context: one tenant runner whose transaction is the same handle. */
function context() {
  // SAFETY: every repository the step touches is spied at its prototype, so
  // the transaction handle is never dereferenced.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const tx = {} as Db;
  const tenantDb: TenantRunner = new TenantDbService({
    transaction: async <T>(callback: (inner: Db) => Promise<T>) => callback(tx),
  });
  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_userId: string, callback: (scoped: Db) => Promise<T>) =>
      callback(tx),
  );
  return { tenantDb, userId: OWNER, chatId: CHAT_ID };
}

describe('planCreationWorktree', () => {
  it('decides the worktree directory before the add and writes nothing', async () => {
    const source = clone();
    const decisions: Array<[string, string]> = [];
    const worktreeAdd = vi.spyOn(ExecutorGit.prototype, 'worktreeAdd');

    const plan = await planCreationWorktree(
      executors(),
      creationInput(source, {
        decide: (kind, address) => {
          decisions.push([kind, address]);
          return undefined;
        },
      }),
    );

    const directory = join(
      source,
      '..',
      '.llame-worktrees',
      'llame',
      'clear-field-0192',
    );
    expect(plan).toEqual({
      mainClone: source,
      directory,
      branch: 'llame/clear-field-0192',
      sourceHead: headOf(source),
    });
    // The canonical clone IS the main tree here, so only the directory is a
    // derived address; a linked source adds the `main_clone` decision.
    expect(decisions).toEqual([['worktree_directory', directory]]);
    expect(worktreeAdd).not.toHaveBeenCalled();
    expect(existsSync(directory)).toBe(false);
  });

  it('decides the main clone of a linked-worktree source first', async () => {
    const main = clone();
    const linked = linkedWorktree(main, 'feature');
    const decisions: Array<string> = [];

    const plan = await planCreationWorktree(
      executors(),
      creationInput(linked, {
        decide: (kind) => {
          decisions.push(kind);
          return undefined;
        },
      }),
    );

    expect(decisions).toEqual(['main_clone', 'worktree_directory']);
    expect(plan).toMatchObject({ mainClone: main, sourceHead: headOf(main) });
  });

  it('answers the rejection that ends the plan, before any write', async () => {
    const source = clone();
    const rejection: ToolErrorResult = {
      status: 'error',
      type: 'permission_denied',
      message: 'The directory is not admitted.',
    };

    const plan = await planCreationWorktree(
      executors(),
      creationInput(source, {
        decide: (kind) =>
          kind === 'worktree_directory' ? rejection : undefined,
      }),
    );

    expect(plan).toEqual({ status: 'failed', result: rejection });
    expect(existsSync(join(source, '..', '.llame-worktrees'))).toBe(false);
  });

  it('reports a supplied name whose directory already exists', async () => {
    const source = clone();
    const directory = join(
      source,
      '..',
      '.llame-worktrees',
      'llame',
      'clear-field-0192',
    );
    mkdirSync(directory, { recursive: true });

    await expect(
      planCreationWorktree(executors(), creationInput(source)),
    ).resolves.toMatchObject({
      status: 'failed',
      result: {
        type: 'worktree_failed',
        message: 'A worktree directory with that name already exists.',
      },
    });
  });
});

describe('addCreationWorktree', () => {
  it('adds the worktree and commits the checkout, the lease, and the root', async () => {
    const catalog = stubbedCatalog();
    const source = clone();
    const base = headOf(source);

    const outcome = await addCreationWorktree(
      context(),
      executors(),
      creationInput(source),
      {
        mainClone: source,
        directory: join(
          source,
          '..',
          '.llame-worktrees',
          'llame',
          'clear-field-0192',
        ),
        branch: 'llame/clear-field-0192',
        sourceHead: base,
      },
    );

    const directory = join(
      source,
      '..',
      '.llame-worktrees',
      'llame',
      'clear-field-0192',
    );
    expect(outcome).toEqual({
      status: 'bound',
      root: directory,
      worktree: {
        path: directory,
        branch: 'llame/clear-field-0192',
        baseCommit: base,
      },
    });
    expect(runGit(source, ['worktree', 'list', '--porcelain'])).toContain(
      'branch refs/heads/llame/clear-field-0192',
    );
    expect(catalog.createCheckout).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      repositoryId: '22222222-2222-4222-8222-222222222222',
      executorId: 'creation-host',
      path: directory,
      kind: 'worktree',
      parentCheckoutId: '55555555-5555-4555-8555-555555555555',
      branch: 'llame/clear-field-0192',
      origin: 'created',
    });
    expect(catalog.createLease).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      chatId: CHAT_ID,
      checkoutId: '99999999-9999-4999-8999-999999999999',
      baseRef: base,
      baseCommit: base,
    });
    expect(catalog.bindAtCreation).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      ownerUserId: OWNER,
      executorId: 'creation-host',
      root: directory,
    });
  });

  it('leases the supplied base ref and the commit the add produced', async () => {
    const catalog = stubbedCatalog();
    const source = clone();
    const first = headOf(source);
    writeFileSync(join(source, 'second.txt'), 'second\n');
    runGit(source, ['add', 'second.txt']);
    runGit(source, ['commit', '--quiet', '--message', 'second']);
    const second = headOf(source);

    const plan: CreationPlan = {
      mainClone: source,
      directory: join(
        source,
        '..',
        '.llame-worktrees',
        'llame',
        'clear-field-0192',
      ),
      branch: 'llame/clear-field-0192',
      sourceHead: second,
    };
    const outcome = await addCreationWorktree(
      context(),
      executors(),
      creationInput(source, { baseRef: first }),
      plan,
    );

    expect(outcome).toMatchObject({
      status: 'bound',
      worktree: { baseCommit: first },
    });
    expect(catalog.createLease).toHaveBeenCalledWith(
      expect.objectContaining({ baseRef: first, baseCommit: first }),
    );
  });

  it('writes no row and no root when the directory is already recorded', async () => {
    const catalog = stubbedCatalog();
    catalog.createCheckout.mockResolvedValue(undefined);
    const source = clone();

    const outcome = await addCreationWorktree(
      context(),
      executors(),
      creationInput(source),
      {
        mainClone: source,
        directory: join(
          source,
          '..',
          '.llame-worktrees',
          'llame',
          'clear-field-0192',
        ),
        branch: 'llame/clear-field-0192',
        sourceHead: headOf(source),
      },
    );

    expect(outcome).toEqual({
      status: 'failed',
      result: {
        status: 'error',
        type: 'worktree_failed',
        message: 'This worktree path is already recorded.',
      },
    });
    expect(catalog.createLease).not.toHaveBeenCalled();
    expect(catalog.bindAtCreation).not.toHaveBeenCalled();
  });

  it('reports git’s own refusal and writes nothing', async () => {
    const catalog = stubbedCatalog();
    const source = clone();
    // A branch of that name already exists, so `git worktree add -b` fails
    // after the plan allowed it: the directory does not exist yet.
    runGit(source, ['branch', 'llame/clear-field-0192']);

    const outcome = await addCreationWorktree(
      context(),
      executors(),
      creationInput(source),
      {
        mainClone: source,
        directory: join(
          source,
          '..',
          '.llame-worktrees',
          'llame',
          'clear-field-0192',
        ),
        branch: 'llame/clear-field-0192',
        sourceHead: headOf(source),
      },
    );

    expect(outcome).toMatchObject({
      status: 'failed',
      result: { status: 'error', type: 'worktree_failed' },
    });
    expect(outcome).toHaveProperty(
      'result.message',
      expect.stringContaining('already exists'),
    );
    expect(catalog.createCheckout).not.toHaveBeenCalled();
    expect(catalog.createLease).not.toHaveBeenCalled();
    expect(catalog.bindAtCreation).not.toHaveBeenCalled();
  });

  it('answers conflict and leaves no row when the binding refuses', async () => {
    const catalog = stubbedCatalog();
    catalog.bindAtCreation.mockResolvedValue({ status: 'conflict' });
    const source = clone();

    await expect(
      addCreationWorktree(context(), executors(), creationInput(source), {
        mainClone: source,
        directory: join(
          source,
          '..',
          '.llame-worktrees',
          'llame',
          'clear-field-0192',
        ),
        branch: 'llame/clear-field-0192',
        sourceHead: headOf(source),
      }),
    ).resolves.toEqual({ status: 'conflict' });
    expect(catalog.bindAtCreation).toHaveBeenCalledTimes(1);
  });

  it('refuses to report a bound root for a Chat row that vanished', async () => {
    const catalog = stubbedCatalog();
    catalog.bindAtCreation.mockResolvedValue({ status: 'not_found' });
    const source = clone();

    await expect(
      addCreationWorktree(context(), executors(), creationInput(source), {
        mainClone: source,
        directory: join(
          source,
          '..',
          '.llame-worktrees',
          'llame',
          'clear-field-0192',
        ),
        branch: 'llame/clear-field-0192',
        sourceHead: headOf(source),
      }),
    ).rejects.toThrow('vanished under its lock');
  });

  it('has no removal path on any outcome', async () => {
    stubbedCatalog();
    const source = clone();
    const removeWorktree = vi.spyOn(ExecutorGit.prototype, 'removeWorktree');

    await addCreationWorktree(context(), executors(), creationInput(source), {
      mainClone: source,
      directory: join(
        source,
        '..',
        '.llame-worktrees',
        'llame',
        'clear-field-0192',
      ),
      branch: 'llame/clear-field-0192',
      sourceHead: headOf(source),
    });
    expect(removeWorktree).not.toHaveBeenCalled();
  });
});
