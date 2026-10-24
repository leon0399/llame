import { type GitWorktreeAddResult } from '@workspace/git-executor';

import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import { type Checkout, type Repository } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import { type ExecutorTarget } from '../machines/executor-git.service';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { type ToolErrorResult, type WorktreeGit } from './types';
import {
  chosenName,
  executorFailure,
  gitFailureOutcome,
  worktreeFailed,
  type Failed,
} from './workspace-worktree-entry';
import {
  defaultWorktreeBase,
  worktreeDirectory,
  type WorktreeName,
} from './workspace-worktree';

/*
 * The Run-free worktree creation of a chat start (openspec `chat-start-location`,
 * design D9 steps 5 and 6).
 *
 * `enter_workspace` fuses its ordered decisions, its durable attempt, its add,
 * and its Run-fenced binding into one call. A create request has no Run and no
 * tool call, so this module keeps the decisions and the add and replaces the
 * fence with the create request's own authority: the session lock the caller
 * holds, the creation lease, and the first bound root. The decision ORDER is the
 * entry's, unchanged: the submitted source clone is already decided by the
 * caller, and this one inspects it, decides the main tree git reports, chooses
 * the name, and decides the canonical worktree directory — each before the
 * write it guards.
 *
 * The source is always a registered `main` checkout, so adoption never runs and
 * the placement reads that row's own base and display name. There is no removal
 * path: a creation that fails after the add leaves the directory for the owner
 * to delete, because a half-failed sequence is not the server's to clean up.
 */

/** The trusted, Run-free context of a chat-creation worktree. */
export type CreationEntryContext = {
  readonly tenantDb: TenantRunner;
  readonly userId: string;
  readonly chatId: string;
};

/** The registered source a creation worktree branches from. */
export type CreationSource = {
  /** The `main` checkout the resolution selected. */
  readonly checkout: Checkout;
  readonly repository: Repository;
};

/** What one creation entry decides and writes. */
export type CreationWorktreeInput = {
  readonly target: ExecutorTarget;
  readonly source: CreationSource;
  /** The canonical address of the source clone, already decided. */
  readonly canonical: string;
  readonly name: WorktreeName | undefined;
  readonly baseRef: string | undefined;
  /**
   * One server-derived address under the `enter_workspace` group. The creation
   * step records every decision it makes; a rejection ends the plan before the
   * write it guards.
   */
  readonly decide: (
    kind: 'main_clone' | 'worktree_directory',
    address: string,
  ) => ToolErrorResult | undefined;
};

/** The decided source, directory, and branch of one creation, before any write. */
export type CreationPlan = {
  readonly mainClone: string;
  readonly directory: string;
  readonly branch: string;
  /** The source HEAD the inspection read, for the lease when no base ref is named. */
  readonly sourceHead: string | undefined;
};

/** What one creation worktree did: a bound root, a conflict, or a failure. */
export type CreationWorktreeOutcome =
  | { readonly status: 'failed'; readonly result: ToolErrorResult }
  | { readonly status: 'conflict' }
  | {
      readonly status: 'bound';
      readonly root: string;
      readonly worktree: { path: string; branch: string; baseCommit: string };
    };

/** The bind step refused because the Chat already holds a message or a root. */
class CreationConflict extends Error {
  constructor() {
    super('The chat was bound by another writer.');
  }
}

type CreationRun = {
  readonly input: CreationWorktreeInput;
  readonly executors: WorktreeGit;
};

/**
 * The ordered decisions of one creation worktree, before any write. Nothing is
 * written and no directory is removed; a rejection leaves only the decision it
 * refused.
 */
export async function planCreationWorktree(
  executors: WorktreeGit,
  input: CreationWorktreeInput,
): Promise<CreationPlan | Failed> {
  const creation: CreationRun = { input, executors };
  try {
    return await decidePlan(creation);
  } catch (error) {
    return executorFailure(error);
  }
}

async function decidePlan(
  creation: CreationRun,
): Promise<CreationPlan | Failed> {
  const { executors, input } = creation;
  const inspection = await executors.inspect(input.target, input.canonical);
  if (inspection.status === 'error') return gitFailureOutcome(inspection);

  const mainClone = inspection.linked
    ? (inspection.mainWorktree ?? inspection.toplevel)
    : inspection.toplevel;
  if (mainClone !== input.canonical) {
    const rejection = input.decide('main_clone', mainClone);
    if (rejection !== undefined) {
      return { status: 'failed', result: rejection };
    }
  }

  const name = await chosenName(
    executors,
    input.target,
    (slug) => creationDirectoryAt(creation, mainClone, slug),
    input.name,
  );
  if ('status' in name) return name;

  const directory = await executors.canonicalTarget(
    input.target,
    creationDirectoryAt(creation, mainClone, name.slug),
  );
  const rejection = input.decide('worktree_directory', directory);
  if (rejection !== undefined) return { status: 'failed', result: rejection };
  return {
    mainClone,
    directory,
    branch: name.branch,
    sourceHead: inspection.head ?? undefined,
  };
}

