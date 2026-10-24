import {
  type GitFailure,
  type GitInspectSuccess,
  type GitWorktreeAddResult,
  type GitWorktreeRemoveResult,
} from '@workspace/git-executor';

import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import { type Checkout } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ExecutorGitError } from '../machines/executor-git-error';
import { type ExecutorTarget } from '../machines/executor-git.service';
import { gitFailureMessage } from '../machines/git-failure';
import { parseMachineLocator } from '../machines/machine-locator';
import { derivedDisplayName } from '../repositories/display-name';
import { canonicalOrigin } from '../repositories/remote';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import {
  type ToolContext,
  type ToolErrorResult,
  type ToolResult,
  type WorktreeGit,
} from './types';
import { adoptSource } from './workspace-worktree-adoption';
import {
  requireDerivedPermission,
  type WorkspaceAuthority,
} from './workspace-binding';
import {
  defaultWorktreeBase,
  generatedWorktreeName,
  WORKTREE_NAME_ATTEMPTS,
  worktreeDirectory,
  type WorktreeName,
} from './workspace-worktree';

/*
 * The effectful half of a worktree entry (openspec `repositories`, design D5).
 *
 * The caller has already decided the submitted path and the canonical source
 * clone under the `enter_workspace` group; this module decides the inspected
 * main clone and the canonical worktree directory, appends the durable
 * `worktree` attempt, calls `git.worktreeAdd`, and commits the checkout, the
 * lease, the adopted rows, the attempt's result, and the bound root in ONE
 * transaction under the binding fence.
 *
 * Order is the contract. No write happens before the directory decision, and no
 * row survives a failure: the commit transaction rolls back through a
 * {@link Rollback} sentinel, so a refused, failed, or superseded call leaves the
 * Chat bound to its previous root with its generation unchanged.
 */

/** The validated model input of a `worktree` call. */
export type WorktreeEntryInput = {
  /** The authority the caller's entry already established. */
  readonly authority: WorkspaceAuthority;
  /** The canonical address of the submitted source clone. */
  readonly canonical: string;
  /** A supplied name, already validated, or `undefined` to generate one. */
  readonly name: WorktreeName | undefined;
  readonly baseRef: string | undefined;
};

/** The worktree one successful entry created, as its result names it. */
export type WorktreeBinding = {
  readonly path: string;
  readonly branch: string;
  readonly baseCommit: string;
};

/** What one worktree entry did: a binding, or the observation that ended it. */
export type WorktreeOutcome =
  | { readonly status: 'failed'; readonly result: ToolResult }
  | {
      readonly status: 'bound' | 'switched' | 'unchanged';
      readonly root: string;
      readonly generation: number;
      readonly worktree: WorktreeBinding;
    };

/** Anything that ended the call with an observation instead of a binding. */
type Failed = { readonly status: 'failed'; readonly result: ToolErrorResult };

/**
 * The settled failure a commit transaction rolls back to. Throwing it inside
 * `runAs` discards every row the transaction wrote, and the caller outside
 * answers the outcome it carries.
 */
class Rollback extends Error {
  constructor(readonly outcome: Failed) {
    super('The worktree entry rolled back.');
  }
}

function worktreeFailed(message: string): Failed {
  return {
    status: 'failed',
    result: { status: 'error', type: 'worktree_failed', message },
  };
}

/** One git failure as the observation a worktree call reports. */
function gitFailureOutcome(failure: GitFailure): Failed {
  return worktreeFailed(gitFailureMessage(failure));
}

/**
 * One executor refusal, in the code this call answers. A Machine link lost
 * after a mutation was sent may have left its effect behind, so it is reported
 * as unknown with the directory that can remain; every read answers its own
 * code, because a read wrote nothing.
 */
function executorFailure(error: unknown, leftDirectory?: string): Failed {
  if (!(error instanceof ExecutorGitError)) throw error;
  switch (error.code) {
    case 'machine_unavailable':
      return {
        status: 'failed',
        result:
          error.sent && leftDirectory !== undefined
            ? {
                status: 'error',
                type: 'outcome_unknown',
                message: `The worktree may exist on the Machine; inspect it before retrying. ${error.message}`,
                leftDirectory,
              }
            : {
                status: 'error',
                type: 'machine_unavailable',
                message: error.message,
              },
      };
    case 'machine_update_required':
    case 'path_not_registered':
    case 'executor_unavailable':
      return {
        status: 'failed',
        result: { status: 'error', type: error.code, message: error.message },
      };
    default:
      return worktreeFailed(error.message);
  }
}

