/* eslint-disable typescript/no-unsafe-assignment -- a spied repository's mock call tuple and an `expect.any` matcher are `any`; every read is asserted through the typed spy signature. */
import { drizzle } from 'drizzle-orm/postgres-js';
import type {
  GitInspectResult,
  GitWorktreeAddResult,
} from '@workspace/git-executor';

import * as schema from '../db/schema';
import {
  type Checkout,
  type Repository,
  type WorktreeLease,
} from '../db/schema';
import { type Db, TenantDbService } from '../db/tenant-db.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { ExecutorGitError } from '../machines/executor-git-error';
import {
  type ExecutorGit,
  type ExecutorTarget,
} from '../machines/executor-git.service';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { asDouble } from '../testing/support';
import { compileToolPermissionMap } from '../tools/permissions/compile-permissions';
import {
  type CompiledPolicy,
  type PermissionGroup,
} from '../tools/permissions/types';
import {
  ChatCreationWorkspace,
  type CreationWorkspaceInput,
} from './chat-creation-workspace';
import { ChatCreationRecordRepository } from './chat-creation-record.repository';
import { WorkspaceBindingRepository } from './workspace-binding.repository';

/*
 * The Workspace step of one chat creation (openspec `chat-start-location`,
 * design D9 step 5): the availability gates, the four ordered path decisions
 * and what each rejection answers, the attempt that commits before the first
 * git write and stays on a later failure, and the bind or worktree the step
 * ends with.
 *
 * Git is the one thing this file fakes: the real surface is proved by
 * `workspace-worktree-creation.test.ts`, which runs it, and by the HTTP
 * integration suite. The two repositories that persist the attempt and the
 * binding are spied at their own seam, so the assertions read the rows the step
 * would write.
 */

const CREATED_AT = new Date('2026-10-24T00:00:00.000Z');
const OWNER = 'owner-1';
const CHAT_ID = '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10';
const HEAD = 'a'.repeat(40);
const ADDED_HEAD = 'b'.repeat(40);
const ROOT = '/srv/llame';
const DIRECTORY = '/srv/.llame-worktrees/llame/clear-field-0192';

function configWith(tools: Partial<LlameConfig['tools']> = {}): LlameConfig {
  return {
    ...BUILT_IN_DEFAULTS,
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      allowed: ['enter_workspace'],
      nativeExecutorId: 'host',
      ...tools,
    },
  };
}

function checkoutRow(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    ownerUserId: OWNER,
    repositoryId: '22222222-2222-4222-8222-222222222222',
    executorId: 'host',
    path: ROOT,
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

function leaseRow(overrides: Partial<WorktreeLease> = {}): WorktreeLease {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    ownerUserId: OWNER,
    chatId: CHAT_ID,
    checkoutId: '88888888-8888-4888-8888-888888888888',
    baseRef: 'main',
    baseCommit: ADDED_HEAD,
    createdAt: CREATED_AT,
    ...overrides,
  };
}

/** The git surface the step consumes, with every call recorded. */
function fakeGit(overrides: { readonly canonical?: string } = {}) {
  const canonicalPath = overrides.canonical ?? ROOT;
  const executors = {
    address: vi.fn((_target: ExecutorTarget, path: string) => path),
    canonical: vi.fn(() => Promise.resolve(canonicalPath)),
    canonicalTarget: vi.fn((_target: ExecutorTarget, path: string) =>
      Promise.resolve(path),
    ),
    executorPath: vi.fn((_target: ExecutorTarget, path: string) => path),
    exists: vi.fn(() => Promise.resolve(false)),
    inspect: vi.fn(
      (): Promise<GitInspectResult> =>
        Promise.resolve({
          status: 'ok',
          toplevel: ROOT,
          commonDir: `${ROOT}/.git`,
          linked: false,
          mainWorktree: null,
          remotes: [],
          branch: 'main',
          head: HEAD,
        }),
    ),
    removeWorktree: vi.fn(),
    worktreeAdd: vi.fn(
      (): Promise<GitWorktreeAddResult> =>
        Promise.resolve({
          status: 'ok',
          path: DIRECTORY,
          branch: 'llame/clear-field-0192',
          head: ADDED_HEAD,
        }),
    ),
  };
  return { git: asDouble<ExecutorGit>(executors), calls: executors };
}

