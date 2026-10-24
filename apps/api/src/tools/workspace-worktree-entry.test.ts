/* eslint-disable typescript/no-unsafe-assignment -- a spied repository method's mock call tuple is `any[]`, so the recorded input is read back as one; every read is narrowed with `isRecord` before it is asserted on. */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { isRecord } from '@workspace/runtime-safety';

import * as schema from '../db/schema';
import {
  type Checkout,
  type Repository,
  type WorktreeLease,
} from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import { ExecutorGit } from '../machines/executor-git.service';
import { ExecutorGitError } from '../machines/executor-git-error';
import { MachineConnector } from '../machines/machine-connector.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { createProtocolPeer } from '../testing/machine-protocol-peer';
import { localGitSurface } from '../machines/executor-git.service';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type CompiledPolicy, type PermissionGroup } from './permissions/types';
import { type ToolContext, type ToolResult } from './types';
import { enterWorkspaceTool } from './workspace';

/*
 * Worktree entry through the tool's own seam (openspec `repositories` design
 * D5): the ordered decisions, the attempt before the add, the one transaction,
 * and the failures that must leave the binding unchanged.
 *
 * The clone fixtures are real git repositories, so placement, the canonical form
 * of a symlinked parent, the branch rule, and `git worktree add` are the real
 * ones. The catalog, the binding, and the event log are the database's, so the
 * tests stub those three repositories and never a git call they mean to prove.
 */

// A git hook exports GIT_DIR and friends; clear them so the fixtures' own git
// commands cannot be redirected at this checkout.
for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'])
  .toString()
  .split('\n')) {
  if (name !== '') delete process.env[name];
}

const CREATED_AT = new Date('2026-10-24T00:00:00.000Z');

const created: Array<string> = [];
const connectors: Array<MachineConnector> = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const connector of connectors.splice(0)) connector.onModuleDestroy();
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempDirectory(prefix = 'worktree-entry-'): string {
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

/**
 * One commit-holding clone, with `origin` only when a remote is named. It sits
 * in a directory of its own, so each fixture's `.llame-worktrees` is private to
 * it and two tests can never collide on a placement path.
 */
function clone(options: { readonly remote?: string } = {}): string {
  const directory = join(tempDirectory(), 'llame');
  mkdirSync(directory);
  runGit(directory, ['init', '--quiet', '--initial-branch=main', '.']);
  runGit(directory, ['config', 'user.name', 'llame tests']);
  runGit(directory, ['config', 'user.email', 'llame@test.invalid']);
  runGit(directory, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(directory, 'README.md'), 'readme\n');
  runGit(directory, ['add', 'README.md']);
  runGit(directory, ['commit', '--quiet', '--message', 'first']);
  if (options.remote !== undefined) {
    runGit(directory, ['remote', 'add', 'origin', options.remote]);
  }
  return directory;
}

function linkedWorktree(main: string, branch: string): string {
  const target = join(tempDirectory('worktree-linked-'), branch);
  runGit(main, ['worktree', 'add', '--quiet', '-b', branch, target]);
  return target;
}

function headOf(directory: string): string {
  return runGit(directory, ['rev-parse', 'HEAD']).trim();
}

function executors(): ExecutorGit {
  const connector = new MachineConnector({
    hubVersion: 'test-hub',
    machines: undefined,
    transportFactory: createProtocolPeer().factory,
    idleCloseMs: 1000,
  });
  connectors.push(connector);
  return new ExecutorGit(
    { config: configWith({}) },
    connector,
    localGitSurface(),
  );
}

function configWith(tools: Partial<LlameConfig['tools']>): LlameConfig {
  return {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      nativeExecutorId: 'worktree-host',
      ...tools,
    },
  };
}

function policy(group: PermissionGroup = { allow: true }): CompiledPolicy {
  return compileToolPermissionMap(
    { enter_workspace: group, exit_workspace: { allow: true } },
    'worktree-test',
  );
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  const db: Db = drizzle.mock({ schema });
  const tenantDb: TenantRunner = {
    runAs: async <T>(_userId: string, operation: (db: Db) => Promise<T>) =>
      operation(db),
  };
  return {
    runId: 'run-1',
    nativeExecutorId: 'worktree-host',
    nativeDeliverySequence: 4,
    toolCallId: 'call-1',
    userId: 'owner-1',
    chatId: 'chat-1',
    tenantDb,
    permissionPolicy: policy(),
    executorGit: executors(),
    ...overrides,
  };
}