/** The executor target of one already-canonical address. */
function targetOf(input: WorktreeEntryInput): ExecutorTarget {
  const { authority, canonical } = input;
  if (authority.machine === undefined) {
    return {
      executorId: authority.executorId,
      machine: undefined,
      path: canonical,
    };
  }
  const parsed = parseMachineLocator(canonical);
  if (parsed.kind !== 'path') {
    throw new ExecutorGitError(
      'invalid_path',
      'The canonical Machine address does not name one absolute path.',
    );
  }
  return {
    executorId: authority.executorId,
    machine: authority.machine.name,
    path: parsed.path,
  };
}

type Creation = {
  readonly context: ToolContext;
  readonly worktree: WorktreeEntryInput;
  readonly executors: WorktreeGit;
  readonly target: ExecutorTarget;
  readonly runId: string;
  readonly toolCallId: string;
};

/** The decided source, name, and directory of one entry, before any write. */
type Plan = {
  readonly mainClone: string;
  /** The executor's own path for the main clone, where placement does math. */
  readonly mainPath: string;
  readonly directory: string;
  readonly branch: string;
  readonly baseRef: string | undefined;
};

export async function enterWorktree(
  context: ToolContext,
  input: WorktreeEntryInput,
): Promise<WorktreeOutcome> {
  const executors = context.executorGit;
  const runId = context.runId;
  const toolCallId = context.toolCallId;
  if (
    executors === undefined ||
    runId === undefined ||
    toolCallId === undefined
  )
    return worktreeFailed('This process cannot create a worktree.');

  try {
    return await createWorktree({
      context,
      worktree: input,
      executors,
      target: targetOf(input),
      runId,
      toolCallId,
    });
  } catch (error) {
    // Every read is inside this catch and every mutation is caught where it
    // is sent, so no failure here can carry a leftover-directory claim.
    return executorFailure(error);
  }
}

/** The ordered body: inspect and decide, record the attempt, add, commit. */
async function createWorktree(creation: Creation): Promise<WorktreeOutcome> {
  const inspection = await creation.executors.inspect(
    creation.target,
    creation.worktree.canonical,
  );
  if (inspection.status === 'error') return gitFailureOutcome(inspection);

  const plan = await planWorktree(creation, inspection);
  if ('status' in plan) return plan;

  const added = await addedWorktree(creation, plan);
  if ('status' in added) return added;

  // The base ref the lease records: the supplied one, else the source HEAD the
  // inspection read, and the reported head is the commit the guard compares.
  try {
    return await creation.context.tenantDb.runAs(
      creation.context.userId,
      (db) =>
        commitWorktree(db, {
          ...creation,
          inspection,
          plan,
          leaseBaseRef: plan.baseRef ?? inspection.head ?? added.head,
          baseCommit: added.head,
        }),
    );
  } catch (error) {
    if (error instanceof Rollback) return error.outcome;
    throw error;
  }
}

/**
 * The three decisions after the canonical source clone: the main clone git
 * reports, the name, and the canonical worktree directory. Each one precedes
 * the write it guards, and a rejection ends the call with nothing written.
 */
async function planWorktree(
  creation: Creation,
  inspection: GitInspectSuccess,
): Promise<Plan | Failed> {
  const { context, executors, target, worktree } = creation;
  // The main tree git reports: the toplevel, or the main worktree of a linked
  // one by its real path. A subdirectory source decides on its clone.
  const mainClone = inspection.linked
    ? (inspection.mainWorktree ?? inspection.toplevel)
    : inspection.toplevel;
  if (mainClone !== worktree.canonical) {
    const rejection = requireDerivedPermission(
      context,
      'main_clone',
      mainClone,
    );
    if (rejection !== undefined) return { status: 'failed', result: rejection };
  }

  const mainPath = executors.executorPath(target, mainClone);
  const directoryAt = await placement(
    creation,
    inspection,
    mainClone,
    mainPath,
  );
  const name = await chosenName(executors, target, directoryAt, worktree.name);
  if ('status' in name) return name;

  const decided = await decidedDirectory(creation, name, directoryAt);
  if ('status' in decided) return decided;
  return {
    mainClone,
    mainPath,
    directory: decided.directory,
    branch: name.branch,
    baseRef: worktree.baseRef,
  };
}

/**
 * The canonical directory of one chosen name, and the policy decision on it: a
 * symlinked parent decides where it lands, and a Machine refuses an address no
 * registered root contains before any git call.
 */
async function decidedDirectory(
  creation: Creation,
  name: WorktreeName,
  directoryAt: (slug: string) => string,
): Promise<{ readonly directory: string } | Failed> {
  const { context, executors, target } = creation;
  const directory = await executors.canonicalTarget(
    target,
    directoryAt(name.slug),
  );
  const rejection = requireDerivedPermission(
    context,
    'worktree_directory',
    directory,
  );
  return rejection === undefined
    ? { directory }
    : { status: 'failed', result: rejection };
}

