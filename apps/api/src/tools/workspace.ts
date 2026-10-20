import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { isString } from '@workspace/runtime-safety';

import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import {
  formatMachineLocator,
  isMachineLocator,
  machineExecutorId,
  parseMachineLocator,
} from '../machines/machine-locator';
import { readFsStatResult } from '../machines/machine-results';
import { isSshLocator } from '../ssh/ssh-locator';
import { type MachineConnector } from '../machines/machine-connector.service';
import { boundSkillCatalog } from '../skills/skill-prompt-baseline';
import { type SkillCatalogPort } from '../skills/skill-catalog';
import { workspaceSkillSources } from '../skills/workspace-skill-sources';
import {
  MACHINE_FILE_BUDGET_MS,
  machineBudgetMs,
  machineCallAttemptKey,
  machineCallEnvelope,
  machineConnector,
  machineNotFoundResult,
  machineReadResult,
  machineUnavailableResult,
  machineUnusableResult,
} from './machine-call';
import { admitPermission } from './permissions/admit';
import { evaluatePermission } from './permissions/evaluator';
import { projectNativeFilePath } from './permissions/locator-projection';
import { permissionDeniedResult } from './permissions/messages';
import {
  type WorkspaceMcpEntryState,
  type WorkspaceMcpKey,
} from '../mcp/workspace-mcp-clients';
import { type Tool, type ToolContext, type ToolResult } from './types';

/** Workspace chooses a working root; it is not an isolation boundary. */
export const WORKSPACE_AUTHORITY =
  "Workspace selects a working root but is not filesystem confinement; host operations retain the host user's authority.";

/**
 * The same disclosure for a Machine Workspace: the root is remote, and the
 * authority the model's operations carry is the Machine's own OS user, which
 * every hub user bound to that Machine shares.
 */
export const MACHINE_WORKSPACE_AUTHORITY =
  "Workspace selects a working root on the Machine; Machine operations run as that Machine's own OS user without sandboxing, which every hub user bound to it shares, and its registered roots bound addressing only.";

type EnterWorkspaceInput = { path: string };
type ExitWorkspaceInput = Record<never, never>;

/**
 * The executor a Workspace transition binds, and the fence it applies. An
 * absolute host path pins the Run to the local executor; a Machine Workspace
 * binds `machine:<name>` without pinning anything, because the Run stays free
 * to use `file:` aliases and other Machines and needs no local executor at all.
 */
type WorkspaceAuthority = {
  readonly runId: string;
  readonly toolCallId: string;
  /** The executor id the Chat binds: the local executor, or `machine:<name>`. */
  readonly executorId: string;
  /** The executor this transition pins the Run to; absent leaves it unbound. */
  readonly bindExecutorId?: string;
  /** The Machine this Workspace names, when it names one. */
  readonly machine?: { readonly name: string; readonly path: string };
};

function localAuthority(context: ToolContext): WorkspaceAuthority | ToolResult {
  if (!context.runId || !context.nativeExecutorId || !context.toolCallId) {
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    };
  }
  return {
    runId: context.runId,
    toolCallId: context.toolCallId,
    executorId: context.nativeExecutorId,
    bindExecutorId: context.nativeExecutorId,
  };
}

/**
 * A Machine entry needs no local executor: it needs the Run identity the fence
 * and the durable attempt are keyed by, and nothing else.
 */
function machineAuthority(
  context: ToolContext,
  machine: { readonly name: string; readonly path: string },
): WorkspaceAuthority | ToolResult {
  if (!context.runId || !context.toolCallId) {
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: 'This Run cannot bind a Workspace.',
    };
  }
  return {
    runId: context.runId,
    toolCallId: context.toolCallId,
    executorId: machineExecutorId(machine.name),
    machine,
  };
}

/** The authority text one bound root discloses; the Machine's own when remote. */
function authorityDisclosure(authority: WorkspaceAuthority): string {
  return authority.machine === undefined
    ? WORKSPACE_AUTHORITY
    : MACHINE_WORKSPACE_AUTHORITY;
}

function invalidWorkspacePath(message: string): ToolResult {
  return { status: 'error', type: 'invalid_path', message };
}

function notFound(): ToolResult {
  return {
    status: 'error',
    type: 'not_found',
    message: 'The Workspace directory was not found.',
  };
}

function notDirectory(): ToolResult {
  return {
    status: 'error',
    type: 'not_directory',
    message: 'The Workspace path is not a directory.',
  };
}

