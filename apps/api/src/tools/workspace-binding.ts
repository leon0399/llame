import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import { machineExecutorId } from '../machines/machine-locator';
import {
  type WorkspaceMcpEntryState,
  type WorkspaceMcpKey,
} from '../mcp/workspace-mcp-clients';
import { boundSkillCatalog } from '../skills/skill-prompt-baseline';
import { type SkillCatalogPort } from '../skills/skill-catalog';
import { workspaceSkillSources } from '../skills/workspace-skill-sources';
import { admitPermission } from './permissions/admit';
import { projectNativeFilePath } from './permissions/locator-projection';
import { permissionDeniedResult } from './permissions/messages';
import {
  type ToolContext,
  type ToolErrorResult,
  type ToolResult,
} from './types';
import { type WorktreeBinding } from './workspace-worktree-entry';

/*
 * Everything a Workspace transition binds and reports, apart from the two tool
 * objects themselves: the authority an entry carries, the `enter_workspace`
 * decisions of one entry, the fence and the delivery check, the binding write,
 * and the observation it returns.
 *
 * `enter_workspace` is the tool id for every decision, so one compiled group
 * decides the submitted spelling, the canonical source clone, the main clone
 * git reports, and the computed worktree directory. A submitted spelling is not
 * a derived locator: the model wrote it, so it is decided without a provenance
 * record. A derived one is recorded with its kind, so stored provenance tells
 * the records of one worktree call apart.
 */

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

/**
 * The executor a Workspace transition binds, and the fence it applies. An
 * absolute host path pins the Run to the local executor; a Machine Workspace
 * binds `machine:<name>` without pinning anything, because the Run stays free
 * to use `file:` aliases and other Machines and needs no local executor at all.
 */
export type WorkspaceAuthority = {
  readonly runId: string;
  readonly toolCallId: string;
  /** The executor id the Chat binds: the local executor, or `machine:<name>`. */
  readonly executorId: string;
  /** The executor this transition pins the Run to; absent leaves it unbound. */
  readonly bindExecutorId?: string;
  /** The Machine this Workspace names, when it names one. */
  readonly machine?: { readonly name: string; readonly path: string };
};

export function localAuthority(
  context: ToolContext,
): WorkspaceAuthority | ToolResult {
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
export function machineAuthority(
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
export function authorityDisclosure(authority: WorkspaceAuthority): string {
  return authority.machine === undefined
    ? WORKSPACE_AUTHORITY
    : MACHINE_WORKSPACE_AUTHORITY;
}

/** One submitted entry path under the `enter_workspace` group. */
export function requireSubmittedPermission(
  context: ToolContext,
  submittedPath: string,
): ToolErrorResult | undefined {
  const decision = admitPermission(context, (evaluate) =>
    evaluate({
      toolId: 'enter_workspace',
      args: { path: submittedPath },
    }),
  );
  if (decision === undefined) return permissionDeniedResult('no_allow');
  return decision.decision === 'reject'
    ? permissionDeniedResult(decision.reason)
    : undefined;
}

/**
 * One server-derived entry path, recorded with the kind that tells the records
 * of a worktree call apart. A rejection ends the call before the write it
 * guards.
 */
export function requireDerivedPermission(
  context: ToolContext,
  kind: 'canonical' | 'main_clone' | 'worktree_directory',
  address: string,
): ToolErrorResult | undefined {
  const decision = admitPermission(context, (evaluate) =>
    evaluate({
      toolId: 'enter_workspace',
      args: { path: projectNativeFilePath(address) },
    }),
  );
  if (decision === undefined) return permissionDeniedResult('no_allow');
  context.onDerivedDecision?.({ kind, url: address, decision });
  return decision.decision === 'reject'
    ? permissionDeniedResult(decision.reason)
    : undefined;
}

export function executorUnavailable(): ToolResult {
  return {
    status: 'error',
    type: 'executor_unavailable',
    message: 'This Run cannot use this native executor.',
  };
}

export function transitionConflict(): ToolResult {
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

export async function isCurrentDelivery(
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

export function claimTransition(context: ToolContext): boolean {
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

export async function bindCanonicalRoot(
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
  return boundResult(context, authority, {
    root: canonical,
    state: result.status,
    generation: result.generation,
  });
}

/**
 * The observation of a committed binding: the root, its state, the authority it
 * discloses, the Workspace skills it can reach, and its MCP servers. A worktree
 * entry adds the worktree it created.
 */
export async function boundResult(
  context: ToolContext,
  authority: WorkspaceAuthority,
  binding: {
    readonly root: string;
    readonly state: 'bound' | 'switched' | 'unchanged';
    readonly generation: number;
    readonly worktree?: WorktreeBinding;
  },
): Promise<ToolResult> {
  const mcpServers = await workspaceMcpServers(
    context,
    binding.root,
    binding.generation,
    binding.state !== 'unchanged',
  );
  return {
    status: 'success',
    root: binding.root,
    state: binding.state,
    authority: authorityDisclosure(authority),
    ...workspaceSkillResult(context.skillCatalog, binding.root),
    mcpServers,
    ...(binding.worktree !== undefined && { worktree: binding.worktree }),
  };
}

/**
 * The local effects of a binding that changed: a switch drops the previous
 * root's MCP servers and declarations, and any other outcome commits the new
 * root to the Run's Workspace cell.
 */
export async function applyBindingTransition(
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
