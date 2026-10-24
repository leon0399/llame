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

import { HttpException } from '@nestjs/common';
import { isRecord, isString } from '@workspace/runtime-safety';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type Mock } from 'vitest';

import * as schema from '../db/schema';
import { type Checkout } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { ExecutorGit, localGitSurface } from '../machines/executor-git.service';
import { MachineConnector } from '../machines/machine-connector.service';
import { RepositoriesRepository } from './repositories.repository';
import { createProtocolPeer } from '../testing/machine-protocol-peer';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import { type PermissionGroup } from '../tools/permissions/types';
import { WorktreeRemovalService } from './worktree-removal.service';

/*
 * Owner-initiated worktree removal (openspec `repositories` "Worktree removal is
 * owner-initiated and guarded"): each refusal keeps the directory and the row,
 * and only a clean removal with a provable base takes both away.
 *
 * The fixture is a real clone with a real worktree, so the dirty flag, the
 * upstream, the ahead count, and `git worktree remove` are git's own answers.
 */

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

function tempDirectory(prefix = 'worktree-removal-'): string {
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

/** One clone with a commit, in a directory of its own. */
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

/** One worktree at `directory`, on `branch`, with its head returned. */
function worktree(source: string, branch: string) {
  const directory = join(tempDirectory(), branch.replaceAll('/', '-'));
  runGit(source, ['worktree', 'add', '--quiet', '-b', branch, directory]);
  return { directory, head: runGit(directory, ['rev-parse', 'HEAD']).trim() };
}

function executors(tools: Partial<LlameConfig['tools']> = {}): ExecutorGit {
  const connector = new MachineConnector({
    hubVersion: 'test-hub',
    machines: undefined,
    transportFactory: createProtocolPeer().factory,
    idleCloseMs: 1000,
  });
  connectors.push(connector);
  return new ExecutorGit(
    { config: configWith(tools) },
    connector,
    localGitSurface(),
  );
}

function configWith(tools: Partial<LlameConfig['tools']> = {}): LlameConfig {
  return {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      nativeExecutorId: 'worktree-host',
      allowed: ['enter_workspace'],
      ...tools,
    },
  };
}

type RemovalUnderTest = {
  readonly removal: WorktreeRemovalService;
  readonly deleteCheckout: Mock;
  readonly findLease: Mock;
};

function service(
  options: {
    readonly config?: LlameConfig;
    readonly executors?: ExecutorGit;
    readonly group?: PermissionGroup;
  } = {},
): RemovalUnderTest {
  const db: Db = drizzle.mock({ schema });
  const runner = {
    runAs: async <T>(_userId: string, operation: (tx: Db) => Promise<T>) =>
      operation(db),
  };
  // SAFETY: this service only calls `runAs`, which the stub supplies; the real
  // class opens a transaction and sets the RLS identity a unit test cannot.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  const tenantDb = runner as never;
  return {
    removal: new WorktreeRemovalService(
      tenantDb,
      { config: options.config ?? configWith() },
      options.executors ?? executors(),
      compileToolPermissionMap(
        { enter_workspace: options.group ?? { allow: true } },
        'removal-test',
      ),
    ),
    deleteCheckout: vi
      .spyOn(RepositoriesRepository.prototype, 'deleteCheckout')
      .mockResolvedValue(true),
    findLease: vi
      .spyOn(RepositoriesRepository.prototype, 'findLease')
      .mockResolvedValue(undefined),
  };
}

/** One worktree row of this owner. */
function checkoutRow(directory: string): Checkout {
  return {
    id: 'checkout-1',
    ownerUserId: 'owner-1',
    repositoryId: 'repo-1',
    executorId: 'worktree-host',
    path: directory,
    kind: 'worktree',
    parentCheckoutId: 'main-1',
    branch: 'llame/x',
    origin: 'created',
    worktreeBase: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

/** The most important row a route reads first. */
function rowOf(row: Checkout | undefined): void {
  vi.spyOn(RepositoriesRepository.prototype, 'findCheckout').mockResolvedValue(
    row,
  );
}

/** The typed failure one removal answered, as its code and status. */
async function failureOf(promise: Promise<void>): Promise<{
  readonly code: string;
  readonly status: number;
}> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body: unknown = error.getResponse();
    const code = isRecord(body) ? body['code'] : undefined;
    if (!isString(code)) throw error;
    return { code, status: error.getStatus() };
  }
  throw new Error('The removal resolved instead of failing.');
}