function requireSubmittedPermission(
  context: ToolContext,
  submittedPath: string,
): ToolResult | undefined {
  const decision = admitPermission(context, (policy) =>
    evaluatePermission(policy, {
      toolId: 'enter_workspace',
      args: { path: submittedPath },
    }),
  );
  if (decision === undefined) return permissionDeniedResult('no_allow');
  return decision.decision === 'reject'
    ? permissionDeniedResult(decision.reason)
    : undefined;
}

function requireCanonicalPermission(
  context: ToolContext,
  canonicalPath: string,
): ToolResult | undefined {
  const decision = admitPermission(context, (policy) =>
    evaluatePermission(policy, {
      toolId: 'enter_workspace',
      args: { path: canonicalPath },
    }),
  );
  if (decision === undefined) return permissionDeniedResult('no_allow');
  context.onDerivedDecision?.({
    kind: 'canonical',
    url: canonicalPath,
    decision,
  });
  return decision.decision === 'reject'
    ? permissionDeniedResult(decision.reason)
    : undefined;
}

type CanonicalDirectory = { readonly path: string };

async function canonicalDirectory(
  submittedPath: string,
): Promise<CanonicalDirectory | ToolResult> {
  try {
    const canonicalPath = await realpath(submittedPath);
    const target = await stat(canonicalPath);
    if (!target.isDirectory()) return notDirectory();
    return { path: canonicalPath };
  } catch {
    return notFound();
  }
}

/**
 * The canonical locator of an existing Machine directory: the daemon's own
 * `realPath` inside the registered roots, rendered by the hub. A refusal —
 * including a path no registered root contains — is the Machine's answer, and
 * an answer this hub cannot use never becomes a binding.
 */
async function machineDirectory(
  context: ToolContext,
  connector: MachineConnector,
  machine: { readonly name: string; readonly path: string },
): Promise<CanonicalDirectory | ToolResult> {
  const outcome = await machineReadResult(machine.name, async () => {
    const answer = readFsStatResult(
      await connector.request(
        machine.name,
        'fs.stat',
        {
          envelope: machineCallEnvelope(
            context,
            machineBudgetMs(context, MACHINE_FILE_BUDGET_MS),
          ),
          path: machine.path,
        },
        { signal: context.timeoutSignal ?? context.abortSignal },
      ),
    );
    if (answer === undefined) return machineUnusableResult(machine.name);
    if (answer.kind === 'missing') return notFound();
    if (answer.kind !== 'directory' || answer.realPath === undefined) {
      return notDirectory();
    }
    const canonical = formatMachineLocator(machine.name, answer.realPath);
    return canonical === undefined
      ? machineUnusableResult(machine.name)
      : { status: 'success', root: canonical };
  });
  if (outcome.status === 'error') return outcome;
  const canonical = outcome['root'];
  return isString(canonical) ? { path: canonical } : notFound();
}

function executorUnavailable(): ToolResult {
  return {
    status: 'error',
    type: 'executor_unavailable',
    message: 'This Run cannot use this native executor.',
  };
}

function transitionConflict(): ToolResult {
  return {
    status: 'error',
    type: 'workspace_transition_conflict',
    message: 'Only one Workspace transition may run in a model step.',
  };
}
type WorkspaceSkillResult = {
  readonly skills: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
  }>;
  readonly skillsOmitted: number;
};

function workspaceSkillResult(
  catalog: SkillCatalogPort | undefined,
  root: string,
): WorkspaceSkillResult {
  if (catalog === undefined) return { skills: [], skillsOmitted: 0 };

  const sources = workspaceSkillSources(root);
  const snapshot = catalog.getSnapshot(sources);
  if (!snapshot.available) return { skills: [], skillsOmitted: 0 };

  const workspaceEntries = snapshot.entries.filter(
    (entry) =>
      entry.available &&
      entry.proactive &&
      entry.description !== null &&
      entry.sourceDirectory !== null &&
      sources.includes(entry.sourceDirectory),
  );
  const bounded = boundSkillCatalog(workspaceEntries);
  return {
    skills: bounded.entries,
    skillsOmitted: bounded.omitted,
  };
}

async function isCurrentDelivery(
  context: ToolContext,
  runId: string,
): Promise<boolean> {
  return context.tenantDb.runAs(context.userId, (db) =>
    new WorkspaceBindingRepository(db).isCurrentDelivery({
      runId,
      ownerUserId: context.userId,
      deliverySequence: context.nativeDeliverySequence,
    }),
  );
}

function claimTransition(context: ToolContext): boolean {
  return (
    context.workspaceRoot === undefined ||
    context.workspaceRoot.claimTransition()
  );
}

