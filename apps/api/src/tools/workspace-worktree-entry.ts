import {
  type GitFailure,
  type GitInspectSuccess,
} from '@workspace/git-executor';

import { WorkspaceBindingRepository } from '../chats/workspace-binding.repository';
import { type Checkout } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ExecutorGitError } from '../machines/executor-git-error';
import { type ExecutorTarget } from '../machines/executor-git.service';
import { parseMachineLocator } from '../machines/machine-locator';
import { derivedDisplayName } from '../repositories/display-name';
import { canonicalOrigin } from '../repositories/remote';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { NativeFilesRepository } from '../runs/native-files-repository';
import { RunEventsRepository } from '../runs/runs-repository';
import { type ToolContext, type ToolResult, type WorktreeGit } from './types';
import { adoptSource } from './workspace-worktree-adoption';
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
 * row is written when git fails, so a refused or failed call leaves the Chat
 * bound to its previous root with its generation unchanged.
 */

/** The validated model input of a `worktree` call. */
export type WorktreeEntryInput = {
  /** The executor the Chat binds: the local executor, or `machine:<name>`. */
  readonly executorId: string;
  /** The executor this entry pins the Run to; absent on a Machine binding. */
  readonly bindExecutorId?: string;
  /** The Machine the source clone lives on, when it names one. */
  readonly machine: string | undefined;
  /** The canonical address of the submitted source clone. */
  readonly canonical: string;
  /** A supplied name, already validated, or `undefined` to generate one. */
  readonly name: WorktreeName | undefined;
  readonly baseRef: string | undefined;
  /**
   * One path under the `enter_workspace` group in `default` mode, with the
   * call's own bypass handling. A refusal ends the call before the write it
   * guards.
   */
  readonly decide: (
    kind: 'main_clone' | 'worktree_directory',
    address: string,
  ) => ToolResult | undefined;
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
type Failed = { readonly status: 'failed'; readonly result: ToolResult };

function worktreeFailed(message: string): Failed {
  return {
    status: 'failed',
    result: { status: 'error', type: 'worktree_failed', message },
  };
}

/** One git failure as the observation a worktree call reports. */
function gitFailureOutcome(failure: GitFailure): Failed {
  return worktreeFailed(
    failure.type === 'invalid_input'
      ? failure.message
      : failure.stderr === ''
        ? 'The worktree command failed.'
        : failure.stderr,
  );
}

/**
 * One executor refusal, in the code this call answers. A Machine link lost
 * after the add was sent may have created the directory, so it is reported as
 * unknown with the directory that can remain.
 */
function executorFailure(error: unknown, leftDirectory: string): Failed {
  if (!(error instanceof ExecutorGitError)) throw error;
  switch (error.code) {
    case 'machine_unavailable':
      return {
        status: 'failed',
        result: error.sent
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
  if (input.machine === undefined) {
    return {
      executorId: input.executorId,
      machine: undefined,
      path: input.canonical,
    };
  }
  const parsed = parseMachineLocator(input.canonical);
  if (parsed.kind !== 'path') {
    throw new ExecutorGitError(
      'invalid_path',
      'The canonical Machine address does not name one absolute path.',
    );
  }
  return {
    executorId: input.executorId,
    machine: input.machine,
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
    return executorFailure(error, input.canonical);
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
  return creation.context.tenantDb.runAs(creation.context.userId, (db) =>
    commitWorktree(db, {
      ...creation,
      inspection,
      plan,
      leaseBaseRef: plan.baseRef ?? inspection.head ?? added.head,
      baseCommit: added.head,
    }),
  );
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
  const { executors, target, worktree } = creation;
  // The main tree git reports: the toplevel, or the main worktree of a linked
  // one by its real path. A subdirectory source decides on its clone.
  const mainClone = inspection.linked
    ? (inspection.mainWorktree ?? inspection.toplevel)
    : inspection.toplevel;
  if (mainClone !== worktree.canonical) {
    const rejection = worktree.decide('main_clone', mainClone);
    if (rejection !== undefined) return { status: 'failed', result: rejection };
  }

  const directoryAt = await placement(creation, inspection, mainClone);
  const name = await chosenName(executors, target, directoryAt, worktree.name);
  if ('status' in name) return name;

  // The decision sees the canonical form: a symlinked parent decides where it
  // lands, and a Machine refuses an address no registered root contains before
  // any git call.
  const directory = await executors.canonicalTarget(
    target,
    directoryAt(name.slug),
  );
  const rejection = worktree.decide('worktree_directory', directory);
  if (rejection !== undefined) return { status: 'failed', result: rejection };
  return {
    mainClone,
    directory,
    branch: name.branch,
    baseRef: worktree.baseRef,
  };
}

/**
 * The durable attempt and the add. The attempt is committed before the effect,
 * so a redelivered Run replays this call instead of creating a second worktree.
 */
async function addedWorktree(
  creation: Creation,
  plan: Plan,
): Promise<{ readonly head: string } | Failed> {
  const { context, executors, target, worktree } = creation;
  const guarded = await context.tenantDb.runAs(context.userId, (db) =>
    new NativeFilesRepository(db).begin({
      runId: creation.runId,
      userId: context.userId,
      fence:
        worktree.bindExecutorId === undefined
          ? { bound: false }
          : { bound: true, executorId: worktree.bindExecutorId },
      deliverySequence: context.nativeDeliverySequence,
      toolCallId: creation.toolCallId,
      operation: 'worktree',
      path: plan.directory,
    }),
  );
  if (guarded !== undefined) return { status: 'failed', result: guarded };

  const added = await executors.worktreeAdd(target, {
    source: plan.mainClone,
    branch: plan.branch,
    ...(plan.baseRef !== undefined && { baseRef: plan.baseRef }),
    directory: plan.directory,
  });
  if (added.status === 'error') return gitFailureOutcome(added);

  // A directory that lands elsewhere would place files where the policy never
  // looked, so the new worktree is removed and the call fails.
  const actual = await executors
    .canonical(target, plan.directory)
    .catch(() => undefined);
  if (actual !== plan.directory) {
    await executors
      .removeWorktree(target, plan.directory)
      .catch(() => undefined);
    return worktreeFailed(
      'The new worktree resolved to a different path than the decided one.',
    );
  }
  return { head: added.head };
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
): Promise<(slug: string) => string> {
  const { context, executors, target, worktree } = creation;
  const source = await context.tenantDb.runAs(context.userId, (db) =>
    readSource(new RepositoriesRepository(db), {
      ownerUserId: context.userId,
      executorId: worktree.executorId,
      mainClone,
      mainPath: executors.executorPath(target, mainClone),
      remote: canonicalOrigin(inspection.remotes),
    }),
  );
  return (slug: string) =>
    executors.address(
      target,
      worktreeDirectory(source.base, source.displayName, slug),
    );
}

/**
 * The display name and placement base of one worktree, read from the owner's
 * catalog before the directory is decided.
 */
async function readSource(
  catalog: RepositoriesRepository,
  input: {
    readonly ownerUserId: string;
    readonly executorId: string;
    readonly mainClone: string;
    readonly mainPath: string;
    readonly remote: string | null;
  },
): Promise<{ readonly base: string; readonly displayName: string }> {
  const row = await catalog.findCheckoutByPath(
    input.ownerUserId,
    input.executorId,
    input.mainClone,
  );
  const repository =
    row === undefined
      ? undefined
      : await catalog.findRepository(input.ownerUserId, row.repositoryId);
  const recordedBase =
    row === undefined
      ? null
      : row.kind === 'main'
        ? row.worktreeBase
        : await recordedParentBase(catalog, input.ownerUserId, row);
  return {
    base: recordedBase ?? defaultWorktreeBase(input.mainPath),
    displayName:
      repository?.displayName ??
      derivedDisplayName(input.remote, input.mainClone),
  };
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
  const name =
    supplied ?? (await freeGeneratedName(executors, target, directoryAt));
  if (name === undefined) {
    return worktreeFailed('No free worktree name was found.');
  }
  if (
    supplied !== undefined &&
    (await executors.exists(target, directoryAt(name.slug)))
  ) {
    return worktreeFailed(
      'A worktree directory with that name already exists.',
    );
  }
  return name;
}

/** The earliest generated name whose directory is free, or `undefined`. */
async function freeGeneratedName(
  executors: WorktreeGit,
  target: ExecutorTarget,
  directoryAt: (slug: string) => string,
): Promise<WorktreeName | undefined> {
  for (let attempt = 0; attempt < WORKTREE_NAME_ATTEMPTS; attempt += 1) {
    const candidate = generatedWorktreeName();
    if (await executors.exists(target, directoryAt(candidate.slug))) continue;
    return candidate;
  }
  return undefined;
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
 * result. A fence lost here writes nothing and reports the directory that
 * remains on disk.
 */
async function commitWorktree(
  db: Db,
  commit: Commit,
): Promise<WorktreeOutcome> {
  const catalog = new RepositoriesRepository(db);
  const source = await adoptSource(catalog, {
    ownerUserId: commit.context.userId,
    executorId: commit.worktree.executorId,
    mainClone: commit.plan.mainClone,
    canonical: commit.worktree.canonical,
    inspection: commit.inspection,
  });
  if (source === undefined) {
    return worktreeFailed(
      'The source clone cannot be recorded in this repository catalog.',
    );
  }
  const created = await catalog.createCheckout({
    ownerUserId: commit.context.userId,
    repositoryId: source.repository.id,
    executorId: commit.worktree.executorId,
    path: commit.plan.directory,
    kind: 'worktree',
    parentCheckoutId: source.main.id,
    branch: commit.plan.branch,
    origin: 'created',
  });
  if (created === undefined) {
    return worktreeFailed('This worktree path is already recorded.');
  }
  await catalog.createLease({
    ownerUserId: commit.context.userId,
    chatId: commit.context.chatId,
    checkoutId: created.id,
    baseRef: commit.leaseBaseRef,
    baseCommit: commit.baseCommit,
  });
  return bindWorktree(db, commit);
}

/** The binding write of the same transaction, and the result it reports. */
async function bindWorktree(db: Db, commit: Commit): Promise<WorktreeOutcome> {
  const { context, worktree, runId } = commit;
  const binding = await new WorkspaceBindingRepository(db).enter({
    chatId: context.chatId,
    ownerUserId: context.userId,
    runId,
    deliverySequence: context.nativeDeliverySequence,
    executorId: worktree.executorId,
    root: commit.plan.directory,
    ...(worktree.bindExecutorId !== undefined && {
      bindExecutorId: worktree.bindExecutorId,
    }),
  });
  if (binding.status === 'fence_lost') {
    return {
      status: 'failed',
      result: {
        status: 'error',
        type: 'executor_unavailable',
        message:
          'The Workspace binding was superseded; the worktree directory remains on disk.',
        leftDirectory: commit.plan.directory,
      },
    };
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

/** The worktree base of a row's main clone, which placement hangs off. */
async function recordedParentBase(
  catalog: RepositoriesRepository,
  ownerUserId: string,
  row: Checkout,
): Promise<string | null> {
  if (row.parentCheckoutId === null) return null;
  const parent = await catalog.findCheckout(ownerUserId, row.parentCheckoutId);
  return parent?.worktreeBase ?? null;
}