/**
 * The durable attempt and the add. The attempt is committed before the effect,
 * so a redelivered Run replays this call instead of creating a second worktree.
 */
async function addedWorktree(
  creation: Creation,
  plan: Plan,
): Promise<{ readonly head: string } | Failed> {
  const guarded = await recordAttempt(creation, plan);
  if (guarded !== undefined) return guarded;

  let added: GitWorktreeAddResult;
  try {
    added = await creation.executors.worktreeAdd(creation.target, {
      source: plan.mainClone,
      branch: plan.branch,
      ...(plan.baseRef !== undefined && { baseRef: plan.baseRef }),
      directory: plan.directory,
    });
  } catch (error) {
    // The add is the one mutation this call sends, so it is the one place a
    // lost link can leave the decided directory behind.
    return executorFailure(error, plan.directory);
  }
  if (added.status === 'error') return gitFailureOutcome(added);
  const refused = await refuseElsewhere(creation, plan);
  return refused ?? { head: added.head };
}

/** The durable `native.attempt`, or the observation that supersedes the call. */
async function recordAttempt(
  creation: Creation,
  plan: Plan,
): Promise<Failed | undefined> {
  const { context, worktree } = creation;
  const guarded = await context.tenantDb.runAs(context.userId, (db) =>
    new NativeFilesRepository(db).begin({
      runId: creation.runId,
      userId: context.userId,
      fence:
        worktree.authority.bindExecutorId === undefined
          ? { bound: false }
          : { bound: true, executorId: worktree.authority.bindExecutorId },
      deliverySequence: context.nativeDeliverySequence,
      toolCallId: creation.toolCallId,
      operation: 'worktree',
      path: plan.directory,
    }),
  );
  if (guarded?.status === 'error') return { status: 'failed', result: guarded };
  // A durable result settles the call before this tool runs, so a success here
  // means a replay raced that settlement: report it without a second add.
  if (guarded !== undefined)
    return worktreeFailed(
      'This worktree call already recorded a result; inspect the Workspace before retrying.',
    );
  return undefined;
}

/**
 * A directory that lands elsewhere would place files where the policy never
 * looked, so the new worktree is removed and the call fails.
 */
async function refuseElsewhere(
  creation: Creation,
  plan: Plan,
): Promise<Failed | undefined> {
  const { executors, target } = creation;
  let actual: string;
  try {
    actual = await executors.canonical(target, plan.directory);
  } catch (error) {
    // A real-path read writes nothing, so it never claims a leftover.
    return executorFailure(error);
  }
  if (actual === plan.directory) return undefined;

  let removed: GitWorktreeRemoveResult;
  try {
    removed = await executors.removeWorktree(target, plan.directory);
  } catch (error) {
    return executorFailure(error, plan.directory);
  }
  if (removed.status === 'error')
    return {
      status: 'failed',
      result: {
        ...gitFailureOutcome(removed).result,
        leftDirectory: plan.directory,
      },
    };
  return worktreeFailed(
    'The new worktree resolved to a different path than the decided one.',
  );
}

/**
 * The directory one slug takes on the executor, from the owner's catalog: a
 * recorded main checkout supplies the display name and the worktree base, and
 * an unregistered clone is placed beside its own toplevel.
 */
async function placement(
  creation: Creation,
  inspection: GitInspectSuccess,
  mainClone: string,
  mainPath: string,
): Promise<(slug: string) => string> {
  const { context, executors, target, worktree } = creation;
  const source = await context.tenantDb.runAs(context.userId, async (db) => {
    const catalog = new RepositoriesRepository(db);
    const row = await catalog.findCheckoutByPath(
      context.userId,
      worktree.authority.executorId,
      mainClone,
    );
    const repository =
      row === undefined
        ? undefined
        : await catalog.findRepository(context.userId, row.repositoryId);
    const parent =
      row?.kind === 'worktree' && row.parentCheckoutId !== null
        ? await catalog.findCheckout(context.userId, row.parentCheckoutId)
        : undefined;
    const recordedBase =
      row?.kind === 'main' ? row.worktreeBase : (parent?.worktreeBase ?? null);
    return {
      // A recorded base is an address on this executor: an absolute host path
      // locally, and a locator on a Machine, which placement math decodes.
      base:
        recordedBase === null
          ? defaultWorktreeBase(mainPath)
          : executors.executorPath(target, recordedBase),
      displayName:
        repository?.displayName ??
        derivedDisplayName(canonicalOrigin(inspection.remotes), mainPath),
    };
  });
  return (slug: string) =>
    executors.address(
      target,
      worktreeDirectory(source.base, source.displayName, slug),
    );
}

/**
 * The name the call uses. A supplied one is used as written, and a collision is
 * the call's own failure; a generated one retries with a new suffix while its
 * directory is taken. Either way a collision never creates a second row or a
 * second branch.
 */
