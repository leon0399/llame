import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { isString } from '@workspace/runtime-safety';

import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import {
  formatMachineLocator,
  isMachineLocator,
  parseMachineLocator,
} from '../machines/machine-locator';
import { readFsStatResult } from '../machines/machine-results';
import { isSshLocator } from '../ssh/ssh-locator';
import { type MachineConnector } from '../machines/machine-connector.service';
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
import { projectNativeFilePath } from './permissions/locator-projection';
import { type Tool, type ToolContext, type ToolResult } from './types';
import {
  applyBindingTransition,
  bindCanonicalRoot,
  boundResult,
  claimTransition,
  executorUnavailable,
  isCurrentDelivery,
  localAuthority,
  machineAuthority,
  requireDerivedPermission,
  requireSubmittedPermission,
  transitionConflict,
  type WorkspaceAuthority,
} from './workspace-binding';
import { readWorktreeRequest, type WorktreeName } from './workspace-worktree';
import { enterWorktree } from './workspace-worktree-entry';

type EnterWorkspaceInput = {
  path: string;
  worktree?: { name?: string; baseRef?: string };
};

/** The validated `worktree` object of one entry. */
type WorktreeEntry = {
  readonly name?: WorktreeName;
  readonly baseRef?: string;
};
type ExitWorkspaceInput = Record<never, never>;

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

/** One Machine entry: the submitted locator, its Machine, and its worktree. */
type MachineEntryRequest = {
  readonly submittedPath: string;
  readonly machine: { readonly name: string; readonly path: string };
  readonly worktree: WorktreeEntry | undefined;
};

/**
 * Enter one directory on the Machine the locator names. The submitted and the
 * canonical locators are each evaluated by the `enter_workspace` group, the
 * binding records the canonical one, and the Run is not pinned to a local
 * executor.
 */
async function enterMachineWorkspace(
  context: ToolContext,
  connector: MachineConnector,
  entry: MachineEntryRequest,
): Promise<ToolResult> {
  const { machine, submittedPath, worktree } = entry;
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

  const canonicalRejection = requireDerivedPermission(
    context,
    'canonical',
    canonicalResult.path,
  );
  if (canonicalRejection !== undefined) return canonicalRejection;

  context.abortSignal?.throwIfAborted();
  return worktree === undefined
    ? bindCanonicalRoot(context, authority, canonicalResult.path)
    : enterWorktreeEntry(context, authority, canonicalResult.path, worktree);
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
  worktree: WorktreeEntry | undefined,
): ToolResult | Promise<ToolResult> {
  const connector = machineConnector(context);
  if (connector === undefined)
    return invalidWorkspacePath('This path scheme is not available.');
  const machine = machineEntry(connector, path);
  return 'status' in machine
    ? machine
    : enterMachineWorkspace(context, connector, {
        submittedPath: path,
        machine,
        worktree,
      });
}

/**
 * One worktree entry after the source clone is decided: the flow decides the
 * main clone and the directory, appends the attempt, adds the worktree, and
 * commits the rows and the binding, and this applies the transition the
 * committed binding needs before it reports it.
 */
async function enterWorktreeEntry(
  context: ToolContext,
  authority: WorkspaceAuthority,
  canonical: string,
  worktree: WorktreeEntry,
): Promise<ToolResult> {
  const outcome = await enterWorktree(context, {
    executorId: authority.executorId,
    ...(authority.bindExecutorId !== undefined && {
      bindExecutorId: authority.bindExecutorId,
    }),
    machine: authority.machine?.name,
    canonical,
    name: worktree.name,
    baseRef: worktree.baseRef,
    decide: (kind, address) => requireDerivedPermission(context, kind, address),
  });
  if (outcome.status === 'failed') return outcome.result;
  await applyBindingTransition(context, outcome.root, outcome.status);
  return boundResult(context, authority, {
    root: outcome.root,
    state: outcome.status,
    generation: outcome.generation,
    worktree: outcome.worktree,
  });
}

/**
 * The submitted call, validated before any probe: a name or base ref git would
 * refuse, and a path a Workspace can never name, fail here.
 */
function readEntry(
  input: EnterWorkspaceInput,
): { readonly path: string; readonly worktree?: WorktreeEntry } | ToolResult {
  const request = readWorktreeRequest(input.worktree ?? {});
  if ('message' in request) {
    return { status: 'error', type: 'invalid_input', message: request.message };
  }
  if (input.path.includes('\0')) {
    return invalidWorkspacePath(
      'Workspace path must be absolute and contain no NUL bytes.',
    );
  }
  if (isSshLocator(input.path)) {
    return invalidWorkspacePath(
      'An ssh:// locator cannot be a Workspace root; Workspace selects a local or Machine directory.',
    );
  }
  return {
    path: input.path,
    ...(input.worktree !== undefined && { worktree: request }),
  };
}

/**
 * The local branch: the submitted path, the canonical path, and the binding,
 * each decided in that order, with the Run pinned to this native executor.
 */
async function enterLocalWorkspace(
  context: ToolContext,
  entry: { readonly path: string; readonly worktree?: WorktreeEntry },
): Promise<ToolResult> {
  const authority = localAuthority(context);
  if ('status' in authority) return authority;
  if (!path.isAbsolute(entry.path)) {
    return invalidWorkspacePath(
      'Workspace path must be absolute and contain no NUL bytes.',
    );
  }
  if (!claimTransition(context)) return transitionConflict();

  const submittedRejection = requireSubmittedPermission(
    context,
    projectNativeFilePath(entry.path),
  );
  if (submittedRejection !== undefined) return submittedRejection;
  if (!(await isCurrentDelivery(context, authority.runId))) {
    return executorUnavailable();
  }

  const canonicalResult = await canonicalDirectory(entry.path);
  context.abortSignal?.throwIfAborted();
  if ('status' in canonicalResult) return canonicalResult;
  const canonical = canonicalResult.path;
  const canonicalRejection = requireDerivedPermission(
    context,
    'canonical',
    canonical,
  );
  if (canonicalRejection !== undefined) return canonicalRejection;

  context.abortSignal?.throwIfAborted();
  return entry.worktree === undefined
    ? bindCanonicalRoot(context, authority, canonical)
    : enterWorktreeEntry(context, authority, canonical, entry.worktree);
}

export const enterWorkspaceTool: Tool<EnterWorkspaceInput> = {
  id: 'enter_workspace',
  classification: 'execute_code',
  description: loadPackagedToolDescription('enter_workspace'),
  inputSchema: z.strictObject({
    path: z.string().min(1),
    worktree: z
      .strictObject({
        name: z.string().min(1).optional(),
        baseRef: z.string().min(1).optional(),
      })
      .optional(),
  }),
  execute: (context, input): Promise<ToolResult> => {
    const entry = readEntry(input);
    if ('status' in entry) return Promise.resolve(entry);
    return isMachineLocator(entry.path)
      ? Promise.resolve(enterMachineEntry(context, entry.path, entry.worktree))
      : enterLocalWorkspace(context, entry);
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