async function workspaceMcpServers(
  context: ToolContext,
  root: string,
  generation: number,
  start: boolean,
): Promise<WorkspaceMcpEntryState['servers']> {
  const clients = context.workspaceMcp;
  if (clients === undefined) return [];
  const key: WorkspaceMcpKey = {
    chatId: context.chatId,
    root,
    generation,
  };
  const state = start
    ? await clients.startForChat(key)
    : clients.stateForKey(key);
  if (start) clients.transferAttempt(context.chatId, key);
  if (state === undefined) return [];
  if (!start) {
    return state.servers.map((server) =>
      context.toolAdditions?.hasWorkspaceDeclaration(server.id) &&
      !context.toolAdditions.hasAvailableWorkspaceDeclaration(server.id)
        ? { ...server, reason: 'shadows from the next Run' }
        : server,
    );
  }
  if (context.toolAdditions === undefined) return state.servers;
  const added = await clients.addToAttempt(key, context.toolAdditions);
  return added.servers;
}

async function bindCanonicalRoot(
  context: ToolContext,
  authority: WorkspaceAuthority,
  canonical: string,
): Promise<ToolResult> {
  const result = await context.tenantDb.runAs(context.userId, (db) =>
    new WorkspaceBindingRepository(db).enter({
      chatId: context.chatId,
      ownerUserId: context.userId,
      runId: authority.runId,
      deliverySequence: context.nativeDeliverySequence,
      executorId: authority.executorId,
      root: canonical,
      ...(authority.bindExecutorId !== undefined && {
        bindExecutorId: authority.bindExecutorId,
      }),
    }),
  );
  if (result.status === 'fence_lost') return executorUnavailable();
  await applyBindingTransition(context, canonical, result.status);
  const mcpServers = await workspaceMcpServers(
    context,
    canonical,
    result.generation,
    result.status !== 'unchanged',
  );
  return {
    status: 'success',
    root: canonical,
    state: result.status,
    authority: authorityDisclosure(authority),
    ...workspaceSkillResult(context.skillCatalog, canonical),
    mcpServers,
  };
}

/**
 * The local effects of a binding that changed: a switch drops the previous
 * root's MCP servers and declarations, and any other outcome commits the new
 * root to the Run's Workspace cell.
 */
async function applyBindingTransition(
  context: ToolContext,
  canonical: string,
  state: 'bound' | 'switched' | 'unchanged',
): Promise<void> {
  if (state === 'switched') {
    context.toolAdditions?.disableAll();
    await context.workspaceMcp?.stopForChat(context.chatId);
  }
  if (state !== 'unchanged') {
    context.workspaceRoot?.commit(canonical);
  }
}

/**
 * Enter one directory on the Machine the locator names. The submitted and the
 * canonical locators are each evaluated by the `enter_workspace` group, the
 * binding records the canonical one, and the Run is not pinned to a local
 * executor.
 */
async function enterMachineWorkspace(
  context: ToolContext,
  connector: MachineConnector,
  submittedPath: string,
  machine: { readonly name: string; readonly path: string },
): Promise<ToolResult> {
  const authority = machineAuthority(context, machine);
  if ('status' in authority) return authority;
  if (!claimTransition(context)) return transitionConflict();

  const submittedRejection = requireSubmittedPermission(
    context,
    projectNativeFilePath(submittedPath),
  );
  if (submittedRejection !== undefined) return submittedRejection;

  if (!(await isCurrentDelivery(context, authority.runId))) {
    return executorUnavailable();
  }

  // The attempt's reachability verdict first: a hopeless Machine must not pay
  // a handshake timeout for an entry the attempt already knows will fail.
  if (
    !(await connector.reachable(machine.name, machineCallAttemptKey(context)))
  ) {
    return machineUnavailableResult(machine.name);
  }

  const canonicalResult = await machineDirectory(context, connector, machine);
  context.abortSignal?.throwIfAborted();
  if ('status' in canonicalResult) return canonicalResult;

  const canonicalRejection = requireCanonicalPermission(
    context,
    canonicalResult.path,
  );
  if (canonicalRejection !== undefined) return canonicalRejection;

  context.abortSignal?.throwIfAborted();
  return bindCanonicalRoot(context, authority, canonicalResult.path);
}

/**
 * The Machine a submitted `machine://` entry path names, or the refusal it
 * earns. The caller has already established that the path is a Machine locator.
 */