function leaseRow(overrides: Partial<WorktreeLease> = {}): WorktreeLease {
  return {
    id: 'lease-1',
    ownerUserId: 'owner-1',
    chatId: 'chat-1',
    checkoutId: 'checkout-1',
    baseRef: 'main',
    baseCommit: 'a'.repeat(40),
    createdAt: CREATED_AT,
    ...overrides,
  };
}

let checkoutSequence = 0;

function repositoryRow(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 'repo-1',
    ownerUserId: 'owner-1',
    displayName: 'llame',
    canonicalRemote: 'github.com/leon0399/llame',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function checkoutRow(overrides: Partial<Checkout> = {}): Checkout {
  checkoutSequence += 1;
  return {
    id: `checkout-${checkoutSequence}`,
    ownerUserId: 'owner-1',
    repositoryId: 'repo-1',
    executorId: 'worktree-host',
    path: '/home/me/src/llame',
    kind: 'main',
    parentCheckoutId: null,
    branch: 'main',
    origin: 'adopted',
    worktreeBase: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

/**
 * The catalog, the binding, and the event log, stubbed at their own seam. Every
 * default is the empty catalog and a successful binding, so a test names only
 * the rows it needs.
 */
function stubbedDatabase() {
  return {
    findCheckoutByPath: vi
      .spyOn(RepositoriesRepository.prototype, 'findCheckoutByPath')
      .mockResolvedValue(undefined),
    findCheckout: vi
      .spyOn(RepositoriesRepository.prototype, 'findCheckout')
      .mockResolvedValue(undefined),
    findRepository: vi
      .spyOn(RepositoriesRepository.prototype, 'findRepository')
      .mockResolvedValue(repositoryRow()),
    findRepositoryByRemote: vi
      .spyOn(RepositoriesRepository.prototype, 'findRepositoryByRemote')
      .mockResolvedValue(undefined),
    findRepositoryByAlias: vi
      .spyOn(RepositoriesRepository.prototype, 'findRepositoryByAlias')
      .mockResolvedValue(undefined),
    createRepository: vi
      .spyOn(RepositoriesRepository.prototype, 'createRepository')
      .mockResolvedValue(repositoryRow()),
    createCheckout: vi
      .spyOn(RepositoriesRepository.prototype, 'createCheckout')
      .mockImplementation((input) => Promise.resolve(checkoutRow(input))),
    createLease: vi
      .spyOn(RepositoriesRepository.prototype, 'createLease')
      .mockResolvedValue(leaseRow()),
    isCurrentDelivery: vi
      .spyOn(WorkspaceBindingRepository.prototype, 'isCurrentDelivery')
      .mockResolvedValue(true),
    enter: vi
      .spyOn(WorkspaceBindingRepository.prototype, 'enter')
      .mockResolvedValue({
        status: 'bound',
        previousRoot: null,
        generation: 1,
      }),
    begin: vi
      .spyOn(NativeFilesRepository.prototype, 'begin')
      .mockResolvedValue(undefined),
    append: vi
      .spyOn(RunEventsRepository.prototype, 'append')
      .mockResolvedValue({
        runId: 'run-1',
        sequence: 1,
        eventType: 'native.result',
        payload: {},
        createdAt: CREATED_AT,
      }),
  };
}

/** The observation one call failed with, asserting it is an error. */
function errorOf(result: ToolResult) {
  if (result.status !== 'error') {
    throw new Error(`The call succeeded: ${JSON.stringify(result)}`);
  }
  return { type: result.type, message: result.message };
}

/** One worktree call through the tool, with the same package shape the model sends. */
function enterWorktreeCall(
  toolContext: ToolContext,
  path: string,
  worktree: { readonly name?: string; readonly baseRef?: string } | undefined,
) {
  return enterWorkspaceTool.execute(toolContext, {
    path,
    ...(worktree !== undefined && { worktree }),
  });
}

describe('enter_workspace with a worktree', () => {
  it('creates the worktree beside the clone, records it, and binds it', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const base = headOf(source);
    const parent = join(source, '..');

    const result = await enterWorktreeCall(context(), source, {
      name: 'clear-field-0192',
    });

    const directory = join(
      parent,
      '.llame-worktrees',
      'llame',
      'clear-field-0192',
    );
    expect(result).toMatchObject({
      status: 'success',
      root: directory,
      state: 'bound',
      worktree: {
        path: directory,
        branch: 'llame/clear-field-0192',
        baseCommit: base,
      },
    });
    // The directory is a real worktree of the clone, on the branch the rule set.
    expect(runGit(source, ['worktree', 'list', '--porcelain'])).toContain(
      `branch refs/heads/llame/clear-field-0192`,
    );

    expect(database.createRepository).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalRemote: 'github.com/leon0399/llame',
        displayName: 'llame',
      }),
    );
    const main = database.createCheckout.mock.calls[0]?.[0];
    expect(isRecord(main) ? main : {}).toMatchObject({
      path: source,
      kind: 'main',
      origin: 'adopted',
      parentCheckoutId: null,
    });
    const worktree = database.createCheckout.mock.calls[1]?.[0];
    expect(isRecord(worktree) ? worktree : {}).toMatchObject({
      path: directory,
      kind: 'worktree',
      origin: 'created',
      branch: 'llame/clear-field-0192',
      parentCheckoutId: expect.any(String),
    });
    expect(database.createLease).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      chatId: 'chat-1',
      checkoutId: expect.any(String),
      baseRef: base,
      baseCommit: base,
    });
    expect(database.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'worktree',
        path: directory,
        fence: { bound: true, executorId: 'worktree-host' },
      }),
    );
    expect(database.enter).toHaveBeenCalledWith(
      expect.objectContaining({
        root: directory,
        executorId: 'worktree-host',
        bindExecutorId: 'worktree-host',
      }),
    );
    expect(database.append).toHaveBeenCalledWith(
      'run-1',
      'native.result',
      expect.objectContaining({
        toolCallId: 'call-1',
        result: expect.objectContaining({ status: 'success', root: directory }),
      }),
    );
  });

  it('keeps a slash in the name as the branch and flattens the directory', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });

    const result = await enterWorktreeCall(context(), source, {
      name: 'feature/login',
    });

    expect(result).toMatchObject({
      status: 'success',
      worktree: {
        path: join(source, '..', '.llame-worktrees', 'llame', 'feature-login'),
        branch: 'feature/login',
      },
    });
    expect(runGit(source, ['branch', '--list', 'feature/login'])).toContain(
      'feature/login',
    );
  });

  it('starts the branch at a supplied base ref', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const first = headOf(source);
    writeFileSync(join(source, 'second.txt'), 'second\n');
    runGit(source, ['add', 'second.txt']);
    runGit(source, ['commit', '--quiet', '--message', 'second']);

    const result = await enterWorktreeCall(context(), source, {
      name: 'from-first',
      baseRef: first,
    });

    expect(result).toMatchObject({
      status: 'success',
      worktree: { baseCommit: first },
    });
  });

  it('places the worktree under a recorded worktree base', async () => {
    const database = stubbedDatabase();
    const base = tempDirectory('worktree-base-');
    database.findCheckoutByPath.mockResolvedValue(
      checkoutRow({ path: '/placeholder', worktreeBase: base }),
    );
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    database.findCheckoutByPath.mockImplementation(
      (_owner: string, _executor: string, path: string) =>
        Promise.resolve(
          path === source
            ? checkoutRow({
                path: source,
                repositoryId: 'repo-1',
                worktreeBase: base,
              })
            : undefined,
        ),
    );

    const result = await enterWorktreeCall(context(), source, {
      name: 'clear-field-0192',
    });

    expect(result).toMatchObject({
      status: 'success',
      root: join(base, 'llame', 'clear-field-0192'),
    });
    expect(existsSync(join(source, '..', '.llame-worktrees'))).toBe(false);
  });

  it('binds a worktree of a subdirectory source beside the clone', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const subdirectory = join(source, 'apps');
    mkdirSync(subdirectory, { recursive: true });

    const result = await enterWorktreeCall(context(), subdirectory, {
      name: 'clear-field-0192',
    });

    expect(result).toMatchObject({
      status: 'success',
      root: join(source, '..', '.llame-worktrees', 'llame', 'clear-field-0192'),
    });
  });

  it('uses the main clone of a linked-worktree source', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const linked = linkedWorktree(source, 'feature');
    database.createCheckout.mockImplementation((input: Partial<Checkout>) =>
      Promise.resolve(checkoutRow(input)),
    );

    const result = await enterWorktreeCall(context(), linked, {
      name: 'clear-field-0192',
    });

    expect(result).toMatchObject({
      status: 'success',
      root: join(source, '..', '.llame-worktrees', 'llame', 'clear-field-0192'),
    });
    const paths = database.createCheckout.mock.calls.map(
      (call) => call[0].path,
    );
    // The main clone, the linked source the owner entered, and the new worktree.
    expect(paths).toStrictEqual([
      source,
      linked,
      join(source, '..', '.llame-worktrees', 'llame', 'clear-field-0192'),
    ]);
    expect(database.createCheckout.mock.calls[1]?.[0]).toMatchObject({
      kind: 'worktree',
      origin: 'adopted',
      branch: 'feature',
    });
  });

  it('reuses the recorded main checkout and its repository', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    database.findCheckoutByPath.mockResolvedValue(
      checkoutRow({ id: 'main-recorded', path: source, kind: 'main' }),
    );
    database.findRepository.mockResolvedValue(
      repositoryRow({ displayName: 'renamed' }),
    );

    const result = await enterWorktreeCall(context(), source, {
      name: 'clear-field-0192',
    });

    expect(result).toMatchObject({
      status: 'success',
      root: join(
        source,
        '..',
        '.llame-worktrees',
        'renamed',
        'clear-field-0192',
      ),
    });
    expect(database.createRepository).not.toHaveBeenCalled();
    expect(database.createCheckout.mock.calls[0]?.[0]).toMatchObject({
      path: join(
        source,
        '..',
        '.llame-worktrees',
        'renamed',
        'clear-field-0192',
      ),
      parentCheckoutId: 'main-recorded',
    });
  });

  it('switches the bound root of a Chat already in the source clone', async () => {
    const database = stubbedDatabase();
    database.enter.mockResolvedValue({
      status: 'switched',
      previousRoot: '/home/me/src/llame',
      generation: 2,
    });
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });

    const result = await enterWorktreeCall(context(), source, {
      name: 'clear-field-0192',
    });

    expect(result).toMatchObject({ status: 'success', state: 'switched' });
    expect(database.enter).toHaveBeenCalledOnce();
  });

  it('adopts a remote-less clone without a remote row', async () => {
    const database = stubbedDatabase();
    database.createRepository.mockResolvedValue(
      repositoryRow({ canonicalRemote: null, displayName: 'no-remote' }),
    );
    const source = clone();

    const result = await enterWorktreeCall(context(), source, {
      name: 'clear-field-0192',
    });

    expect(result).toMatchObject({ status: 'success' });
    expect(database.createRepository).toHaveBeenCalledWith(
      expect.objectContaining({ canonicalRemote: null }),
    );
  });

  it('reuses the rows a concurrent adopter committed first', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    database.createRepository.mockResolvedValue(undefined);
    database.findRepositoryByRemote.mockResolvedValue(repositoryRow());
    database.findCheckoutByPath.mockResolvedValue(undefined);
    database.createCheckout
      .mockResolvedValueOnce(undefined)
      .mockImplementation((input: Partial<Checkout>) =>
        Promise.resolve(checkoutRow(input)),
      );
    // The read before placement, the adoption, and the re-read the loser does.
    database.findCheckoutByPath.mockResolvedValueOnce(undefined);
    database.findCheckoutByPath.mockResolvedValueOnce(undefined);
    database.findCheckoutByPath.mockResolvedValueOnce(
      checkoutRow({ id: 'main-winner', path: source }),
    );
    database.findCheckoutByPath.mockResolvedValue(undefined);

    const result = await enterWorktreeCall(context(), source, {
      name: 'clear-field-0192',
    });

    expect(result).toMatchObject({ status: 'success' });
    expect(database.createCheckout.mock.calls[1]?.[0]).toMatchObject({
      parentCheckoutId: 'main-winner',
    });
  });

  it('records a generated name when none is supplied', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });

    const result = await enterWorktreeCall(context(), source, {});

    if (!('worktree' in result)) {
      throw new Error('A worktree entry must report its worktree.');
    }
    expect(result.worktree).toMatchObject({
      branch: expect.stringMatching(/^llame\/[a-z]+-[a-z]+-[0-9a-f]{4}$/u),
    });
  });

  it('fails a supplied name whose directory already exists', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    mkdirSync(join(source, '..', '.llame-worktrees', 'llame', 'taken'), {
      recursive: true,
    });

    const result = await enterWorktreeCall(context(), source, {
      name: 'taken',
    });

    expect(errorOf(result).type).toBe('worktree_failed');
    expect(database.begin).not.toHaveBeenCalled();
    expect(database.createCheckout).not.toHaveBeenCalled();
  });

  it('fails a branch another checkout already uses', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    runGit(source, ['branch', 'llame/taken']);

    const result = await enterWorktreeCall(context(), source, {
      name: 'taken',
    });

    expect(errorOf(result)).toMatchObject({
      type: 'worktree_failed',
      message: expect.stringContaining('already exists'),
    });
    expect(database.createCheckout).not.toHaveBeenCalled();
    expect(database.enter).not.toHaveBeenCalled();
  });

  it('fails a source that is not a repository', async () => {
    const database = stubbedDatabase();
    const plain = tempDirectory('worktree-plain-');

    const result = await enterWorktreeCall(context(), plain, {
      name: 'clear-field-0192',
    });

    expect(errorOf(result).type).toBe('worktree_failed');
    expect(database.begin).not.toHaveBeenCalled();
    expect(database.createRepository).not.toHaveBeenCalled();
  });

  it('removes the worktree a policy never decided on', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const executorsOf = executors();
    const canonical = vi
      .spyOn(executorsOf, 'canonical')
      .mockResolvedValue('/tmp/elsewhere/llame/taken');
    const remove = vi
      .spyOn(executorsOf, 'removeWorktree')
      .mockResolvedValue({ status: 'ok' });

    const result = await enterWorktreeCall(
      context({ executorGit: executorsOf }),
      source,
      { name: 'taken' },
    );

    expect(errorOf(result)).toMatchObject({
      type: 'worktree_failed',
      message: expect.stringContaining('different path'),
    });
    expect(canonical).toHaveBeenCalledWith(
      expect.anything(),
      join(source, '..', '.llame-worktrees', 'llame', 'taken'),
    );
    expect(remove).toHaveBeenCalledOnce();
    expect(database.createCheckout).not.toHaveBeenCalled();
  });

  it('reports a fence lost after the add with the directory it left', async () => {
    const database = stubbedDatabase();
    database.enter.mockResolvedValue({ status: 'fence_lost' });
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const directory = join(
      source,
      '..',
      '.llame-worktrees',
      'llame',
      'clear-field-0192',
    );

    const result = await enterWorktreeCall(context(), source, {
      name: 'clear-field-0192',
    });

    expect(result).toMatchObject({
      status: 'error',
      type: 'executor_unavailable',
      leftDirectory: directory,
    });
    expect(database.append).not.toHaveBeenCalled();
  });

  it('fails when this process serves no git', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });

    const result = await enterWorktreeCall(
      context({ executorGit: undefined }),
      source,
      { name: 'clear-field-0192' },
    );

    expect(errorOf(result).type).toBe('worktree_failed');
  });
});

