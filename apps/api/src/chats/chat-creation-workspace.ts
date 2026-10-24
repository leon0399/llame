import { Inject, Injectable } from '@nestjs/common';

import { type Checkout, type Repository } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { ExecutorGitError } from '../machines/executor-git-error';
import {
  ExecutorGit,
  type ExecutorTarget,
} from '../machines/executor-git.service';
import { isConfiguredExecutor } from './chat-creation-executors';
import { ChatCreationRecordRepository } from './chat-creation-record.repository';
import { WorkspaceBindingRepository } from './workspace-binding.repository';
import {
  type BindFailureCode,
  type WorktreeFailureCode,
} from './dto/chat-creation.dto';
import {
  bypassAllow,
  evaluatePermission,
} from '../tools/permissions/evaluator';
import { projectNativeFilePath } from '../tools/permissions/locator-projection';
import { permissionDeniedResult } from '../tools/permissions/messages';
import { TOOL_PERMISSION_POLICY } from '../tools/permissions/permission-policy.module';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import {
  type CompiledPolicy,
  type PermissionDecision,
} from '../tools/permissions/types';
import { type ToolErrorResult } from '../tools/types';
import {
  addCreationWorktree,
  planCreationWorktree,
  type CreationWorktreeInput,
} from '../tools/workspace-worktree-creation';
import { type WorktreeRequest } from '../tools/workspace-worktree';

/*
 * The Workspace step of one chat creation (openspec `chat-start-location`,
 * design D9 step 5, and `workspace-entry` "The Workspace binding is Chat-scoped
 * and persists across Runs").
 *
 * It is the Run-free twin of `enter_workspace`: the same ordered path decisions
 * in the same `enter_workspace` group, with the same availability gates, but
 * the authority comes from the owner's authenticated request, so there is no
 * Run, no tool call, and no fence. Every decision is recorded in the Chat's
 * creation record; the attempt commits in its own transaction before the first
 * git write, and it stays when a later step fails.
 */

/** The one tool group every path decision of this step evaluates. */
const WORKSPACE_TOOL_ID = 'enter_workspace';

/** One decided path, in the order the step took it. */
type RecordedDecision = {
  readonly path: string;
  readonly decision: PermissionDecision;
};

/** What the step needs to authorize, record, and bind one location. */
export type CreationWorkspaceInput = {
  readonly ownerUserId: string;
  readonly chatId: string;
  readonly permissionMode: PermissionMode;
  readonly target: ExecutorTarget;
  readonly checkout: Checkout;
  readonly repository: Repository;
  /** The request's validated `worktree` object; an empty one binds the checkout. */
  readonly worktree: WorktreeRequest;
};

/** Every outcome of the step, in the response's closed status set. */
export type CreationWorkspaceResult =
  | {
      readonly status: 'bound';
      readonly root: string;
      readonly executorId?: string;
      readonly worktree?: { path: string; branch: string; baseCommit: string };
    }
  /** No location resolved: the message still stores and its Run still starts. */
  | { readonly status: 'unbound' }
  | {
      readonly status: 'bind_failed';
      readonly code?: BindFailureCode;
      readonly message: string;
    }
  | {
      readonly status: 'worktree_failed';
      readonly code?: WorktreeFailureCode;
      readonly message: string;
      readonly leftDirectory?: string;
    }
  | {
      readonly status: 'machine_unavailable' | 'machine_update_required';
      readonly message: string;
    }
  | {
      readonly status: 'outcome_unknown';
      readonly message: string;
      readonly leftDirectory?: string;
    }
  /** The Chat gained a message, a Run, or another binding under the lock. */
  | { readonly status: 'conflict' };

/** The decisions one request collected, before its attempt is written. */
type DecisionLog = {
  readonly input: CreationWorkspaceInput;
  readonly decisions: Array<RecordedDecision>;
};

@Injectable()
export class ChatCreationWorkspace {
  constructor(
    private readonly tenantDb: TenantDbService,
    @Inject(InstanceConfigService)
    private readonly config: Pick<InstanceConfigService, 'config'>,
    private readonly executors: ExecutorGit,
    @Inject(TOOL_PERMISSION_POLICY)
    private readonly policy: CompiledPolicy,
  ) {}