function machineEntry(
  connector: MachineConnector,
  submittedPath: string,
): { readonly name: string; readonly path: string } | ToolResult {
  const parsed = parseMachineLocator(submittedPath);
  if (parsed.kind !== 'path') {
    return invalidWorkspacePath(
      'A Workspace Machine locator must name a Machine and an absolute directory path.',
    );
  }
  // An unconfigured name is refused without touching SSH, and a configured one
  // is the entry target; the reachability of the Machine is decided later.
  return connector.isConfigured(parsed.name)
    ? { name: parsed.name, path: parsed.path }
    : machineNotFoundResult(parsed.name);
}

/**
 * The Machine branch of `enter_workspace`: without a `machines` section the
 * feature does not exist and the scheme stays unknown, exactly as it was
 * before this change; a refused locator is its own result; a configured
 * Machine is entered.
 */
function enterMachineEntry(
  context: ToolContext,
  path: string,
): ToolResult | Promise<ToolResult> {
  const connector = machineConnector(context);
  if (connector === undefined)
    return invalidWorkspacePath('This path scheme is not available.');
  const machine = machineEntry(connector, path);
  return 'status' in machine
    ? machine
    : enterMachineWorkspace(context, connector, path, machine);
}

export const enterWorkspaceTool: Tool<EnterWorkspaceInput> = {
  id: 'enter_workspace',
  classification: 'execute_code',
  description: loadPackagedToolDescription('enter_workspace'),
  inputSchema: z.strictObject({ path: z.string().min(1) }),
  execute: async (context, input): Promise<ToolResult> => {
    if (input.path.includes('\0')) {
      return invalidWorkspacePath(
        'Workspace path must be absolute and contain no NUL bytes.',
      );
    }
    if (isMachineLocator(input.path))
      return enterMachineEntry(context, input.path);
    if (isSshLocator(input.path))
      return invalidWorkspacePath(
        'An ssh:// locator cannot be a Workspace root; Workspace selects a local or Machine directory.',
      );

    const authority = localAuthority(context);
    if ('status' in authority) return authority;
    if (!path.isAbsolute(input.path)) {
      return invalidWorkspacePath(
        'Workspace path must be absolute and contain no NUL bytes.',
      );
    }

    if (!claimTransition(context)) return transitionConflict();

    const submittedRejection = requireSubmittedPermission(
      context,
      projectNativeFilePath(input.path),
    );
    if (submittedRejection !== undefined) return submittedRejection;

    if (!(await isCurrentDelivery(context, authority.runId))) {
      return executorUnavailable();
    }

    const canonicalResult = await canonicalDirectory(input.path);
    context.abortSignal?.throwIfAborted();
    if ('status' in canonicalResult) return canonicalResult;
    const canonical = canonicalResult.path;

    const canonicalRejection = requireCanonicalPermission(context, canonical);
    if (canonicalRejection !== undefined) return canonicalRejection;

    context.abortSignal?.throwIfAborted();
    return bindCanonicalRoot(context, authority, canonical);
  },
};

export const exitWorkspaceTool: Tool<ExitWorkspaceInput> = {
  id: 'exit_workspace',
  classification: 'write_low_risk',
  description: loadPackagedToolDescription('exit_workspace'),
  inputSchema: z.strictObject({}),
  execute: async (context): Promise<ToolResult> => {
    const { runId, toolCallId } = context;
    const deliverySequence = context.nativeDeliverySequence;
    if (!runId || !toolCallId || deliverySequence === undefined) {
      return executorUnavailable();
    }
    if (!claimTransition(context)) return transitionConflict();

    if (!(await isCurrentDelivery(context, runId))) {
      return executorUnavailable();
    }
    context.abortSignal?.throwIfAborted();
    // Exit never touches the Machine: it must clear the binding while the
    // Machine is offline, and a worker with no local executor fences on the
    // delivery alone rather than refusing the exit.
    const result = await context.tenantDb.runAs(context.userId, (db) =>
      new WorkspaceBindingRepository(db).exit({
        chatId: context.chatId,
        ownerUserId: context.userId,
        runId,
        deliverySequence,
        ...(context.nativeExecutorId !== undefined && {
          bindExecutorId: context.nativeExecutorId,
        }),
      }),
    );
    if (result.status === 'fence_lost') return executorUnavailable();
    if (result.status === 'cleared') {
      context.workspaceRoot?.commit(undefined);
      context.toolAdditions?.disableAll();
      await context.workspaceMcp?.stopForChat(context.chatId);
      return {
        status: 'success',
        root: null,
        state: 'exited',
        previousRoot: result.previousRoot,
      };
    }
    await context.workspaceMcp?.stopForChat(context.chatId);
    return { status: 'success', root: null, state: 'unbound' };
  },
};

export function isWorkspaceTool(tool: Tool): boolean {
  return tool === enterWorkspaceTool || tool === exitWorkspaceTool;
}