describe('the decisions of a worktree entry', () => {
  it('refuses a rejected submitted path before any probe', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const executorsOf = executors();
    const inspect = vi.spyOn(executorsOf, 'inspect');
    const worktreeContext = context({
      executorGit: executorsOf,
      permissionPolicy: policy({
        allow: [{ field: 'path', regex: '^/deeper/' }],
        reject: [{ field: 'path', regex: `^${source}$` }],
      }),
    });

    const result = await enterWorktreeCall(worktreeContext, source, {
      name: 'clear-field-0192',
    });

    expect(errorOf(result).type).toBe('permission_denied');
    expect(inspect).not.toHaveBeenCalled();
    expect(database.begin).not.toHaveBeenCalled();
  });

  it('refuses a rejected canonical path before any git call', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const alias = join(tempDirectory('worktree-alias-'), 'alias');
    symlinkSync(source, alias, 'dir');
    const executorsOf = executors();
    const inspect = vi.spyOn(executorsOf, 'inspect');
    const worktreeContext = context({
      executorGit: executorsOf,
      permissionPolicy: policy({
        allow: [{ field: 'path', regex: '^/' }],
        reject: [{ field: 'path', regex: `^${source}$` }],
      }),
    });

    const result = await enterWorktreeCall(worktreeContext, alias, {
      name: 'clear-field-0192',
    });

    expect(errorOf(result).type).toBe('permission_denied');
    expect(inspect).not.toHaveBeenCalled();
  });

  it('refuses a rejected main clone behind an allowed subdirectory', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const subdirectory = join(source, 'apps', 'web');
    mkdirSync(subdirectory, { recursive: true });
    const executorsOf = executors();
    const inspect = vi.spyOn(executorsOf, 'inspect');
    const add = vi.spyOn(executorsOf, 'worktreeAdd');
    const worktreeContext = context({
      executorGit: executorsOf,
      permissionPolicy: policy({
        allow: [{ field: 'path', regex: '^/' }],
        reject: [{ field: 'path', regex: `^${source}$` }],
      }),
    });

    const result = await enterWorktreeCall(worktreeContext, subdirectory, {
      name: 'clear-field-0192',
    });

    expect(errorOf(result).type).toBe('permission_denied');
    expect(inspect).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses a rejected linked-worktree main clone', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const linked = linkedWorktree(source, 'feature');
    const executorsOf = executors();
    const add = vi.spyOn(executorsOf, 'worktreeAdd');
    const worktreeContext = context({
      executorGit: executorsOf,
      permissionPolicy: policy({
        allow: [{ field: 'path', regex: '^/' }],
        reject: [{ field: 'path', regex: `^${source}$` }],
      }),
    });

    const result = await enterWorktreeCall(worktreeContext, linked, {
      name: 'clear-field-0192',
    });

    expect(errorOf(result).type).toBe('permission_denied');
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses a rejected worktree directory before the add', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const executorsOf = executors();
    const add = vi.spyOn(executorsOf, 'worktreeAdd');
    const worktreeContext = context({
      executorGit: executorsOf,
      permissionPolicy: policy({
        allow: [{ field: 'path', regex: '^/' }],
        reject: [{ field: 'path', regex: '\\.llame-worktrees/' }],
      }),
    });

    const result = await enterWorktreeCall(worktreeContext, source, {
      name: 'clear-field-0192',
    });

    expect(errorOf(result).type).toBe('permission_denied');
    expect(add).not.toHaveBeenCalled();
    expect(database.begin).not.toHaveBeenCalled();
  });

  it('decides a symlinked worktree parent on its canonical form', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const elsewhere = tempDirectory('worktree-elsewhere-');
    symlinkSync(elsewhere, join(source, '..', '.llame-worktrees'), 'dir');

    const result = await enterWorktreeCall(context(), source, {
      name: 'clear-field-0192',
    });

    expect(result).toMatchObject({
      status: 'success',
      root: join(elsewhere, 'llame', 'clear-field-0192'),
    });
    expect(
      existsSync(join(elsewhere, 'llame', 'clear-field-0192', 'README.md')),
    ).toBe(true);
  });

  it('records the three derived decisions with their kinds', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const subdirectory = join(source, 'apps');
    mkdirSync(subdirectory, { recursive: true });
    const decisions: Array<{ kind: string; url: string }> = [];

    await enterWorktreeCall(
      context({
        onDerivedDecision: (decision) => decisions.push(decision),
      }),
      subdirectory,
      { name: 'clear-field-0192' },
    );

    expect(decisions.map((decision) => [decision.kind, decision.url])).toEqual([
      ['canonical', subdirectory],
      ['main_clone', source],
      [
        'worktree_directory',
        join(source, '..', '.llame-worktrees', 'llame', 'clear-field-0192'),
      ],
    ]);
  });

  it('records every decision as a bypass allow in bypass mode', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const decisions: Array<{ kind: string; decision: { reason: string } }> = [];

    const result = await enterWorktreeCall(
      context({
        permissionMode: 'bypass',
        permissionPolicy: policy({
          allow: [{ field: 'path', regex: '^/nothing/' }],
          reject: [{ field: 'path', regex: '^/' }],
        }),
        onDerivedDecision: (decision) => decisions.push(decision),
      }),
      source,
      { name: 'clear-field-0192' },
    );

    expect(result).toMatchObject({ status: 'success' });
    expect(decisions.map((decision) => decision.kind)).toEqual([
      'canonical',
      'worktree_directory',
    ]);
    expect(
      decisions.every(
        (decision) => decision.decision.reason === 'permission_mode_bypass',
      ),
    ).toBe(true);
  });
});