/** The canonical directory of one slug, on the source row's executor. */
function creationDirectoryAt(
  creation: CreationRun,
  mainClone: string,
  slug: string,
): string {
  const { executors, input } = creation;
  const base =
    input.source.checkout.worktreeBase === null
      ? defaultWorktreeBase(executors.executorPath(input.target, mainClone))
      : executors.executorPath(
          input.target,
          input.source.checkout.worktreeBase,
        );
  return executors.address(
    input.target,
    worktreeDirectory(base, input.source.repository.displayName, slug),
  );
}

/**
 * The one mutation and the one transaction of a creation worktree: the add, the
 * Worktree checkout row, its lease, and the Chat's first bound root. A conflict
 * rolls every row back and answers 409 at the route; a failure rolls back and
 * answers the status its cause names.
 */
export async function addCreationWorktree(
  context: CreationEntryContext,
  executors: WorktreeGit,
  input: CreationWorktreeInput,
  plan: CreationPlan,
): Promise<CreationWorktreeOutcome> {
  try {
    const added = await addWorktree(executors, input, plan);
    if ('status' in added) return added;
    return await commitCreation(context, input, plan, added.head);
  } catch (error) {
    if (error instanceof CreationConflict) return { status: 'conflict' };
    if (error instanceof RollbackError) return error.outcome;
    return executorFailure(error);
  }
}

/** The settled failure a commit transaction rolls back to. */
class RollbackError extends Error {
  constructor(
    readonly outcome: {
      readonly status: 'failed';
      readonly result: ToolErrorResult;
    },
  ) {
    super('The creation commit rolled back.');
  }
}

/** The one mutation of the entry, and the leftover it can claim. */
async function addWorktree(
  executors: WorktreeGit,
  input: CreationWorktreeInput,
  plan: CreationPlan,
): Promise<{ readonly head: string } | Failed> {
  let added: GitWorktreeAddResult;
  try {
    added = await executors.worktreeAdd(input.target, {
      source: plan.mainClone,
      branch: plan.branch,
      ...(input.baseRef !== undefined && { baseRef: input.baseRef }),
      directory: plan.directory,
    });
  } catch (error) {
    return executorFailure(error, plan.directory);
  }
  if (added.status === 'error') return gitFailureOutcome(added);
  return { head: added.head };
}

/** The one transaction: the Worktree row, its lease, and the bound root. */
async function commitCreation(
  context: CreationEntryContext,
  input: CreationWorktreeInput,
  plan: CreationPlan,
  baseCommit: string,
): Promise<CreationWorktreeOutcome> {
  await context.tenantDb.runAs(context.userId, async (db) => {
    const created = await recordWorktree(db, context, input, plan);
    await new RepositoriesRepository(db).createLease({
      ownerUserId: context.userId,
      chatId: context.chatId,
      checkoutId: created.id,
      baseRef: input.baseRef ?? plan.sourceHead ?? baseCommit,
      baseCommit,
    });
    const binding = await new WorkspaceBindingRepository(db).bindAtCreation({
      chatId: context.chatId,
      ownerUserId: context.userId,
      executorId: input.target.executorId,
      root: plan.directory,
    });
    if (binding.status === 'conflict') throw new CreationConflict();
    if (binding.status === 'not_found') {
      throw new Error('The chat row of this creation vanished under its lock.');
    }
  });
  return {
    status: 'bound',
    root: plan.directory,
    worktree: {
      path: plan.directory,
      branch: plan.branch,
      baseCommit,
    },
  };
}

/** The Worktree checkout row, or the rollback its conflict earns. */
async function recordWorktree(
  db: Db,
  context: CreationEntryContext,
  input: CreationWorktreeInput,
  plan: CreationPlan,
): Promise<Checkout> {
  const created = await new RepositoriesRepository(db).createCheckout({
    ownerUserId: context.userId,
    repositoryId: input.source.repository.id,
    executorId: input.target.executorId,
    path: plan.directory,
    kind: 'worktree',
    parentCheckoutId: input.source.checkout.id,
    branch: plan.branch,
    origin: 'created',
  });
  if (created === undefined) {
    throw new RollbackError(
      worktreeFailed('This worktree path is already recorded.'),
    );
  }
  return created;
}