async function chosenName(
  executors: WorktreeGit,
  target: ExecutorTarget,
  directoryAt: (slug: string) => string,
  supplied: WorktreeName | undefined,
): Promise<WorktreeName | Failed> {
  if (supplied !== undefined) {
    return (await executors.exists(target, directoryAt(supplied.slug)))
      ? worktreeFailed('A worktree directory with that name already exists.')
      : supplied;
  }
  for (let attempt = 0; attempt < WORKTREE_NAME_ATTEMPTS; attempt += 1) {
    const candidate = generatedWorktreeName();
    if (!(await executors.exists(target, directoryAt(candidate.slug)))) {
      return candidate;
    }
  }
  return worktreeFailed('No free worktree name was found.');
}

type Commit = Creation & {
  readonly inspection: GitInspectSuccess;
  readonly plan: Plan;
  readonly leaseBaseRef: string;
  readonly baseCommit: string;
};

/**
 * The one transaction of a successful entry: the adopted repository and main
 * checkout, the Worktree checkout, its lease, the binding, and the attempt's
 * result. Every failure throws {@link Rollback}, so nothing it wrote commits.
 */
async function commitWorktree(
  db: Db,
  commit: Commit,
): Promise<WorktreeOutcome> {
  const catalog = new RepositoriesRepository(db);
  const source = await adoptSource(catalog, {
    ownerUserId: commit.context.userId,
    executorId: commit.worktree.authority.executorId,
    mainClone: commit.plan.mainClone,
    mainPath: commit.plan.mainPath,
    canonical: commit.worktree.canonical,
    inspection: commit.inspection,
  });
  if (source === undefined) {
    throw new Rollback(
      worktreeFailed(
        'The source clone cannot be recorded in this repository catalog.',
      ),
    );
  }
  const created = await recordCreated(catalog, commit, source);
  await catalog.createLease({
    ownerUserId: commit.context.userId,
    chatId: commit.context.chatId,
    checkoutId: created.id,
    baseRef: commit.leaseBaseRef,
    baseCommit: commit.baseCommit,
  });
  return bindWorktree(db, commit);
}

/** The Worktree checkout row of the same transaction, or the rollback it earns. */
async function recordCreated(
  catalog: RepositoriesRepository,
  commit: Commit,
  source: {
    readonly main: Checkout;
    readonly repository: { readonly id: string };
  },
): Promise<Checkout> {
  const created = await catalog.createCheckout({
    ownerUserId: commit.context.userId,
    repositoryId: source.repository.id,
    executorId: commit.worktree.authority.executorId,
    path: commit.plan.directory,
    kind: 'worktree',
    parentCheckoutId: source.main.id,
    branch: commit.plan.branch,
    origin: 'created',
  });
  if (created === undefined) {
    throw new Rollback(
      worktreeFailed('This worktree path is already recorded.'),
    );
  }
  return created;
}

/** The binding write of the same transaction, and the result it reports. */
async function bindWorktree(db: Db, commit: Commit): Promise<WorktreeOutcome> {
  const { context, worktree, runId } = commit;
  const binding = await new WorkspaceBindingRepository(db).enter({
    chatId: context.chatId,
    ownerUserId: context.userId,
    runId,
    deliverySequence: context.nativeDeliverySequence,
    executorId: worktree.authority.executorId,
    root: commit.plan.directory,
    ...(worktree.authority.bindExecutorId !== undefined && {
      bindExecutorId: worktree.authority.bindExecutorId,
    }),
  });
  if (binding.status === 'fence_lost') {
    throw new Rollback({
      status: 'failed',
      result: {
        status: 'error',
        type: 'executor_unavailable',
        message:
          'The Workspace binding was superseded; the worktree directory remains on disk.',
        leftDirectory: commit.plan.directory,
      },
    });
  }

  return settleWorktree(db, commit, binding.status, binding.generation);
}

/**
 * The settled observation of the committed worktree. Its `native.result`
 * commits with the rows it describes, so a later replay of this call reads a
 * settled outcome instead of repeating the add.
 */
async function settleWorktree(
  db: Db,
  commit: Commit,
  status: 'bound' | 'switched' | 'unchanged',
  generation: number,
): Promise<WorktreeOutcome> {
  const worktree = {
    path: commit.plan.directory,
    branch: commit.plan.branch,
    baseCommit: commit.baseCommit,
  };
  await new RunEventsRepository(db).append(commit.runId, 'native.result', {
    toolCallId: commit.toolCallId,
    result: { status: 'success', root: commit.plan.directory, worktree },
  });
  return {
    status,
    root: commit.plan.directory,
    generation,
    worktree,
  };
}