describe('worktree failures that come from the executor', () => {
  it.each([
    ['machine_unavailable', false, 'machine_unavailable'],
    ['machine_unavailable', true, 'outcome_unknown'],
    ['machine_update_required', false, 'machine_update_required'],
    ['path_not_registered', false, 'path_not_registered'],
    ['executor_unavailable', false, 'executor_unavailable'],
    ['git_failed', false, 'worktree_failed'],
  ] as const)('answers %s with sent=%s as %s', async (code, sent, expected) => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const executorsOf = executors();
    vi.spyOn(executorsOf, 'inspect').mockRejectedValue(
      new ExecutorGitError(code, 'refused', sent),
    );

    const result = await enterWorktreeCall(
      context({ executorGit: executorsOf }),
      source,
      { name: 'clear-field-0192' },
    );

    expect(errorOf(result).type).toBe(expected);
    if (expected === 'outcome_unknown') {
      expect(result).toHaveProperty('leftDirectory', source);
    }
  });

  it('answers an invalid input with the worktree failure the git surface names', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const executorsOf = executors();
    vi.spyOn(executorsOf, 'worktreeAdd').mockResolvedValue({
      status: 'error',
      type: 'invalid_input',
      message: 'A branch name must not be empty.',
    });

    const result = await enterWorktreeCall(
      context({ executorGit: executorsOf }),
      source,
      { name: 'clear-field-0192' },
    );

    expect(errorOf(result)).toStrictEqual({
      type: 'worktree_failed',
      message: 'A branch name must not be empty.',
    });
  });

  it('answers a timeout with a fixed message when git wrote nothing', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const executorsOf = executors();
    vi.spyOn(executorsOf, 'worktreeAdd').mockResolvedValue({
      status: 'error',
      type: 'timed_out',
      stderr: '',
    });

    const result = await enterWorktreeCall(
      context({ executorGit: executorsOf }),
      source,
      { name: 'clear-field-0192' },
    );

    expect(errorOf(result)).toStrictEqual({
      type: 'worktree_failed',
      message: 'The worktree command failed.',
    });
  });

  it('answers the redacted standard error a git failure carries', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const executorsOf = executors();
    vi.spyOn(executorsOf, 'worktreeAdd').mockResolvedValue({
      status: 'error',
      type: 'git_failed',
      stderr: 'fatal: could not create directory',
    });

    const result = await enterWorktreeCall(
      context({ executorGit: executorsOf }),
      source,
      { name: 'clear-field-0192' },
    );

    expect(errorOf(result)).toStrictEqual({
      type: 'worktree_failed',
      message: 'fatal: could not create directory',
    });
  });

  it('fails when the worktree path is already recorded', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    database.createCheckout
      .mockImplementationOnce((input: Partial<Checkout>) =>
        Promise.resolve(checkoutRow(input)),
      )
      .mockResolvedValueOnce(undefined);

    const result = await enterWorktreeCall(context(), source, {
      name: 'clear-field-0192',
    });

    expect(errorOf(result)).toStrictEqual({
      type: 'worktree_failed',
      message: 'This worktree path is already recorded.',
    });
  });

  it('fails when the source clone cannot be recorded', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    database.createRepository.mockResolvedValue(undefined);
    database.findRepositoryByRemote.mockResolvedValue(undefined);

    const result = await enterWorktreeCall(context(), source, {
      name: 'clear-field-0192',
    });

    expect(errorOf(result).type).toBe('worktree_failed');
    expect(database.createLease).not.toHaveBeenCalled();
  });

  it('binds nothing when the attempt is already recorded', async () => {
    const database = stubbedDatabase();
    database.begin.mockResolvedValue({
      status: 'error',
      type: 'outcome_unknown',
      message: 'A previous host command may have executed.',
    });
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const executorsOf = executors();
    const add = vi.spyOn(executorsOf, 'worktreeAdd');

    const result = await enterWorktreeCall(
      context({ executorGit: executorsOf }),
      source,
      { name: 'clear-field-0192' },
    );

    expect(errorOf(result).type).toBe('outcome_unknown');
    expect(add).not.toHaveBeenCalled();
    expect(database.createCheckout).not.toHaveBeenCalled();
  });
});