  /**
   * Gate, decide, record, and bind. The attempt is appended after every
   * decision the plan makes and before the add, so a rejection keeps its record
   * and no git write runs without one.
   */
  async enter(input: CreationWorkspaceInput): Promise<CreationWorkspaceResult> {
    const gate = this.availabilityGate(input.target);
    if (gate !== null) return gate;
    return this.decideAndEnter({ input, decisions: [] });
  }

  /** The four ordered decisions, then the bind or the worktree they decide. */
  private async decideAndEnter(
    log: DecisionLog,
  ): Promise<CreationWorkspaceResult> {
    const submitted = this.decideOrRefuse(log, log.input.checkout.path);
    if (submitted !== undefined) return this.finish(log, submitted);

    const canonical = await this.canonicalOrFailure(log);
    if ('status' in canonical) return canonical;
    const decided = this.decideOrRefuse(log, canonical.path);
    if (decided !== undefined) return this.finish(log, decided);
    return this.createOrBind(log, canonical.path);
  }

  /** The canonical source clone, decided before any git call. */
  private async canonicalOrFailure(
    log: DecisionLog,
  ): Promise<{ readonly path: string } | CreationWorkspaceResult> {
    try {
      return {
        path: await this.executors.canonical(
          log.input.target,
          log.input.checkout.path,
        ),
      };
    } catch (error) {
      return this.finish(log, probeFailure(error));
    }
  }

  /** Bind the checkout, or create the worktree the request asked for. */
  private async createOrBind(
    log: DecisionLog,
    canonical: string,
  ): Promise<CreationWorkspaceResult> {
    const { input } = log;
    const planInput = {
      target: input.target,
      source: { checkout: input.checkout, repository: input.repository },
      canonical,
      name: input.worktree.name,
      baseRef: input.worktree.baseRef,
    };
    if (planInput.name === undefined && planInput.baseRef === undefined) {
      await this.recordAttempt(log);
      return this.bindAtCheckout(input, canonical);
    }
    return this.createWorktree(log, planInput);
  }

  /** The worktree plan, its recorded attempt, and the add that follows them. */
  private async createWorktree(
    log: DecisionLog,
    planInput: Omit<CreationWorktreeInput, 'decide'>,
  ): Promise<CreationWorkspaceResult> {
    const plan = await planCreationWorktree(this.executors, {
      ...planInput,
      decide: (_kind, address) => this.decideOrRefuse(log, address),
    });
    await this.recordAttempt(log);
    if ('status' in plan) return workspaceFailure(plan.result);

    const outcome = await addCreationWorktree(
      {
        tenantDb: this.tenantDb,
        userId: log.input.ownerUserId,
        chatId: log.input.chatId,
      },
      this.executors,
      { ...planInput, decide: () => undefined },
      plan,
    );
    if (outcome.status === 'conflict') return { status: 'conflict' };
    if (outcome.status === 'failed') return workspaceFailure(outcome.result);
    return {
      status: 'bound',
      root: outcome.root,
      executorId: log.input.target.executorId,
      worktree: outcome.worktree,
    };
  }

  /** One path under the `enter_workspace` group, recorded as it is decided. */
  private decideOrRefuse(
    log: DecisionLog,
    address: string,
  ): ToolErrorResult | undefined {
    const decision =
      log.input.permissionMode === 'bypass'
        ? bypassAllow(this.policy.id)
        : evaluatePermission(this.policy, {
            toolId: WORKSPACE_TOOL_ID,
            args: { path: projectNativeFilePath(address) },
          });
    log.decisions.push({ path: address, decision });
    return decision.decision === 'reject'
      ? permissionDeniedResult(decision.reason)
      : undefined;
  }

