import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { isString } from '@workspace/runtime-safety';

import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import {
  formatMachineLocator,
  isMachineLocator,
} from '../machines/machine-locator';
import { readFsStatResult } from '../machines/machine-results';
import { isSshLocator } from '../ssh/ssh-locator';
import { type MachineConnector } from '../machines/machine-connector.service';
import { MachineIdentityMismatchError } from '../machines/machine-session';
import { verifyLocalMachine } from './local-machine';
import {
  MACHINE_FILE_BUDGET_MS,
  machineBudgetMs,
  machineCallAttemptKey,
  machineCallEnvelope,
  machineConnector,
  machineIdentityMismatchResult,
  machineNotFoundResult,
  machineReadResult,
  machineUnavailableResult,
  machineUnusableResult,
} from './machine-call';
import { type Tool, type ToolContext, type ToolResult } from './types';
import {
  applyBindingTransition,
  bindCanonicalRoot,
  boundResult,
  claimTransition,
  executorUnavailable,
  isCurrentDelivery,
  requireDerivedPermission,
  requireSubmittedPermission,
  transitionConflict,
  workspaceAuthority,
  type WorkspaceAuthority,
} from './workspace-binding';
import {
  readWorktreeRequest,
  type WorktreeRequest,
} from './workspace-worktree';
import { locatorContext } from './workspace-path';
import { enterWorktree } from './workspace-worktree-entry';
import { resolveMachinePath, type MachineTarget } from './workspace-path';