function policy(group: PermissionGroup = { allow: true }): CompiledPolicy {
  return compileToolPermissionMap({ enter_workspace: group }, 'creation-test');
}

function makeWorkspace(options: {
  readonly git: ExecutorGit;
  readonly policy?: CompiledPolicy;
  readonly config?: LlameConfig;
}) {
  const tx = asDouble<Db>(drizzle.mock({ schema }));
  const tenantDb = new TenantDbService({
    transaction: async <T>(callback: (inner: Db) => Promise<T>) => callback(tx),
  });
  vi.spyOn(tenantDb, 'runAs').mockImplementation(
    async <T>(_userId: string, callback: (scoped: Db) => Promise<T>) =>
      callback(tx),
  );
  const appendAttempt = vi
    .spyOn(ChatCreationRecordRepository.prototype, 'appendAttempt')
    .mockResolvedValue(undefined);
  const bindAtCreation = vi
    .spyOn(WorkspaceBindingRepository.prototype, 'bindAtCreation')
    .mockResolvedValue({ status: 'bound', generation: 1 });
  const createCheckout = vi
    .spyOn(RepositoriesRepository.prototype, 'createCheckout')
    .mockImplementation((input) =>
      Promise.resolve(checkoutRow({ ...input, kind: 'worktree' })),
    );
  const createLease = vi
    .spyOn(RepositoriesRepository.prototype, 'createLease')
    .mockResolvedValue(leaseRow());
  const workspace = new ChatCreationWorkspace(
    tenantDb,
    { config: options.config ?? configWith() },
    options.git,
    options.policy ?? policy(),
  );
  return {
    workspace,
    appendAttempt,
    bindAtCreation,
    createCheckout,
    createLease,
  };
}

function input(
  overrides: Partial<CreationWorkspaceInput> = {},
): CreationWorkspaceInput {
  return {
    ownerUserId: OWNER,
    chatId: CHAT_ID,
    permissionMode: 'default',
    target: { executorId: 'host', machine: undefined, path: ROOT },
    checkout: checkoutRow(),
    repository: repositoryRow(),
    worktree: {},
    ...overrides,
  };
}

const worktreeInput = {
  name: {
    name: 'clear-field-0192',
    slug: 'clear-field-0192',
    branch: 'llame/clear-field-0192',
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatCreationWorkspace gates', () => {
  it('refuses a process that does not allowlist enter_workspace, before any decision', async () => {
    const { git, calls } = fakeGit();
    const { workspace, appendAttempt } = makeWorkspace({
      git,
      config: configWith({ allowed: [] }),
    });

    await expect(workspace.enter(input())).resolves.toMatchObject({
      status: 'bind_failed',
      code: 'tool_not_allowed',
      message: expect.stringContaining('tools.allowed'),
    });
    expect(calls.canonical).not.toHaveBeenCalled();
    expect(appendAttempt).not.toHaveBeenCalled();
  });

  it('refuses a local root on a process whose native executor is another id', async () => {
    const { git, calls } = fakeGit();
    const { workspace, appendAttempt } = makeWorkspace({
      git,
      config: configWith({ nativeExecutorId: 'other-host' }),
    });

    await expect(workspace.enter(input())).resolves.toMatchObject({
      status: 'bind_failed',
      code: 'executor_unavailable',
    });
    expect(calls.canonical).not.toHaveBeenCalled();
    expect(appendAttempt).not.toHaveBeenCalled();
  });

  it('refuses a local root on a process with no native executor', async () => {
    const { workspace } = makeWorkspace({
      git: fakeGit().git,
      config: configWith({ nativeExecutorId: undefined }),
    });

    await expect(workspace.enter(input())).resolves.toMatchObject({
      status: 'bind_failed',
      code: 'executor_unavailable',
      message:
        'The serving process holds no matching tools.nativeExecutorId, so it cannot bind a local root.',
    });
  });

  it('refuses a Machine the configuration no longer names', async () => {
    const { workspace } = makeWorkspace({ git: fakeGit().git });

    await expect(
      workspace.enter(
        input({
          target: {
            executorId: 'machine:nas',
            machine: 'nas',
            path: '/srv/llame',
          },
        }),
      ),
    ).resolves.toMatchObject({
      status: 'bind_failed',
      code: 'executor_unavailable',
      message: 'The resolved Machine is no longer configured.',
    });
  });
});