  /** One availability gate, before any decision or probe. */
  private availabilityGate(
    target: ExecutorTarget,
  ): CreationWorkspaceResult | null {
    if (!this.config.config.tools.allowed.includes(WORKSPACE_TOOL_ID)) {
      return {
        status: 'bind_failed',
        code: 'tool_not_allowed',
        message: `${WORKSPACE_TOOL_ID} is not in tools.allowed, so this Chat cannot bind a Workspace.`,
      };
    }
    if (
      target.machine === undefined &&
      this.config.config.tools.nativeExecutorId !== target.executorId
    ) {
      return {
        status: 'bind_failed',
        code: 'executor_unavailable',
        message:
          'The serving process holds no matching tools.nativeExecutorId, so it cannot bind a local root.',
      };
    }
    if (
      target.machine !== undefined &&
      !isConfiguredExecutor(target.executorId, this.config.config)
    ) {
      return {
        status: 'bind_failed',
        code: 'executor_unavailable',
        message: 'The resolved Machine is no longer configured.',
      };
    }
    return null;
  }

  /** Record the decisions so far, then answer the failure they earned. */
  private async finish(
    log: DecisionLog,
    result: ToolErrorResult,
  ): Promise<CreationWorkspaceResult> {
    await this.recordAttempt(log);
    return workspaceFailure(result);
  }

  /** One attempt in its own transaction, before any git write. */
  private async recordAttempt(log: DecisionLog): Promise<void> {
    await this.tenantDb.runAs(log.input.ownerUserId, (tx) =>
      new ChatCreationRecordRepository(tx).appendAttempt({
        ownerUserId: log.input.ownerUserId,
        chatId: log.input.chatId,
        decisions: [...log.decisions],
      }),
    );
  }

  /** Bind the resolved checkout, with no worktree and no git call. */
  private async bindAtCheckout(
    input: CreationWorkspaceInput,
    root: string,
  ): Promise<CreationWorkspaceResult> {
    const result = await this.tenantDb.runAs(input.ownerUserId, (tx) =>
      new WorkspaceBindingRepository(tx).bindAtCreation({
        chatId: input.chatId,
        ownerUserId: input.ownerUserId,
        executorId: input.target.executorId,
        root,
      }),
    );
    return result.status === 'bound'
      ? { status: 'bound', root, executorId: input.target.executorId }
      : { status: 'conflict' };
  }
}

/** A read-only probe's typed failure, in the tool result vocabulary. */
function probeFailure(error: unknown): ToolErrorResult {
  if (!(error instanceof ExecutorGitError)) throw error;
  switch (error.code) {
    case 'machine_unavailable':
    case 'machine_update_required':
      return { status: 'error', type: error.code, message: error.message };
    case 'path_not_registered':
      return {
        status: 'error',
        type: 'permission_denied',
        message: error.message,
      };
    case 'executor_unavailable':
      return {
        status: 'error',
        type: 'executor_unavailable',
        message: error.message,
      };
    default:
      return { status: 'error', type: 'not_found', message: error.message };
  }
}

/** The binding's own refusal, or undefined when the failure is elsewhere. */
function bindFailure(
  result: ToolErrorResult,
): CreationWorkspaceResult | undefined {
  switch (result.type) {
    case 'permission_denied':
      return bindFailed('permission_denied', result.message);
    case 'executor_unavailable':
      return bindFailed('executor_unavailable', result.message);
    case 'not_found':
    case 'invalid_path':
    case 'not_directory':
      return bindFailed('not_found', result.message);
    default:
      return undefined;
  }
}

function bindFailed(
  code: BindFailureCode,
  message: string,
): CreationWorkspaceResult {
  return { status: 'bind_failed', code, message };
}

/**
 * The Worktree entry's outcome, in the response status set: a git failure names
 * its cause, and every other failure is the binding's own refusal.
 */
function workspaceFailure(result: ToolErrorResult): CreationWorkspaceResult {
  const bind = bindFailure(result);
  if (bind !== undefined) return bind;
  const left =
    result.leftDirectory === undefined
      ? {}
      : { leftDirectory: result.leftDirectory };
  switch (result.type) {
    case 'path_not_registered':
      return {
        status: 'worktree_failed',
        code: 'path_not_registered',
        message: result.message,
        ...left,
      };
    case 'worktree_failed':
      return { status: 'worktree_failed', message: result.message, ...left };
    case 'machine_unavailable':
      return { status: 'machine_unavailable', message: result.message };
    case 'machine_update_required':
      return { status: 'machine_update_required', message: result.message };
    case 'outcome_unknown':
      return { status: 'outcome_unknown', message: result.message, ...left };
    default:
      return { status: 'bind_failed', message: result.message };
  }
}
