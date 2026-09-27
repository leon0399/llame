import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { loadPackagedToolDescription } from '../prompts/tool-descriptions';
import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import { evaluatePermission } from './permissions/evaluator';
import { permissionDeniedResult } from './permissions/messages';
import { type PermissionDecision } from './permissions/types';
import { type Tool, type ToolContext, type ToolResult } from './types';

/** Workspace chooses a working root; it is not an isolation boundary. */
export const WORKSPACE_AUTHORITY =
  "Workspace selects a working root but is not filesystem confinement; host operations retain the host user's authority.";

type EnterWorkspaceInput = { path: string };
type ExitWorkspaceInput = Record<never, never>;

type NativeAuthority = {
  readonly runId: string;
  readonly nativeExecutorId: string;
  readonly toolCallId: string;
};

function nativeAuthority(context: ToolContext): NativeAuthority | ToolResult {
  if (!context.runId || !context.nativeExecutorId || !context.toolCallId) {
    return {
      status: 'error',
      type: 'executor_unavailable',
      message: 'Native host authority is unavailable.',
    };
  }
  return {
    runId: context.runId,
    nativeExecutorId: context.nativeExecutorId,
    toolCallId: context.toolCallId,
  };
}

function invalidWorkspacePath(message: string): ToolResult {
  return { status: 'error', type: 'invalid_path', message };
}

function requireSubmittedPermission(
  context: ToolContext,
  submittedPath: string,
): ToolResult | undefined {
  const policy = context.permissionPolicy;
  if (policy === undefined) return permissionDeniedResult('no_allow');
  const decision = evaluatePermission(policy, {
    toolId: 'enter_workspace',
    args: { path: submittedPath },
  });
  return decision.decision === 'reject'
    ? permissionDeniedResult(decision.reason)
    : undefined;
}

function requireCanonicalPermission(
  context: ToolContext,
  canonicalPath: string,
): ToolResult | undefined {
  const policy = context.permissionPolicy;
  if (policy === undefined) return permissionDeniedResult('no_allow');
  const decision: PermissionDecision = evaluatePermission(policy, {
    toolId: 'enter_workspace',
    args: { path: canonicalPath },
  });
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
    if (!target.isDirectory()) {
      return {
        status: 'error',
        type: 'not_directory',
        message: 'The Workspace path is not a directory.',
      };
    }
    return { path: canonicalPath };
  } catch {
    return {
      status: 'error',
      type: 'not_found',
      message: 'The Workspace directory was not found.',
    };
  }
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

async function isCurrentDelivery(
  context: ToolContext,
  authority: NativeAuthority,
): Promise<boolean> {
  return context.tenantDb.runAs(context.userId, (db) =>
    new WorkspaceBindingRepository(db).isCurrentDelivery({
      runId: authority.runId,
      ownerUserId: context.userId,
      deliverySequence: context.nativeDeliverySequence,
    }),
  );
}

function claimTransition(context: ToolContext): ToolResult | undefined {
  return context.workspaceRoot !== undefined &&
    !context.workspaceRoot.claimTransition()
    ? transitionConflict()
    : undefined;
}

export const enterWorkspaceTool: Tool<EnterWorkspaceInput> = {
  id: 'enter_workspace',
  classification: 'execute_code',
  description: loadPackagedToolDescription('enter_workspace'),
  inputSchema: z.strictObject({ path: z.string().min(1) }),
  execute: async (context, input): Promise<ToolResult> => {
    const authority = nativeAuthority(context);
    if ('status' in authority) return authority;
    if (!path.isAbsolute(input.path) || input.path.includes('\0')) {
      return invalidWorkspacePath(
        'Workspace path must be absolute and contain no NUL bytes.',
      );
    }

    // runTool evaluates this same submitted value before execute. Keeping the
    // check here also preserves the order for trusted direct callers.
    const submittedRejection = requireSubmittedPermission(context, input.path);
    if (submittedRejection !== undefined) return submittedRejection;

    if (!(await isCurrentDelivery(context, authority))) {
      return executorUnavailable();
    }
    const conflict = claimTransition(context);
    if (conflict !== undefined) return conflict;

    const canonicalResult = await canonicalDirectory(input.path);
    if ('status' in canonicalResult) return canonicalResult;
    const canonical = canonicalResult.path;

    const canonicalRejection = requireCanonicalPermission(context, canonical);
    if (canonicalRejection !== undefined) return canonicalRejection;

    const result = await context.tenantDb.runAs(context.userId, (db) =>
      new WorkspaceBindingRepository(db).enter({
        chatId: context.chatId,
        ownerUserId: context.userId,
        runId: authority.runId,
        deliverySequence: context.nativeDeliverySequence,
        executorId: authority.nativeExecutorId,
        root: canonical,
      }),
    );
    if (result.status === 'fence_lost') return executorUnavailable();
    if (result.status !== 'unchanged') context.workspaceRoot?.commit(canonical);

    return {
      status: 'success',
      root: canonical,
      state: result.status,
      authority: WORKSPACE_AUTHORITY,
    };
  },
};

export const exitWorkspaceTool: Tool<ExitWorkspaceInput> = {
  id: 'exit_workspace',
  classification: 'write_low_risk',
  description: loadPackagedToolDescription('exit_workspace'),
  inputSchema: z.strictObject({}),
  execute: async (context): Promise<ToolResult> => {
    const authority = nativeAuthority(context);
    const deliverySequence = context.nativeDeliverySequence;
    if ('status' in authority || deliverySequence === undefined) {
      return 'status' in authority ? authority : executorUnavailable();
    }
    if (!(await isCurrentDelivery(context, authority))) {
      return executorUnavailable();
    }
    const conflict = claimTransition(context);
    if (conflict !== undefined) return conflict;

    context.abortSignal?.throwIfAborted();
    const result = await context.tenantDb.runAs(context.userId, (db) =>
      new WorkspaceBindingRepository(db).exit({
        chatId: context.chatId,
        ownerUserId: context.userId,
        runId: authority.runId,
        deliverySequence,
        executorId: authority.nativeExecutorId,
      }),
    );
    if (result.status === 'fence_lost') return executorUnavailable();
    if (result.status === 'cleared') {
      context.workspaceRoot?.commit(undefined);
      return {
        status: 'success',
        root: null,
        state: 'exited',
        previousRoot: result.previousRoot,
      };
    }
    return { status: 'success', root: null, state: 'unbound' };
  },
};

export function isWorkspaceTool(tool: Tool): boolean {
  return tool === enterWorkspaceTool || tool === exitWorkspaceTool;
}