describe('ChatCreationWorkspace ordered decisions', () => {
  it('decides the submitted path first and stops before any probe', async () => {
    const { git, calls } = fakeGit();
    const { workspace, appendAttempt, bindAtCreation } = makeWorkspace({
      git,
      policy: policy({ allow: [{ field: 'path', literal: '/srv/elsewhere' }] }),
    });

    await expect(workspace.enter(input())).resolves.toMatchObject({
      status: 'bind_failed',
      code: 'permission_denied',
    });
    expect(calls.canonical).not.toHaveBeenCalled();
    expect(calls.inspect).not.toHaveBeenCalled();
    expect(bindAtCreation).not.toHaveBeenCalled();
    expect(appendAttempt).toHaveBeenCalledTimes(1);
    expect(appendAttempt.mock.calls[0]?.[0]).toMatchObject({
      ownerUserId: OWNER,
      chatId: CHAT_ID,
      decisions: [
        {
          path: ROOT,
          decision: { decision: 'reject', reason: 'no_allow' },
        },
      ],
    });
  });

  it('decides the canonical source clone before inspect', async () => {
    const { git, calls } = fakeGit({ canonical: '/srv/real/llame' });
    const { workspace, appendAttempt } = makeWorkspace({
      git,
      policy: policy({ allow: [{ field: 'path', literal: ROOT }] }),
    });

    await expect(workspace.enter(input())).resolves.toMatchObject({
      status: 'bind_failed',
      code: 'permission_denied',
    });
    expect(calls.inspect).not.toHaveBeenCalled();
    const recorded = appendAttempt.mock.calls[0]?.[0];
    expect(recorded?.decisions.map((entry) => entry.path)).toEqual([
      ROOT,
      '/srv/real/llame',
    ]);
  });

  it('decides the main tree git reports when it differs from the canonical clone', async () => {
    const { git, calls } = fakeGit();
    calls.inspect.mockResolvedValue({
      status: 'ok',
      toplevel: ROOT,
      commonDir: `${ROOT}/.git`,
      linked: true,
      mainWorktree: '/srv/main-llame',
      remotes: [],
      branch: 'main',
      head: HEAD,
    });
    const { workspace, appendAttempt } = makeWorkspace({
      git,
      policy: policy({ allow: [{ field: 'path', literal: ROOT }] }),
    });

    await expect(
      workspace.enter(input({ worktree: worktreeInput })),
    ).resolves.toMatchObject({
      status: 'bind_failed',
      code: 'permission_denied',
    });
    expect(calls.worktreeAdd).not.toHaveBeenCalled();
    expect(
      appendAttempt.mock.calls[0]?.[0]?.decisions.map((entry) => entry.path),
    ).toEqual([ROOT, ROOT, '/srv/main-llame']);
    expect(
      appendAttempt.mock.calls[0]?.[0]?.decisions[2]?.decision,
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('decides the canonical worktree directory before the add', async () => {
    const { git, calls } = fakeGit();
    const { workspace, appendAttempt, createCheckout } = makeWorkspace({
      git,
      policy: policy({ allow: [{ field: 'path', literal: ROOT }] }),
    });

    await expect(
      workspace.enter(input({ worktree: worktreeInput })),
    ).resolves.toMatchObject({
      status: 'bind_failed',
      code: 'permission_denied',
    });
    expect(calls.worktreeAdd).not.toHaveBeenCalled();
    expect(createCheckout).not.toHaveBeenCalled();
    const decisions = appendAttempt.mock.calls[0]?.[0]?.decisions ?? [];
    expect(decisions.map((entry) => entry.path)).toEqual([
      ROOT,
      ROOT,
      DIRECTORY,
    ]);
    expect(decisions.at(-1)?.decision).toMatchObject({
      decision: 'reject',
      reason: 'no_allow',
    });
  });

  it('records every decision as an allow in bypass mode', async () => {
    const { git } = fakeGit();
    const { workspace, appendAttempt } = makeWorkspace({
      git,
      policy: policy({ allow: [{ field: 'path', literal: '/never' }] }),
    });

    await expect(
      workspace.enter(
        input({ permissionMode: 'bypass', worktree: worktreeInput }),
      ),
    ).resolves.toMatchObject({ status: 'bound' });

    const decisions = appendAttempt.mock.calls[0]?.[0]?.decisions ?? [];
    expect(decisions).toHaveLength(3);
    for (const entry of decisions) {
      expect(entry.decision).toMatchObject({
        decision: 'allow',
        reason: 'permission_mode_bypass',
      });
    }
  });
});

describe('ChatCreationWorkspace failures name their cause', () => {
  it('reports a lost Machine link on the probe as machine_unavailable', async () => {
    const { git, calls } = fakeGit();
    calls.inspect.mockRejectedValue(
      new ExecutorGitError('machine_unavailable', 'The Machine link is gone.'),
    );
    const { workspace, appendAttempt, bindAtCreation } = makeWorkspace({ git });

    // The probe runs only when the request asks for a worktree: a plain bind
    // needs no inspection.
    await expect(
      workspace.enter(input({ worktree: worktreeInput })),
    ).resolves.toMatchObject({
      status: 'machine_unavailable',
      message: 'The Machine link is gone.',
    });
    expect(bindAtCreation).not.toHaveBeenCalled();
    expect(appendAttempt).toHaveBeenCalledTimes(1);
  });

  it('reports a daemon that predates the git methods as machine_update_required', async () => {
    const { git, calls } = fakeGit();
    calls.inspect.mockRejectedValue(
      new ExecutorGitError('machine_update_required', 'Update the daemon.'),
    );
    const { workspace } = makeWorkspace({ git });

    await expect(
      workspace.enter(input({ worktree: worktreeInput })),
    ).resolves.toMatchObject({
      status: 'machine_update_required',
      message: 'Update the daemon.',
    });
  });

  it('maps a refused canonical probe to permission_denied and an absent one to not_found', async () => {
    const unregistered = fakeGit();
    unregistered.calls.canonical.mockRejectedValue(
      new ExecutorGitError('path_not_registered', 'Outside the roots.'),
    );
    await expect(
      makeWorkspace({ git: unregistered.git }).workspace.enter(
        input({ worktree: worktreeInput }),
      ),
    ).resolves.toMatchObject({
      status: 'bind_failed',
      code: 'permission_denied',
      message: 'Outside the roots.',
    });

    const absent = fakeGit();
    absent.calls.canonical.mockRejectedValue(
      new ExecutorGitError('not_a_directory', 'No such directory.'),
    );
    await expect(
      makeWorkspace({ git: absent.git }).workspace.enter(
        input({ worktree: worktreeInput }),
      ),
    ).resolves.toMatchObject({
      status: 'bind_failed',
      code: 'not_found',
      message: 'No such directory.',
    });
  });

  it('reports a plan probe outside the roots as worktree_failed path_not_registered', async () => {
    const { git, calls } = fakeGit();
    calls.inspect.mockRejectedValue(
      new ExecutorGitError('path_not_registered', 'Outside the roots.'),
    );
    const { workspace } = makeWorkspace({ git });

    await expect(
      workspace.enter(input({ worktree: worktreeInput })),
    ).resolves.toEqual({
      status: 'worktree_failed',
      code: 'path_not_registered',
      message: 'Outside the roots.',
    });
  });

  it('keeps one attempt when a rejected decision ends the worktree plan', async () => {
    const { git, calls } = fakeGit();
    calls.canonicalTarget.mockRejectedValue(
      new ExecutorGitError(
        'invalid_path',
        'A worktree directory must be absolute.',
      ),
    );
    const { workspace, appendAttempt } = makeWorkspace({ git });

    await expect(
      workspace.enter(input({ worktree: worktreeInput })),
    ).resolves.toEqual({
      status: 'worktree_failed',
      message: 'A worktree directory must be absolute.',
    });
    expect(appendAttempt).toHaveBeenCalledTimes(1);
    expect(calls.worktreeAdd).not.toHaveBeenCalled();
  });

  it('answers worktree_failed with the bounded git error of a failed add', async () => {
    const { git, calls } = fakeGit();
    calls.worktreeAdd.mockResolvedValue({
      status: 'error',
      type: 'git_failed',
      stderr: 'fatal: could not create work tree dir',
    });
    const { workspace, createCheckout, createLease, bindAtCreation } =
      makeWorkspace({ git });

    await expect(
      workspace.enter(input({ worktree: worktreeInput })),
    ).resolves.toEqual({
      status: 'worktree_failed',
      message: 'fatal: could not create work tree dir',
    });
    expect(createCheckout).not.toHaveBeenCalled();
    expect(createLease).not.toHaveBeenCalled();
    expect(bindAtCreation).not.toHaveBeenCalled();
  });

  it('answers outcome_unknown with the directory the lost link can leave', async () => {
    const { git, calls } = fakeGit();
    calls.worktreeAdd.mockRejectedValue(
      new ExecutorGitError('machine_unavailable', 'The link was lost.', true),
    );
    const { workspace } = makeWorkspace({ git });

    const result = await workspace.enter(input({ worktree: worktreeInput }));
    expect(result).toMatchObject({
      status: 'outcome_unknown',
      leftDirectory: DIRECTORY,
    });
    expect(result).toHaveProperty('message', expect.stringContaining('lost'));
  });
});

describe('ChatCreationWorkspace binding', () => {
  it('binds the canonical checkout with no git write and records the attempt first', async () => {
    const { git, calls } = fakeGit();
    const { workspace, appendAttempt, bindAtCreation } = makeWorkspace({ git });

    await expect(workspace.enter(input())).resolves.toEqual({
      status: 'bound',
      root: ROOT,
      executorId: 'host',
    });
    expect(calls.worktreeAdd).not.toHaveBeenCalled();
    expect(bindAtCreation).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      ownerUserId: OWNER,
      executorId: 'host',
      root: ROOT,
    });
    expect(calls.inspect).not.toHaveBeenCalled();
    expect(appendAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      bindAtCreation.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('records the attempt before the worktree add, then commits the creation rows', async () => {
    const { git, calls } = fakeGit();
    const {
      workspace,
      appendAttempt,
      createCheckout,
      createLease,
      bindAtCreation,
    } = makeWorkspace({ git });

    await expect(
      workspace.enter(input({ worktree: worktreeInput })),
    ).resolves.toEqual({
      status: 'bound',
      root: DIRECTORY,
      executorId: 'host',
      worktree: {
        path: DIRECTORY,
        branch: 'llame/clear-field-0192',
        baseCommit: ADDED_HEAD,
      },
    });
    expect(appendAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      calls.worktreeAdd.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        path: DIRECTORY,
        kind: 'worktree',
        parentCheckoutId: expect.any(String),
        branch: 'llame/clear-field-0192',
        origin: 'created',
      }),
    );
    expect(createLease).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: OWNER,
        chatId: CHAT_ID,
        checkoutId: expect.any(String),
        baseCommit: ADDED_HEAD,
      }),
    );
    expect(bindAtCreation).toHaveBeenCalledWith({
      chatId: CHAT_ID,
      ownerUserId: OWNER,
      executorId: 'host',
      root: DIRECTORY,
    });
  });

  it('answers conflict when the Chat gained a message under the lock', async () => {
    const { git } = fakeGit();
    const { workspace, bindAtCreation } = makeWorkspace({ git });
    bindAtCreation.mockResolvedValue({ status: 'conflict' });

    await expect(workspace.enter(input())).resolves.toEqual({
      status: 'conflict',
    });
  });

  it('answers conflict when the worktree commit cannot bind', async () => {
    const { git } = fakeGit();
    const { workspace, bindAtCreation } = makeWorkspace({ git });
    bindAtCreation.mockResolvedValue({ status: 'conflict' });

    await expect(
      workspace.enter(input({ worktree: worktreeInput })),
    ).resolves.toEqual({ status: 'conflict' });
  });
});
