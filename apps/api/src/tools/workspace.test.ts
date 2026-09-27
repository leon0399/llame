import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';

import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import type * as NodeFsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Db, TenantRunner } from '../db/tenant-db.service';
import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { resolveAdvertisedTools, TOOL_REGISTRY } from './registry';
import { runTool } from './runner';
import type { ToolContext } from './types';
import {
  enterWorkspaceTool,
  exitWorkspaceTool,
  WORKSPACE_AUTHORITY,
} from './workspace';
import { createWorkspaceRootCell } from './workspace-path';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  return { ...actual, realpath: vi.fn(actual.realpath) };
});

function permissivePolicy() {
  return compileToolPermissionMap(
    { enter_workspace: { allow: true }, exit_workspace: { allow: true } },
    'workspace-test',
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
    nativeExecutorId: 'worker-1',
    nativeDeliverySequence: 4,
    toolCallId: 'call-1',
    userId: 'owner-1',
    chatId: 'chat-1',
    tenantDb,
    permissionPolicy: permissivePolicy(),
    ...overrides,
  };
}

type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('Workspace host tools', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workspace-tool-'));
    vi.spyOn(
      WorkspaceBindingRepository.prototype,
      'isCurrentDelivery',
    ).mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });
  it('registers and advertises both host-capability tools by exact id', () => {
    expect(TOOL_REGISTRY.get('enter_workspace')).toBe(enterWorkspaceTool);
    expect(TOOL_REGISTRY.get('exit_workspace')).toBe(exitWorkspaceTool);
    expect(resolveAdvertisedTools(['enter_workspace'])).toContain(
      enterWorkspaceTool,
    );
    expect(resolveAdvertisedTools(['exit_workspace'])).toContain(
      exitWorkspaceTool,
    );
  });

  it('rejects a relative path before any binding call', async () => {
    const base = context();
    const runAs = vi.spyOn(base.tenantDb, 'runAs');
    const result = await enterWorkspaceTool.execute(base, { path: 'relative' });

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'Workspace path must be absolute and contain no NUL bytes.',
    });
    expect(runAs).not.toHaveBeenCalled();
  });

  it('rejects an absolute path containing NUL before any binding call', async () => {
    const base = context();
    const runAs = vi.spyOn(base.tenantDb, 'runAs');
    const result = await enterWorkspaceTool.execute(base, {
      path: `${root}\0nul`,
    });

    expect(result).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'Workspace path must be absolute and contain no NUL bytes.',
    });
    expect(runAs).not.toHaveBeenCalled();
  });

  it('refuses a non-directory target without entering it', async () => {
    const file = join(root, 'file.txt');
    await writeFile(file, 'content');
    const enter = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'enter')
      .mockResolvedValue({
        status: 'bound',
        previousRoot: null,
        generation: 1,
      });

    const result = await enterWorkspaceTool.execute(context(), { path: file });

    expect(result).toEqual({
      status: 'error',
      type: 'not_directory',
      message: 'The Workspace path is not a directory.',
    });
    expect(enter).not.toHaveBeenCalled();
  });
  it('reports a missing Workspace directory with a not_found result', async () => {
    const missing = join(root, 'missing');
    const enter = vi.spyOn(WorkspaceBindingRepository.prototype, 'enter');

    const result = await enterWorkspaceTool.execute(context(), {
      path: missing,
    });

    expect(result).toEqual({
      status: 'error',
      type: 'not_found',
      message: 'The Workspace directory was not found.',
    });
    expect(enter).not.toHaveBeenCalled();
  });

  it('does not bind after cancellation during the canonical path probe', async () => {
    const probe = deferred<string>();
    vi.mocked(realpath).mockImplementationOnce(() => probe.promise);
    const controller = new AbortController();
    const cell = createWorkspaceRootCell(undefined);
    const enter = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'enter')
      .mockResolvedValue({
        status: 'bound',
        previousRoot: null,
        generation: 1,
      });
    const resultPromise = enterWorkspaceTool.execute(
      context({
        abortSignal: controller.signal,
        workspaceRoot: cell,
      }),
      { path: root },
    );

    await vi.waitFor(() => expect(realpath).toHaveBeenCalledWith(root));
    controller.abort();
    probe.resolve(root);

    await expect(resultPromise).rejects.toThrow(/aborted/u);
    expect(enter).not.toHaveBeenCalled();
    cell.beginStep();
    expect(cell.current()).toBeUndefined();
  });

  it('rejects the submitted path before probing it', async () => {
    const base = context();
    const runAs = vi.spyOn(base.tenantDb, 'runAs');
    const permissionPolicy = compileToolPermissionMap(
      {
        enter_workspace: {
          allow: true,
          reject: [{ field: 'path', literal: join(root, 'missing') }],
        },
      },
      'workspace-test',
    );

    const result = await runTool(
      enterWorkspaceTool,
      { path: join(root, 'missing') },
      context({ permissionPolicy, tenantDb: base.tenantDb }),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(runAs).not.toHaveBeenCalled();
  });

  it('requires exit_workspace to have its own permission group', async () => {
    const exit = vi.spyOn(WorkspaceBindingRepository.prototype, 'exit');
    const permissionPolicy = compileToolPermissionMap(
      { enter_workspace: { allow: true } },
      'workspace-test',
    );

    const result = await runTool(
      exitWorkspaceTool,
      {},
      context({ permissionPolicy }),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(exit).not.toHaveBeenCalled();
  });

  it('rejects a superseded delivery before probing the submitted path', async () => {
    vi.spyOn(
      WorkspaceBindingRepository.prototype,
      'isCurrentDelivery',
    ).mockResolvedValueOnce(false);
    const enter = vi.spyOn(WorkspaceBindingRepository.prototype, 'enter');

    const result = await enterWorkspaceTool.execute(context(), {
      path: join(root, 'missing'),
    });

    expect(result).toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'This Run cannot use this native executor.',
    });
    expect(enter).not.toHaveBeenCalled();
  });

  it('rejects a second Workspace transition in the same model step', async () => {
    const cell = {
      current: vi.fn(() => root),
      commit: vi.fn(),
      claimTransition: vi.fn(() => false),
    };
    const enter = vi.spyOn(WorkspaceBindingRepository.prototype, 'enter');

    const result = await enterWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      { path: root },
    );

    expect(result).toEqual({
      status: 'error',
      type: 'workspace_transition_conflict',
      message: 'Only one Workspace transition may run in a model step.',
    });
    expect(enter).not.toHaveBeenCalled();
    expect(cell.commit).not.toHaveBeenCalled();
  });

  it('rejects an exit after another Workspace transition in the same step', async () => {
    const cell = {
      current: vi.fn(() => root),
      commit: vi.fn(),
      claimTransition: vi.fn(() => false),
    };
    const exit = vi.spyOn(WorkspaceBindingRepository.prototype, 'exit');

    const result = await exitWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      {},
    );

    expect(result).toEqual({
      status: 'error',
      type: 'workspace_transition_conflict',
      message: 'Only one Workspace transition may run in a model step.',
    });
    expect(exit).not.toHaveBeenCalled();
  });

  it('lets the first enter own a slower fence before a same-step exit', async () => {
    const firstFence = deferred<boolean>();
    const secondFence = deferred<boolean>();
    secondFence.resolve(true);
    const delivery = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'isCurrentDelivery')
      .mockImplementationOnce(() => firstFence.promise)
      .mockImplementationOnce(() => secondFence.promise);
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter').mockResolvedValue({
      status: 'bound',
      previousRoot: null,
      generation: 1,
    });
    const cell = createWorkspaceRootCell(undefined);

    const first = enterWorkspaceTool.execute(context({ workspaceRoot: cell }), {
      path: root,
    });
    const second = exitWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      {},
    );

    await expect(second).resolves.toMatchObject({
      status: 'error',
      type: 'workspace_transition_conflict',
    });
    expect(delivery).toHaveBeenCalledTimes(1);
    firstFence.resolve(true);
    await expect(first).resolves.toMatchObject({
      status: 'success',
      root,
      state: 'bound',
    });
    cell.beginStep();
    expect(cell.current()).toBe(root);
  });

  it('lets the first enter own a slower fence before a same-step second enter', async () => {
    const nextRoot = join(root, 'next');
    await mkdir(nextRoot);
    const firstFence = deferred<boolean>();
    const secondFence = deferred<boolean>();
    secondFence.resolve(true);
    const delivery = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'isCurrentDelivery')
      .mockImplementationOnce(() => firstFence.promise)
      .mockImplementationOnce(() => secondFence.promise);
    const enter = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'enter')
      .mockResolvedValue({
        status: 'bound',
        previousRoot: null,
        generation: 1,
      });
    const cell = createWorkspaceRootCell(undefined);

    const first = enterWorkspaceTool.execute(context({ workspaceRoot: cell }), {
      path: root,
    });
    const second = enterWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      { path: nextRoot },
    );

    await expect(second).resolves.toMatchObject({
      status: 'error',
      type: 'workspace_transition_conflict',
    });
    expect(delivery).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenCalledTimes(0);
    firstFence.resolve(true);
    await expect(first).resolves.toMatchObject({
      status: 'success',
      root,
      state: 'bound',
    });
    cell.beginStep();
    expect(cell.current()).toBe(root);
  });

  it('records a canonical-path no_allow decision and does not bind', async () => {
    const alias = join(root, 'alias');
    const target = join(root, 'target');
    await mkdir(target);
    await writeFile(join(target, 'file.txt'), 'content');
    await symlink(target, alias);
    const decisions: Array<unknown> = [];
    const permissionPolicy = compileToolPermissionMap(
      {
        enter_workspace: {
          allow: [{ field: 'path', literal: alias }],
        },
      },
      'workspace-test',
    );
    const enter = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'enter')
      .mockResolvedValue({
        status: 'bound',
        previousRoot: null,
        generation: 1,
      });

    const result = await runTool(
      enterWorkspaceTool,
      { path: alias },
      context({
        permissionPolicy,
        onDerivedDecision: (decision) => decisions.push(decision),
      }),
      5,
    );

    expect(result).toMatchObject({
      status: 'error',
      type: 'permission_denied',
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      kind: 'canonical',
      url: target,
      decision: { decision: 'reject', reason: 'no_allow' },
    });
    expect(enter).not.toHaveBeenCalled();
  });

  it('binds when both submitted and canonical paths are allowed', async () => {
    const alias = join(root, 'alias');
    const target = join(root, 'target');
    await mkdir(target);
    await symlink(target, alias);
    const decisions: Array<unknown> = [];
    const permissionPolicy = compileToolPermissionMap(
      {
        enter_workspace: {
          allow: [
            { field: 'path', literal: alias },
            { field: 'path', literal: target },
          ],
        },
      },
      'workspace-test',
    );
    const enter = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'enter')
      .mockResolvedValue({
        status: 'bound',
        previousRoot: null,
        generation: 1,
      });

    const result = await runTool(
      enterWorkspaceTool,
      { path: alias },
      context({
        permissionPolicy,
        onDerivedDecision: (decision) => decisions.push(decision),
      }),
      5,
    );

    expect(result).toMatchObject({
      status: 'success',
      root: target,
      state: 'bound',
    });
    expect(decisions[0]).toMatchObject({
      kind: 'canonical',
      url: target,
      decision: { decision: 'allow' },
    });
    expect(enter).toHaveBeenCalledWith(
      expect.objectContaining({ root: target }),
    );
  });

  it('binds a root, switches it, and makes same-root entry a no-op', async () => {
    const cell = {
      current: vi.fn(() => root),
      commit: vi.fn(),
      claimTransition: vi.fn(() => true),
    };
    const enter = vi.spyOn(WorkspaceBindingRepository.prototype, 'enter');
    enter
      .mockResolvedValueOnce({
        status: 'bound',
        previousRoot: null,
        generation: 1,
      })
      .mockResolvedValueOnce({
        status: 'unchanged',
        previousRoot: root,
        generation: 1,
      })
      .mockResolvedValueOnce({
        status: 'switched',
        previousRoot: root,
        generation: 2,
      });
    const first = await enterWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      { path: root },
    );
    const same = await enterWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      { path: root },
    );
    const nextRoot = join(root, 'next');
    await mkdir(nextRoot);
    const switched = await enterWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      { path: nextRoot },
    );

    expect(first).toMatchObject({
      status: 'success',
      root,
      state: 'bound',
      authority: WORKSPACE_AUTHORITY,
    });
    expect(same).toMatchObject({ status: 'success', root, state: 'unchanged' });
    expect(switched).toMatchObject({
      status: 'success',
      root: nextRoot,
      state: 'switched',
    });
    expect(cell.commit).toHaveBeenCalledTimes(2);
    expect(cell.commit).toHaveBeenNthCalledWith(1, root);
    expect(cell.commit).toHaveBeenNthCalledWith(2, nextRoot);
  });

  it('returns executor_unavailable when the native identity is missing', async () => {
    const runAs = vi.fn();
    const result = await enterWorkspaceTool.execute(
      context({ nativeExecutorId: undefined, tenantDb: { runAs } }),
      { path: root },
    );

    expect(result).toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    });
  });

  it('returns the native authority error when exit identity is missing', async () => {
    const result = await exitWorkspaceTool.execute(
      context({ nativeExecutorId: undefined }),
      {},
    );

    expect(result).toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    });
  });

  it('does not commit a superseded entry attempt', async () => {
    const cell = {
      current: vi.fn(() => root),
      commit: vi.fn(),
      claimTransition: vi.fn(() => true),
    };
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter').mockResolvedValue({
      status: 'fence_lost',
    });

    const result = await enterWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      { path: root },
    );

    expect(result).toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'This Run cannot use this native executor.',
    });
    expect(cell.commit).not.toHaveBeenCalled();
  });

  it('does not commit a superseded exit attempt', async () => {
    const cell = {
      current: vi.fn(() => root),
      commit: vi.fn(),
      claimTransition: vi.fn(() => true),
    };
    vi.spyOn(WorkspaceBindingRepository.prototype, 'exit').mockResolvedValue({
      status: 'fence_lost',
    });

    const result = await exitWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      {},
    );

    expect(result).toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'This Run cannot use this native executor.',
    });
    expect(cell.commit).not.toHaveBeenCalled();
  });

  it('rejects a stale exit delivery before updating the binding', async () => {
    vi.spyOn(
      WorkspaceBindingRepository.prototype,
      'isCurrentDelivery',
    ).mockResolvedValueOnce(false);
    const cell = {
      current: vi.fn(() => root),
      commit: vi.fn(),
      claimTransition: vi.fn(() => true),
    };
    const exit = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'exit')
      .mockResolvedValue({
        status: 'cleared',
        previousRoot: root,
        generation: 2,
      });

    const result = await exitWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      {},
    );

    expect(result).toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'This Run cannot use this native executor.',
    });
    expect(exit).not.toHaveBeenCalled();
    expect(cell.commit).not.toHaveBeenCalled();
  });

  it('exits a binding and reports an unbound exit as harmless', async () => {
    const cell = {
      current: vi.fn(() => root),
      commit: vi.fn(),
      claimTransition: vi.fn(() => true),
    };
    const exit = vi.spyOn(WorkspaceBindingRepository.prototype, 'exit');
    exit
      .mockResolvedValueOnce({
        status: 'cleared',
        previousRoot: root,
        generation: 2,
      })
      .mockResolvedValueOnce({ status: 'unbound' });

    const cleared = await exitWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      {},
    );
    const unbound = await exitWorkspaceTool.execute(
      context({ workspaceRoot: cell }),
      {},
    );

    expect(cleared).toEqual({
      status: 'success',
      root: null,
      state: 'exited',
      previousRoot: root,
    });
    expect(unbound).toEqual({
      status: 'success',
      root: null,
      state: 'unbound',
    });
    expect(cell.commit).toHaveBeenCalledTimes(1);
    expect(cell.commit).toHaveBeenCalledWith(undefined);
  });
});
