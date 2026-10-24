import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
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
import { PATH_NOT_REGISTERED_MESSAGE } from '@workspace/machine-protocol';
import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import { MachineConnector } from '../machines/machine-connector.service';
import {
  createProtocolPeer,
  type ProtocolPeerOptions,
} from '../testing/machine-protocol-peer';
import { SkillCatalog } from '../skills/skill-catalog';
import { McpRuntimeService } from '../mcp/mcp-runtime.service';
import {
  WorkspaceMcpClients,
  type WorkspaceMcpEntryState,
} from '../mcp/workspace-mcp-clients';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { resolveAdvertisedTools, TOOL_REGISTRY } from './registry';
import { runTool } from './runner';
import { AttemptToolAdditions } from './attempt-tool-additions';
import type { ToolContext } from './types';
import {
  MACHINE_WORKSPACE_AUTHORITY,
  WORKSPACE_AUTHORITY,
} from './workspace-binding';
import { enterWorkspaceTool, exitWorkspaceTool } from './workspace';
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

function seededAdditions() {
  const id = 'mcp__workspace__added';
  const executor = {
    id,
    description: 'Added tool.',
    classification: 'unverified' as const,
    inputSchema: z.strictObject({}),
    execute: () => ({ status: 'success' as const }),
  };
  const record: ToolSet = {};
  const additions = new AttemptToolAdditions({
    allowedToolRules: ['mcp__workspace__*'],
    callTimeoutSeconds: 15,
    boundExecutables: new Map([
      [
        id,
        {
          declaration: {
            id,
            description: executor.description,
            inputSchema: { type: 'object', properties: {} },
          },
          executor,
          server: 'workspace',
        },
      ],
    ]),
    createTool: (declaration) =>
      tool({
        description: declaration.description,
        inputSchema: z.strictObject({}),
        execute: () => ({ status: 'success' as const }),
      }),
  });
  additions.bindToolRecord(record);
  record[id] = tool({
    description: executor.description,
    inputSchema: z.strictObject({}),
    execute: () => ({ status: 'success' as const }),
  });
  return { additions, id, record };
}
function expectUnavailableAddition(
  additions: AttemptToolAdditions,
  record: ToolSet,
  id: string,
  toolContext: ToolContext,
): void {
  expect(record[id]).toBeDefined();
  const executor = additions.executorFor(id);
  if (executor === undefined) throw new Error('Missing retained executor.');
  const result = executor.execute(toolContext, {});
  expect(result).toMatchObject({
    status: 'error',
    type: 'not_available',
  });
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
function fakeWorkspaceMcp(state: WorkspaceMcpEntryState) {
  const operator = new McpRuntimeService({});
  const clients = new WorkspaceMcpClients(operator, {
    readConfig: () => Promise.resolve([]),
  });
  const startForChat = vi
    .spyOn(clients, 'startForChat')
    .mockResolvedValue(state);
  const stateForKey = vi.spyOn(clients, 'stateForKey').mockReturnValue(state);
  const transferAttempt = vi.spyOn(clients, 'transferAttempt');
  const addToAttempt = vi
    .spyOn(clients, 'addToAttempt')
    .mockResolvedValue(state);
  return {
    clients,
    operator,
    startForChat,
    stateForKey,
    transferAttempt,
    addToAttempt,
  };
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
  it('lists proactively eligible Workspace skills from the selected source', async () => {
    const operatorSource = join(root, 'operator-skills');
    const operatorPackage = join(operatorSource, 'shared');
    const workspacePackage = join(root, '.llame', 'skills', 'shared');
    const workspaceOnlyPackage = join(
      root,
      '.agents',
      'skills',
      'workspace-only',
    );
    await mkdir(operatorPackage, { recursive: true });
    await mkdir(workspacePackage, { recursive: true });
    await mkdir(workspaceOnlyPackage, { recursive: true });
    await writeFile(
      join(operatorPackage, 'SKILL.md'),
      '---\nname: shared\ndescription: Operator description\n---\n',
    );
    await writeFile(
      join(workspacePackage, 'SKILL.md'),
      '---\nname: shared\ndescription: Workspace description\n---\n',
    );
    await writeFile(
      join(workspaceOnlyPackage, 'SKILL.md'),
      '---\nname: workspace-only\ndescription: Workspace-only description\n---\n',
    );
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter').mockResolvedValue({
      status: 'bound',
      previousRoot: null,
      generation: 1,
    });

    const result = await enterWorkspaceTool.execute(
      context({
        skillCatalog: new SkillCatalog([operatorSource]),
      }),
      { path: root },
    );

    expect(result).toMatchObject({
      status: 'success',
      skills: [
        { name: 'shared', description: 'Workspace description' },
        {
          name: 'workspace-only',
          description: 'Workspace-only description',
        },
      ],
      skillsOmitted: 0,
    });
  });

  it('omits Workspace skills when the effective catalog is unavailable', async () => {
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter').mockResolvedValue({
      status: 'bound',
      previousRoot: null,
      generation: 1,
    });

    const result = await enterWorkspaceTool.execute(
      context({
        skillCatalog: {
          getSnapshot: () => ({
            available: false,
            directories: [],
            entries: [
              {
                name: 'unavailable-catalog-entry',
                description: 'Should not leak',
                proactive: true,
                sourceDirectory: join(root, '.llame', 'skills'),
                skillDirectory: join(
                  root,
                  '.llame',
                  'skills',
                  'unavailable-catalog-entry',
                ),
                available: true,
                diagnostics: [],
              },
            ],
            diagnostics: ['unavailable'],
          }),
        },
      }),
      { path: root },
    );

    expect(result).toMatchObject({
      status: 'success',
      root,
      skills: [],
      skillsOmitted: 0,
    });
  });

  it('returns only available proactive Workspace entries from the selected sources', async () => {
    const sources = [
      join(root, '.claude', 'skills'),
      join(root, '.agents', 'skills'),
      join(root, '.llame', 'skills'),
    ];
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter').mockResolvedValue({
      status: 'bound',
      previousRoot: null,
      generation: 1,
    });

    const entry = (
      name: string,
      overrides: Partial<{
        readonly available: boolean;
        readonly proactive: boolean;
        readonly description: string | null;
        readonly sourceDirectory: string | null;
      }> = {},
    ) => ({
      name,
      description: 'Workspace description',
      proactive: true,
      sourceDirectory: sources[2],
      skillDirectory: join(sources[2], name),
      available: true,
      diagnostics: [],
      ...overrides,
    });

    const result = await enterWorkspaceTool.execute(
      context({
        skillCatalog: {
          getSnapshot: () => ({
            available: true,
            directories: sources,
            entries: [
              entry('valid'),
              entry('unavailable', { available: false }),
              entry('manual', { proactive: false }),
              entry('missing-description', { description: null }),
              entry('missing-source', { sourceDirectory: null }),
              entry('operator', { sourceDirectory: '/operator/skills' }),
            ],
            diagnostics: [],
          }),
        },
      }),
      { path: root },
    );

    expect(result).toMatchObject({
      status: 'success',
      skills: [{ name: 'valid', description: 'Workspace description' }],
      skillsOmitted: 0,
    });
  });

  it('bounds the Workspace skill list', async () => {
    const source = join(root, '.llame', 'skills');
    for (let index = 0; index < 257; index += 1) {
      const name = `workspace-${String(index).padStart(3, '0')}`;
      const packageDirectory = join(source, name);
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(
        join(packageDirectory, 'SKILL.md'),
        `---\nname: ${name}\ndescription: Workspace skill ${index}\n---\n`,
      );
    }
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter').mockResolvedValue({
      status: 'bound',
      previousRoot: null,
      generation: 1,
    });

    const result = await enterWorkspaceTool.execute(
      context({ skillCatalog: new SkillCatalog([]) }),
      { path: root },
    );

    expect(result).toMatchObject({
      status: 'success',
      skillsOmitted: 1,
    });
    if (!('skills' in result) || !Array.isArray(result.skills)) {
      throw new Error('Workspace entry must return its skill list.');
    }
    expect(result.skills).toHaveLength(256);
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

  it('admits submitted and canonical paths under bypass with recorded provenance', async () => {
    const alias = join(root, 'alias');
    const target = join(root, 'target');
    await mkdir(target);
    await symlink(target, alias);
    const decisions: Array<unknown> = [];
    const admitted: Array<unknown> = [];
    const permissionPolicy = compileToolPermissionMap(
      {
        enter_workspace: {
          allow: true,
          reject: true,
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
        permissionMode: 'bypass' as const,
        onDerivedDecision: (decision) => decisions.push(decision),
      }),
      5,
      (decision) => {
        admitted.push(decision);
      },
    );

    expect(result).toMatchObject({
      status: 'success',
      root: target,
      state: 'bound',
    });
    expect(admitted).toEqual([
      {
        policyId: 'workspace-test',
        decision: 'allow',
        reason: 'permission_mode_bypass',
        reference: null,
      },
    ]);
    expect(decisions).toEqual([
      {
        kind: 'canonical',
        url: target,
        decision: {
          policyId: 'workspace-test',
          decision: 'allow',
          reason: 'permission_mode_bypass',
          reference: null,
        },
      },
    ]);
    expect(enter).toHaveBeenCalledWith(
      expect.objectContaining({ root: target }),
    );
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
  it('keeps Workspace MCP state and transfers only a started attempt', async () => {
    const { additions } = seededAdditions();
    additions.disableAll();
    const state: WorkspaceMcpEntryState = {
      key: { chatId: 'chat-1', root, generation: 1 },
      servers: [
        { id: 'workspace', state: 'available' },
        { id: 'other', state: 'available' },
      ],
    };
    const mcp = fakeWorkspaceMcp(state);
    const cell = {
      current: vi.fn(() => undefined),
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
      });

    const first = await enterWorkspaceTool.execute(
      context({
        workspaceRoot: cell,
        workspaceMcp: mcp.clients,
        toolAdditions: additions,
      }),
      { path: root },
    );
    const same = await enterWorkspaceTool.execute(
      context({
        workspaceRoot: cell,
        workspaceMcp: mcp.clients,
        toolAdditions: additions,
      }),
      { path: root },
    );

    expect(first).toMatchObject({
      status: 'success',
      state: 'bound',
      mcpServers: state.servers,
    });
    expect(same).toMatchObject({
      status: 'success',
      state: 'unchanged',
      mcpServers: [
        {
          id: 'workspace',
          state: 'available',
          reason: 'shadows from the next Run',
        },
        { id: 'other', state: 'available' },
      ],
    });
    expect(mcp.startForChat).toHaveBeenCalledOnce();
    expect(mcp.stateForKey).toHaveBeenCalledOnce();
    expect(mcp.addToAttempt).toHaveBeenCalledOnce();
    expect(mcp.transferAttempt).toHaveBeenCalledOnce();
    await mcp.clients.onModuleDestroy();
    await mcp.operator.stop();
  });

  it('does not disable retained Workspace tools on an initial bind', async () => {
    const { additions, id } = seededAdditions();
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter').mockResolvedValue({
      status: 'bound',
      previousRoot: null,
      generation: 1,
    });

    await enterWorkspaceTool.execute(
      context({
        workspaceRoot: createWorkspaceRootCell(undefined),
        toolAdditions: additions,
      }),
      { path: root },
    );

    const executor = additions.executorFor(id);
    if (executor === undefined) throw new Error('expected retained executor');
    expect(executor.execute(context(), {})).toEqual({
      status: 'success',
    });
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

  it('exits without a local executor, fencing on the delivery alone', async () => {
    // A Machine Workspace's Chat may live on a worker with no local native
    // executor, and exit must clear the binding while the Machine is offline,
    // so the exit fence binds the delivered attempt and no executor id.
    const exit = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'exit')
      .mockResolvedValue({
        status: 'cleared',
        previousRoot: root,
        generation: 2,
      });

    const result = await exitWorkspaceTool.execute(
      context({ nativeExecutorId: undefined }),
      {},
    );

    expect(result).toEqual({
      status: 'success',
      root: null,
      state: 'exited',
      previousRoot: root,
    });
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit.mock.calls[0]?.[0]).toMatchObject({
      runId: 'run-1',
      deliverySequence: 4,
    });
    expect(exit.mock.calls[0]?.[0]).not.toHaveProperty('bindExecutorId');
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
  it('disables retained additions after exit and root switch', async () => {
    const exitFixture = seededAdditions();
    vi.spyOn(WorkspaceBindingRepository.prototype, 'exit').mockResolvedValue({
      status: 'cleared',
      previousRoot: root,
      generation: 2,
    });
    const exitContext = context({
      workspaceRoot: createWorkspaceRootCell(root),
      toolAdditions: exitFixture.additions,
    });
    await expect(
      exitWorkspaceTool.execute(exitContext, {}),
    ).resolves.toMatchObject({
      state: 'exited',
    });
    expectUnavailableAddition(
      exitFixture.additions,
      exitFixture.record,
      exitFixture.id,
      exitContext,
    );

    const switchFixture = seededAdditions();
    const nextRoot = join(root, 'next');
    await mkdir(nextRoot);
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter').mockResolvedValue({
      status: 'switched',
      previousRoot: root,
      generation: 2,
    });
    const switchContext = context({
      workspaceRoot: createWorkspaceRootCell(root),
      toolAdditions: switchFixture.additions,
    });
    await expect(
      enterWorkspaceTool.execute(switchContext, { path: nextRoot }),
    ).resolves.toMatchObject({ state: 'switched' });
    expectUnavailableAddition(
      switchFixture.additions,
      switchFixture.record,
      switchFixture.id,
      switchContext,
    );
  });
});