describe('WorktreeRemovalService', () => {
  it('removes a clean worktree with an upstream and keeps its branch', async () => {
    const source = clone();
    const { directory } = worktree(source, 'llame/x');
    runGit(directory, ['branch', '--set-upstream-to=main', 'llame/x']);
    rowOf(checkoutRow(directory));
    const executorsOf = executors();
    const remove = vi.spyOn(executorsOf, 'removeWorktree');
    const { removal, deleteCheckout } = service({ executors: executorsOf });

    await expect(
      removal.remove('owner-1', 'checkout-1'),
    ).resolves.toBeUndefined();

    expect(existsSync(directory)).toBe(false);
    expect(remove).toHaveBeenCalledOnce();
    expect(deleteCheckout).toHaveBeenCalledWith('owner-1', 'checkout-1');
    expect(runGit(source, ['branch', '--list', 'llame/x'])).toContain(
      'llame/x',
    );
  });

  it('keeps a dirty worktree', async () => {
    const source = clone();
    const { directory } = worktree(source, 'llame/x');
    writeFileSync(join(directory, 'README.md'), 'changed\n');
    rowOf(checkoutRow(directory));
    const { removal, deleteCheckout } = service();

    await expect(
      failureOf(removal.remove('owner-1', 'checkout-1')),
    ).resolves.toStrictEqual({ code: 'worktree_not_clean', status: 409 });
    expect(existsSync(directory)).toBe(true);
    expect(deleteCheckout).not.toHaveBeenCalled();
  });

  it('keeps a worktree that is ahead of its upstream', async () => {
    const source = clone();
    const { directory } = worktree(source, 'llame/x');
    runGit(directory, ['branch', '--set-upstream-to=main', 'llame/x']);
    writeFileSync(join(directory, 'later.txt'), 'later\n');
    runGit(directory, ['add', 'later.txt']);
    runGit(directory, ['commit', '--quiet', '--message', 'later']);
    rowOf(checkoutRow(directory));
    const { removal, deleteCheckout } = service();

    await expect(
      failureOf(removal.remove('owner-1', 'checkout-1')),
    ).resolves.toStrictEqual({ code: 'worktree_not_clean', status: 409 });
    expect(existsSync(directory)).toBe(true);
    expect(deleteCheckout).not.toHaveBeenCalled();
  });

  it('removes a fresh worktree whose HEAD is the recorded base commit', async () => {
    const source = clone();
    const { directory, head } = worktree(source, 'llame/x');
    rowOf(checkoutRow(directory));
    const { removal, deleteCheckout, findLease } = service();
    findLease.mockResolvedValue({
      id: 'lease-1',
      ownerUserId: 'owner-1',
      chatId: 'chat-1',
      checkoutId: 'checkout-1',
      baseRef: 'main',
      baseCommit: head,
      createdAt: CREATED_AT,
    });

    await expect(
      removal.remove('owner-1', 'checkout-1'),
    ).resolves.toBeUndefined();

    expect(existsSync(directory)).toBe(false);
    expect(deleteCheckout).toHaveBeenCalledOnce();
  });

  it('keeps a worktree with no upstream whose HEAD moved past its base', async () => {
    const source = clone();
    const { directory } = worktree(source, 'llame/x');
    writeFileSync(join(directory, 'later.txt'), 'later\n');
    runGit(directory, ['add', 'later.txt']);
    runGit(directory, ['commit', '--quiet', '--message', 'later']);
    rowOf(checkoutRow(directory));
    const { removal, findLease } = service();
    findLease.mockResolvedValue({
      id: 'lease-1',
      ownerUserId: 'owner-1',
      chatId: 'chat-1',
      checkoutId: 'checkout-1',
      baseRef: 'main',
      baseCommit: 'b'.repeat(40),
      createdAt: CREATED_AT,
    });

    await expect(
      failureOf(removal.remove('owner-1', 'checkout-1')),
    ).resolves.toStrictEqual({ code: 'worktree_not_clean', status: 409 });
    expect(existsSync(directory)).toBe(true);
  });

  it('keeps a worktree with no lease and no upstream', async () => {
    const source = clone();
    const { directory } = worktree(source, 'llame/x');
    rowOf(checkoutRow(directory));
    const { removal } = service();

    await expect(
      failureOf(removal.remove('owner-1', 'checkout-1')),
    ).resolves.toStrictEqual({ code: 'worktree_not_clean', status: 409 });
    expect(existsSync(directory)).toBe(true);
  });

  it('refuses a removal when enter_workspace is not allowlisted', async () => {
    const source = clone();
    const { directory } = worktree(source, 'llame/x');
    rowOf(checkoutRow(directory));
    const executorsOf = executors();
    const status = vi.spyOn(executorsOf, 'status');
    const { removal } = service({
      config: configWith({ allowed: [] }),
      executors: executorsOf,
    });

    await expect(
      failureOf(removal.remove('owner-1', 'checkout-1')),
    ).resolves.toStrictEqual({ code: 'tool_not_allowed', status: 403 });
    expect(status).not.toHaveBeenCalled();
  });

  it('refuses a removal of a path the policy rejects, starting no git call', async () => {
    const source = clone();
    const { directory } = worktree(source, 'llame/x');
    rowOf(checkoutRow(directory));
    const executorsOf = executors();
    const status = vi.spyOn(executorsOf, 'status');
    const { removal } = service({
      executors: executorsOf,
      group: {
        allow: [{ field: 'path', regex: '^/nothing/' }],
        reject: [{ field: 'path', regex: '^/' }],
      },
    });

    await expect(
      failureOf(removal.remove('owner-1', 'checkout-1')),
    ).resolves.toStrictEqual({ code: 'permission_denied', status: 403 });
    expect(status).not.toHaveBeenCalled();
  });

  it('refuses a removal when no executor is configured', async () => {
    const source = clone();
    const { directory } = worktree(source, 'llame/x');
    rowOf(checkoutRow(directory));
    const executorsOf = executors({ nativeExecutorId: undefined });
    const status = vi.spyOn(executorsOf, 'status');
    const { removal } = service({
      config: configWith({ nativeExecutorId: undefined }),
      executors: executorsOf,
    });

    await expect(
      failureOf(removal.remove('owner-1', 'checkout-1')),
    ).resolves.toStrictEqual({ code: 'executor_unavailable', status: 503 });
    expect(status).not.toHaveBeenCalled();
  });

  it('answers a missing or foreign row as not found', async () => {
    rowOf(undefined);
    const { removal } = service();

    await expect(
      failureOf(removal.remove('owner-1', 'checkout-1')),
    ).resolves.toStrictEqual({ code: 'not_found', status: 404 });
  });

  it('refuses a main checkout through this route', async () => {
    const source = clone();
    rowOf({ ...checkoutRow(source), kind: 'main', parentCheckoutId: null });
    const { removal, deleteCheckout } = service();

    await expect(
      failureOf(removal.remove('owner-1', 'checkout-1')),
    ).resolves.toStrictEqual({ code: 'invalid_path', status: 422 });
    expect(deleteCheckout).not.toHaveBeenCalled();
  });

  it('answers a git removal failure with its standard error', async () => {
    const source = clone();
    const { directory } = worktree(source, 'llame/x');
    runGit(directory, ['branch', '--set-upstream-to=main', 'llame/x']);
    rowOf(checkoutRow(directory));
    const executorsOf = executors();
    vi.spyOn(executorsOf, 'removeWorktree').mockResolvedValue({
      status: 'error',
      type: 'git_failed',
      stderr: 'fatal: working tree is locked',
    });
    const { removal, deleteCheckout } = service({ executors: executorsOf });

    await expect(
      failureOf(removal.remove('owner-1', 'checkout-1')),
    ).resolves.toStrictEqual({ code: 'git_failed', status: 502 });
    expect(deleteCheckout).not.toHaveBeenCalled();
  });

  it('keeps the row when the directory is already gone', async () => {
    const source = clone();
    const { directory } = worktree(source, 'llame/x');
    runGit(directory, ['branch', '--set-upstream-to=main', 'llame/x']);
    rmSync(directory, { recursive: true, force: true });
    rowOf(checkoutRow(directory));
    const { removal, deleteCheckout } = service();

    await expect(
      failureOf(removal.remove('owner-1', 'checkout-1')),
    ).resolves.toStrictEqual({ code: 'git_failed', status: 502 });
    expect(deleteCheckout).not.toHaveBeenCalled();
  });
});