describe('worktree names the entry generates', () => {
  it('retries a generated name whose directory exists', async () => {
    stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const executorsOf = executors();
    const exists = vi
      .spyOn(executorsOf, 'exists')
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const add = vi.spyOn(executorsOf, 'worktreeAdd').mockResolvedValue({
      status: 'ok',
      path: '/x',
      branch: 'llame/x',
      head: 'a',
    });
    vi.spyOn(executorsOf, 'inspect').mockResolvedValue({
      status: 'ok',
      toplevel: source,
      commonDir: join(source, '.git'),
      linked: false,
      mainWorktree: null,
      remotes: [],
      branch: 'main',
      head: 'a',
    });
    vi.spyOn(executorsOf, 'canonicalTarget').mockImplementation(
      (_target, address) => Promise.resolve(address),
    );
    vi.spyOn(executorsOf, 'canonical').mockImplementation((_target, address) =>
      Promise.resolve(address),
    );

    const result = await enterWorktreeCall(
      context({ executorGit: executorsOf }),
      source,
      {},
    );

    expect(result).toMatchObject({ status: 'success' });
    expect(exists).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledOnce();
  });

  it('gives up after one generated name per attempt', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const executorsOf = executors();
    const exists = vi.spyOn(executorsOf, 'exists').mockResolvedValue(true);

    const result = await enterWorktreeCall(
      context({ executorGit: executorsOf }),
      source,
      {},
    );

    expect(errorOf(result)).toStrictEqual({
      type: 'worktree_failed',
      message: 'No free worktree name was found.',
    });
    expect(exists).toHaveBeenCalledTimes(8);
    expect(database.createCheckout).not.toHaveBeenCalled();
  });
});

