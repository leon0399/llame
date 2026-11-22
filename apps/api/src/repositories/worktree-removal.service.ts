import { Injectable } from '@nestjs/common';
import { type GitStateSuccess } from '@workspace/machine-protocol';

import { type Checkout } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ExecutorGitError } from '../machines/executor-git-error';
import { gitFailureMessage } from '../machines/git-failure';
import {
  ExecutorGit,
  type ExecutorTarget,
} from '../machines/executor-git.service';
import { OWNER_ROUTE } from '../tools/permissions/admit';
import {
  WorkspaceEntryAdmission,
  WORKSPACE_TOOL_ID,
} from '../tools/permissions/workspace-entry-admission';
import { checkoutFailureCode, notFound, repositoryFailure } from './failure';
import { RepositoriesRepository } from './repositories.repository';

/*
 * Owner-initiated worktree removal (openspec `repositories`, "Worktree removal
 * is owner-initiated and guarded", design D6).
 *
 * The gate order is registration's: refuse an unconfigured executor and a
 * missing allowlist entry first, then decide the stored path under the
 * `enter_workspace` group. Only then does git see the directory. The guard
 * refuses a dirty tree and unpushed commits, and fails closed on an unknown
 * upstream unless HEAD is the base commit the lease recorded, because only
 * that proves the branch holds nothing the owner would lose.
 *
 * `git worktree remove` keeps the `llame/<name>` branch, so a clean removal
 * loses no commit, and the row leaves only after git succeeds.
 */

@Injectable()
export class WorktreeRemovalService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly admission: WorkspaceEntryAdmission,
    private readonly executors: ExecutorGit,
  ) {}

  async remove(ownerUserId: string, checkoutId: string): Promise<void> {
    const checkout = await this.worktreeRow(ownerUserId, checkoutId);
    const target = this.canRemove(checkout);
    await this.refuseUnsafe(ownerUserId, checkout, target);
    await this.removeDirectory(ownerUserId, checkout, target);
  }

  /** The worktree row this owner holds, or the status that hides a foreign id. */
  private async worktreeRow(
    ownerUserId: string,
    checkoutId: string,
  ): Promise<Checkout> {
    const checkout = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new RepositoriesRepository(tx).findCheckout(ownerUserId, checkoutId),
    );

    if (checkout === undefined) throw notFound();

    if (checkout.kind !== 'worktree') {
      throw repositoryFailure(
        'invalid_path',
        'Only a worktree checkout can be removed this way; delete the row to forget a main checkout.',
      );
    }

    return checkout;
  }

  /**
   * The guard, in the order design D6 states it: an unclean tree, then the work
   * the owner would lose. A missing upstream is refused unless HEAD is still the
   * base commit the lease recorded, which is the only proof a fresh worktree
   * holds no unpushed commit.
   */
  private async refuseUnsafe(
    ownerUserId: string,
    checkout: Checkout,
    target: ExecutorTarget,
  ): Promise<void> {
    const state = await this.readState(target, checkout);
    const { counts, upstream } = state;

    if (
      counts.staged > 0 ||
      counts.unstaged > 0 ||
      counts.untracked > 0 ||
      counts.conflicted > 0
    ) {
      throw repositoryFailure(
        'worktree_not_clean',
        'The worktree holds uncommitted changes.',
      );
    }

    if (
      (upstream === null || upstream.gone || upstream.ahead === null) &&
      !(await this.holdsBaseCommit(ownerUserId, checkout, state.head))
    ) {
      throw repositoryFailure(
        'worktree_not_clean',
        'The worktree has no usable upstream and its HEAD is not the recorded base commit.',
      );
    }

    if (upstream !== null && upstream.ahead !== null && upstream.ahead > 0) {
      throw repositoryFailure(
        'worktree_not_clean',
        'The worktree holds commits its upstream does not have.',
      );
    }
  }

  /** The checkout's observed state; any failure of either read refuses. */
  private async readState(
    target: ExecutorTarget,
    checkout: Checkout,
  ): Promise<GitStateSuccess> {
    const located = await this.executors
      .locateEntry(target, checkout.path)
      .catch((error: unknown) => throwExecutorFailure(error));

    if (located.status === 'error') {
      throw repositoryFailure('git_failed', gitFailureMessage(located));
    }

    const state = await this.executors
      .state(target, checkout.path, {
        gitEntry: located.gitEntry,
        limit: 0,
        submodules: 'check',
      })
      .catch((error: unknown) => throwExecutorFailure(error));

    if (state.status === 'error') {
      throw repositoryFailure('git_failed', gitFailureMessage(state));
    }

    return state;
  }

  /** Remove the directory first; the row leaves only after git succeeds. */
  private async removeDirectory(
    ownerUserId: string,
    checkout: Checkout,
    target: ExecutorTarget,
  ): Promise<void> {
    const removed = await this.executors
      .removeWorktree(target, checkout.path)
      .catch((error: unknown) => throwExecutorFailure(error));

    if (removed.status === 'error') {
      throw repositoryFailure('git_failed', gitFailureMessage(removed));
    }

    await this.tenantDb.runAs(ownerUserId, (tx) =>
      new RepositoriesRepository(tx).deleteCheckout(ownerUserId, checkout.id),
    );
  }

  /**
   * The gates every route that runs git passes: a derivable executor, an
   * allowlisted `enter_workspace`, and a stored path the group allows. An
   * owner HTTP route has no Run, so the group is decided under
   * {@link OWNER_ROUTE} by the shared entry admission, which decides the
   * canonical address and matches a reject against the stored spelling too.
   */
  private canRemove(checkout: Checkout): ExecutorTarget {
    let target: ExecutorTarget | undefined;

    try {
      target = this.executors.locate(checkout.path);
    } catch (error) {
      throwExecutorFailure(error);
    }

    if (!this.admission.allowsTool()) {
      throw repositoryFailure(
        'tool_not_allowed',
        `${WORKSPACE_TOOL_ID} is not in tools.allowed, so this path may not be inspected.`,
      );
    }

    const decision = this.admission.decide(checkout.path, OWNER_ROUTE);

    if (decision.decision === 'reject') {
      throw repositoryFailure(
        'permission_denied',
        'The host access policy does not allow this path.',
      );
    }

    return target;
  }

  /** Whether HEAD is still the commit the lease recorded at creation. */
  private async holdsBaseCommit(
    ownerUserId: string,
    checkout: Checkout,
    head: string | null,
  ): Promise<boolean> {
    const lease = await this.tenantDb.runAs(ownerUserId, (tx) =>
      new RepositoriesRepository(tx).findLease(ownerUserId, checkout.id),
    );

    return lease !== undefined && head !== null && lease.baseCommit === head;
  }
}

/**
 * Throw the status this route answers for one executor refusal, and rethrow
 * anything else unchanged.
 */
function throwExecutorFailure(error: unknown): never {
  if (!(error instanceof ExecutorGitError)) throw error;
  throw repositoryFailure(checkoutFailureCode(error.code), error.message);
}