const MACHINE_HOSTS = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: { devl: { destination: 'box' } },
};

function machineConnectorFor(options: ProtocolPeerOptions = {}) {
  const peer = createProtocolPeer(options);
  return {
    peer,
    connector: new MachineConnector({
      machines: MACHINE_HOSTS,
      hubVersion: '9.9.9',
      transportFactory: peer.factory,
      handshakeTimeoutMs: 2000,
    }),
  };
}

describe('Machine Workspace entry', () => {
  beforeEach(() => {
    vi.spyOn(
      WorkspaceBindingRepository.prototype,
      'isCurrentDelivery',
    ).mockResolvedValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

  const STAT_DIRECTORY = {
    value: { kind: 'directory', isLink: false, realPath: '/srv/app' },
  };

  it('binds the directory the daemon resolved and leaves the Run unpinned', async () => {
    const enter = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'enter')
      .mockResolvedValue({
        status: 'bound',
        previousRoot: null,
        generation: 1,
      });
    const { connector } = machineConnectorFor({
      answers: { 'fs.stat': STAT_DIRECTORY },
    });

    await expect(
      enterWorkspaceTool.execute(context({ machines: connector }), {
        path: 'machine://devl/srv/app',
      }),
    ).resolves.toEqual({
      status: 'success',
      root: 'machine://devl/srv/app',
      state: 'bound',
      authority: MACHINE_WORKSPACE_AUTHORITY,
      skills: [],
      skillsOmitted: 0,
      mcpServers: [],
    });

    const input = enter.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      chatId: 'chat-1',
      ownerUserId: 'owner-1',
      executorId: 'machine:devl',
      root: 'machine://devl/srv/app',
      runId: 'run-1',
      deliverySequence: 4,
    });
    expect(Object.hasOwn(input ?? {}, 'bindExecutorId')).toBe(false);
  });

  it('carries the call deadline to the stat and refuses a missing directory', async () => {
    const request = vi.spyOn(MachineConnector.prototype, 'request');
    const enter = vi.spyOn(WorkspaceBindingRepository.prototype, 'enter');
    const { connector } = machineConnectorFor({
      answers: { 'fs.stat': { value: { kind: 'missing', isLink: false } } },
    });
    const controller = new AbortController();

    await expect(
      enterWorkspaceTool.execute(
        context({ machines: connector, abortSignal: controller.signal }),
        { path: 'machine://devl/srv/app' },
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'not_found',
      message: 'The Workspace directory was not found.',
    });
    expect(request).toHaveBeenCalledWith('devl', 'fs.stat', expect.anything(), {
      signal: controller.signal,
    });
    expect(enter).not.toHaveBeenCalled();
  });

  it('refuses a Machine path that is not a directory', async () => {
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter');
    const { connector } = machineConnectorFor({
      answers: { 'fs.stat': { value: { kind: 'file', isLink: false } } },
    });

    await expect(
      enterWorkspaceTool.execute(context({ machines: connector }), {
        path: 'machine://devl/srv/app/a.ts',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'not_directory',
      message: 'The Workspace path is not a directory.',
    });
  });

  it('refuses a directory stat that reports no real path', async () => {
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter');
    const { connector } = machineConnectorFor({
      answers: { 'fs.stat': { value: { kind: 'directory', isLink: false } } },
    });

    await expect(
      enterWorkspaceTool.execute(context({ machines: connector }), {
        path: 'machine://devl/srv/app',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'not_directory',
      message: 'The Workspace path is not a directory.',
    });
  });

  it('refuses a stat whose real path cannot be a locator', async () => {
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter');
    const { connector } = machineConnectorFor({
      answers: {
        'fs.stat': {
          value: {
            kind: 'directory',
            isLink: false,
            realPath: '/srv/nu\u0000ll',
          },
        },
      },
    });

    await expect(
      enterWorkspaceTool.execute(context({ machines: connector }), {
        path: 'machine://devl/srv/app',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'machine_protocol_error',
      message: 'The Machine "devl" answered an unusable result.',
    });
  });

  it('reports the Machine refusal of the stat as its own result', async () => {
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter');
    const { connector } = machineConnectorFor({
      answers: { 'fs.stat': { error: 'path_not_registered' } },
    });

    await expect(
      enterWorkspaceTool.execute(context({ machines: connector }), {
        path: 'machine://devl/srv/app',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'path_not_registered',
      message: PATH_NOT_REGISTERED_MESSAGE,
    });
  });

  it('refuses a Machine entry without a Run identity', async () => {
    const { connector } = machineConnectorFor();

    await expect(
      enterWorkspaceTool.execute(
        context({ machines: connector, runId: undefined }),
        { path: 'machine://devl/srv/app' },
      ),
    ).resolves.toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'This Run cannot bind a Workspace.',
    });
  });

  it('refuses an unconfigured Machine without opening a link', async () => {
    const { peer, connector } = machineConnectorFor();

    await expect(
      enterWorkspaceTool.execute(context({ machines: connector }), {
        path: 'machine://nope/srv/app',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'machine_not_found',
      message: 'No Machine named "nope" is configured.',
    });
    expect(peer.sessions).toHaveLength(0);
  });

  it('requires a Machine locator that names an absolute directory', async () => {
    const { peer, connector } = machineConnectorFor();

    await expect(
      enterWorkspaceTool.execute(context({ machines: connector }), {
        path: 'machine://devl',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'invalid_path',
      message:
        'A Workspace Machine locator must name a Machine and an absolute directory path.',
    });
    expect(peer.sessions).toHaveLength(0);
  });

  it('keeps the machine scheme unknown without a machines section', async () => {
    await expect(
      enterWorkspaceTool.execute(context(), { path: 'machine://devl/srv/app' }),
    ).resolves.toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'This path scheme is not available.',
    });
  });

  it('refuses a Machine entry this delivery may not bind', async () => {
    vi.spyOn(
      WorkspaceBindingRepository.prototype,
      'isCurrentDelivery',
    ).mockResolvedValue(false);
    const { peer, connector } = machineConnectorFor();

    await expect(
      enterWorkspaceTool.execute(context({ machines: connector }), {
        path: 'machine://devl/srv/app',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'executor_unavailable',
      message: 'This Run cannot use this native executor.',
    });
    expect(peer.sessions).toHaveLength(0);
  });

  it('refuses an unreachable Machine', async () => {
    const { connector } = machineConnectorFor({
      openFailure: () => 'ssh: connect to host box port 22: Connection refused',
    });

    await expect(
      enterWorkspaceTool.execute(context({ machines: connector }), {
        path: 'machine://devl/srv/app',
      }),
    ).resolves.toEqual({
      status: 'error',
      type: 'machine_unavailable',
      message: 'The Machine "devl" is unavailable.',
    });
  });

  it('allows one Workspace transition per model step', async () => {
    vi.spyOn(WorkspaceBindingRepository.prototype, 'enter').mockResolvedValue({
      status: 'bound',
      previousRoot: null,
      generation: 1,
    });
    const { connector } = machineConnectorFor({
      answers: { 'fs.stat': STAT_DIRECTORY },
    });
    const entering = context({
      machines: connector,
      workspaceRoot: createWorkspaceRootCell('machine://devl/srv/app'),
    });

    await expect(
      enterWorkspaceTool.execute(entering, { path: 'machine://devl/srv/app' }),
    ).resolves.toMatchObject({ status: 'success' });
    await expect(
      enterWorkspaceTool.execute(entering, { path: 'machine://devl/srv/app' }),
    ).resolves.toEqual({
      status: 'error',
      type: 'workspace_transition_conflict',
      message: 'Only one Workspace transition may run in a model step.',
    });
  });

  it('pins the local executor on a local entry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workspace-pin-'));
    const enter = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'enter')
      .mockResolvedValue({
        status: 'bound',
        previousRoot: null,
        generation: 1,
      });
    try {
      await enterWorkspaceTool.execute(context(), { path: directory });
      expect(enter).toHaveBeenCalledWith(
        expect.objectContaining({
          executorId: 'worker-1',
          bindExecutorId: 'worker-1',
        }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('pins the local executor on exit when the Run has one', async () => {
    const exit = vi
      .spyOn(WorkspaceBindingRepository.prototype, 'exit')
      .mockResolvedValue({ status: 'unbound' });

    await expect(exitWorkspaceTool.execute(context(), {})).resolves.toEqual({
      status: 'success',
      root: null,
      state: 'unbound',
    });
    expect(exit).toHaveBeenCalledWith(
      expect.objectContaining({ bindExecutorId: 'worker-1', runId: 'run-1' }),
    );
  });
});