describe('the source clone a worktree entry reads', () => {
  it('keeps the recorded worktree base of a worktree row among its choices', async () => {
    const database = stubbedDatabase();
    const base = tempDirectory('worktree-parent-base-');
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    const linked = linkedWorktree(source, 'feature');
    database.findCheckoutByPath.mockImplementation(
      (_owner: string, _executor: string, path: string) =>
        Promise.resolve(
          path === linked
            ? checkoutRow({
                id: 'linked-row',
                path: linked,
                kind: 'worktree',
                parentCheckoutId: 'parent-row',
                branch: 'feature',
              })
            : path === source
              ? checkoutRow({
                  id: 'parent-row',
                  path: source,
                  kind: 'main',
                  worktreeBase: base,
                })
              : undefined,
        ),
    );
    database.findCheckout.mockResolvedValue(
      checkoutRow({ id: 'parent-row', path: source, worktreeBase: base }),
    );

    const result = await enterWorktreeCall(context(), linked, {
      name: 'clear-field-0192',
    });

    expect(result).toMatchObject({
      status: 'success',
      root: join(base, 'llame', 'clear-field-0192'),
    });
    // The main clone row exists, so only the entered linked source and the new
    // worktree are recorded.
    const paths = database.createCheckout.mock.calls.map(
      (call) => call[0].path,
    );
    expect(paths).toStrictEqual([
      linked,
      join(base, 'llame', 'clear-field-0192'),
    ]);
  });

  it('adopts a main clone whose row exists as a worktree row without a parent', async () => {
    const database = stubbedDatabase();
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    database.findCheckoutByPath.mockResolvedValue(
      checkoutRow({ path: source, kind: 'worktree', parentCheckoutId: null }),
    );

    const result = await enterWorktreeCall(context(), source, {
      name: 'clear-field-0192',
    });

    expect(errorOf(result).type).toBe('worktree_failed');
    expect(database.createLease).not.toHaveBeenCalled();
  });

  it('lists no directory when the parent row is already the main clone', async () => {
    const database = stubbedDatabase();
    const base = tempDirectory('worktree-main-base-');
    const source = clone({ remote: 'git@github.com:leon0399/llame.git' });
    database.findCheckoutByPath.mockResolvedValue(
      checkoutRow({ path: source, kind: 'main', worktreeBase: base }),
    );

    await enterWorktreeCall(context(), source, { name: 'clear-field-0192' });

    expect(readdirSync(join(base, 'llame')).includes('clear-field-0192')).toBe(
      true,
    );
    expect(database.createCheckout.mock.calls[0]?.[0]).toMatchObject({
      parentCheckoutId: 'checkout-' + String(checkoutSequence - 1),
    });
  });
});