type EnterWorkspaceInput = {
  path: string;
  worktree?: { name?: string; baseRef?: string };
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

/** The canonical locator of an existing directory on one Machine. */
type CanonicalDirectory = { readonly locator: string };

/**
 * The literal path text a target names: the locator grammar splits a
 * read-selector-shaped suffix off a path, and a Workspace directory may itself
 * be named `build:2`, so the suffix is re-attached before anything resolves
 * the directory. The canonical locator the entry binds re-encodes the colon.
 */
function literalTargetPath(target: MachineTarget): string {
  return target.selector === undefined
    ? target.path
    : `${target.path}:${target.selector}`;
}

/**
 * The canonical locator of an existing directory on this process's own
 * Machine. The directory is resolved in process — the family runs here — but
 * only after the identity-checked handshake with the daemon behind the
 * Machine, so a worker whose `machines.local` names someone else's computer
 * never serves that Machine's filesystem unverified.
 */
async function localDirectory(
  context: ToolContext,
  target: MachineTarget,
): Promise<CanonicalDirectory | ToolResult> {
  const refusal = await verifyLocalMachine(context);

  if (refusal !== undefined) return refusal;

  try {
    const canonicalPath = await realpath(literalTargetPath(target));
    const entry = await stat(canonicalPath);

    if (!entry.isDirectory()) return notDirectory();

    const locator = formatMachineLocator(target.name, canonicalPath);

    return locator === undefined
      ? machineUnusableResult(target.name)
      : { locator };
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
  target: MachineTarget,
): Promise<CanonicalDirectory | ToolResult> {
  const outcome = await machineReadResult(target.name, async () => {
    const answer = readFsStatResult(
      await connector.request(
        target.name,
        'fs.stat',
        {
          envelope: machineCallEnvelope(
            context,
            machineBudgetMs(context, MACHINE_FILE_BUDGET_MS),
          ),
          path: literalTargetPath(target),
        },
        { signal: context.timeoutSignal ?? context.abortSignal },
      ),
    );

    if (answer === undefined) return machineUnusableResult(target.name);

    if (answer.kind === 'missing') return notFound();

    if (answer.kind !== 'directory' || answer.realPath === undefined) {
      return notDirectory();
    }

    const canonical = formatMachineLocator(target.name, answer.realPath);

    return canonical === undefined
      ? machineUnusableResult(target.name)
      : { status: 'success', root: canonical };
  });

  if (outcome.status === 'error') return outcome;
  const canonical = outcome['root'];

  return isString(canonical) ? { locator: canonical } : notFound();
}

/**
 * Enter one directory on the Machine the locator names. A bare absolute path
 * and a `machine://` locator take the same flow: the submitted and the
 * canonical locators are each evaluated by the `enter_workspace` group, the
 * binding records the canonical locator with the Machine name as executor,
 * and only a Workspace this process hosts runs in process.
 */
async function enterMachineWorkspace(
  context: ToolContext,
  entry: WorkspaceEntry,
): Promise<ToolResult> {
  const { target, submittedPath, worktree } = entry;
  const connector = machineConnector(context);

  // Without a `machines` section the feature does not exist. An unconfigured
  // name is refused without touching SSH; reachability is decided later.
  if (connector === undefined) {
    return invalidWorkspacePath('This path scheme is not available.');
  }

  if (!connector.isConfigured(target.name)) {
    return machineNotFoundResult(target.name);
  }

  const authority = workspaceAuthority(context, target.name);

  if ('status' in authority) return authority;

  if (!claimTransition(context)) return transitionConflict();

  const submittedRejection = requireSubmittedPermission(context, submittedPath);

  if (submittedRejection !== undefined) return submittedRejection;

  if (!(await isCurrentDelivery(context, authority.runId))) {
    return executorUnavailable();
  }

  const canonical = await canonicalEntryDirectory(context, connector, target);

  if ('result' in canonical) return canonical.result;

  context.abortSignal?.throwIfAborted();

  return worktree === undefined
    ? bindCanonicalRoot(context, authority, canonical.locator)
    : enterWorktreeEntry(context, authority, canonical.locator, worktree);
}

/** The canonical locator an entry binds, or the result that ends the call. */
type CanonicalEntry =
  | { readonly locator: string }
  | { readonly result: ToolResult };

/**
 * The canonical locator an entry binds, or the refusal that ends it: a
 * hopeless Machine never pays for a handshake the attempt already knows will
 * fail, and the canonical locator is admitted by its own derived decision.
 *
 * The reachability verdict is a boolean, so the refusal itself is read back: a
 * mismatched identity is its own result, never a plain unavailability. The
 * local Machine is reached in process after its own identity check inside
 * `localDirectory`, so it never spends a daemon request here.
 */
async function canonicalEntryDirectory(
  context: ToolContext,
  connector: MachineConnector,
  target: MachineTarget,
): Promise<CanonicalEntry> {
  if (
    !target.local &&
    !(await connector.reachable(target.name, machineCallAttemptKey(context)))
  ) {
    const refusal = connector.lastRefusal(target.name);

    return {
      result:
        refusal instanceof MachineIdentityMismatchError
          ? machineIdentityMismatchResult(target.name)
          : machineUnavailableResult(target.name),
    };
  }

  const canonicalResult = target.local
    ? await localDirectory(context, target)
    : await machineDirectory(context, connector, target);

  context.abortSignal?.throwIfAborted();

  if ('status' in canonicalResult) return { result: canonicalResult };

  const canonicalRejection = requireDerivedPermission(
    context,
    'canonical',
    canonicalResult.locator,
  );

  return canonicalRejection === undefined
    ? { locator: canonicalResult.locator }
    : { result: canonicalRejection };
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
  worktree: WorktreeRequest,
): Promise<ToolResult> {
  const outcome = await enterWorktree(context, {
    authority,
    canonical,
    name: worktree.name,
    baseRef: worktree.baseRef,
  });

  if (outcome.status === 'failed') return outcome.result;
  await applyBindingTransition(context, outcome.root, outcome.status);

  return boundResult(context, {
    root: outcome.root,
    state: outcome.status,
    generation: outcome.generation,
    worktree: outcome.worktree,
  });
}

/** One submitted entry: its Machine target, the text, and its worktree. */
type WorkspaceEntry = {
  readonly submittedPath: string;
  readonly target: MachineTarget;
  readonly worktree?: WorktreeRequest;
};

/**
 * The submitted call, validated and resolved before any probe: a name or base
 * ref git would refuse, a path a Workspace can never name, and a value with no
 * current Machine all fail here.
 */
function readEntry(
  context: ToolContext,
  input: EnterWorkspaceInput,
): WorkspaceEntry | ToolResult {
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

  // An entry names an absolute directory, never a Workspace-relative one and
  // never a `file:` alias: only the bare and the `machine://` forms resolve.
  if (!isMachineLocator(input.path) && !path.isAbsolute(input.path)) {
    return invalidWorkspacePath(
      'Workspace path must be absolute and contain no NUL bytes.',
    );
  }

  const target = resolveMachinePath(input.path, locatorContext(context));

  if (target.kind === 'invalid') return invalidWorkspacePath(target.message);

  if (target.kind === 'scheme') {
    return invalidWorkspacePath(
      isMachineLocator(input.path)
        ? 'A Workspace Machine locator must name a Machine and an absolute directory path.'
        : 'This path scheme is not available.',
    );
  }

  return {
    submittedPath: input.path,
    target,
    ...(input.worktree !== undefined && { worktree: request }),
  };
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
    const entry = readEntry(context, input);

    if ('status' in entry) return Promise.resolve(entry);

    return enterMachineWorkspace(context, entry);
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

    // Exit never touches the Machine and never pins the Run: it must clear the
    // binding while the Machine is offline, and a Machine root is reachable
    // from any worker, so the delivery fence alone decides (design D15).
    const result = await context.tenantDb.runAs(context.userId, (db) =>
      new WorkspaceBindingRepository(db).exit({
        chatId: context.chatId,
        ownerUserId: context.userId,
        runId,
        deliverySequence,
        attemptId: context.attemptId,
      }),
    );

    return exitReportedState(context, result);
  },
};

/** The state an Exit reports once its committed row is applied in process. */
async function exitReportedState(
  context: ToolContext,
  result: Awaited<ReturnType<WorkspaceBindingRepository['exit']>>,
): Promise<ToolResult> {
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
}

export function isWorkspaceTool(tool: Tool): boolean {
  return tool === enterWorkspaceTool || tool === exitWorkspaceTool;
}
