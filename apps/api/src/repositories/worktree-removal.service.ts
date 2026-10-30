import { Inject, Injectable } from '@nestjs/common';

import { type Checkout } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { ExecutorGitError } from '../machines/executor-git-error';
import { gitFailureMessage } from '../machines/git-failure';
import {
  ExecutorGit,
  type ExecutorTarget,
} from '../machines/executor-git.service';
import { decidePermission, OWNER_ROUTE } from '../tools/permissions/admit';
import { projectNativeFilePath } from '../tools/permissions/locator-projection';
import { TOOL_PERMISSION_POLICY } from '../tools/permissions/permission-policy.module';
import { type CompiledPolicy } from '../tools/permissions/types';
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

/** The one tool group these routes are gated by. */
const WORKSPACE_TOOL_ID = 'enter_workspace';

@Injectable()
export class WorktreeRemovalService {
  constructor(
    private readonly tenantDb: TenantDbService,
    // Explicit token: the parameter is narrowed to the reader capability, so
    // the emitted design type is not the class Nest would resolve.
    @Inject(InstanceConfigService)
    private readonly config: Pick<InstanceConfigService, 'config'>,
    private readonly executors: ExecutorGit,
    @Inject(TOOL_PERMISSION_POLICY)
    private readonly policy: CompiledPolicy,
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
    const status = await this.executors
      .status(target, checkout.path)
      .catch((error: unknown) => throwExecutorFailure(error));
    if (status.status === 'error') {
      throw repositoryFailure('git_failed', gitFailureMessage(status));
    }
    if (status.dirty) {
      throw repositoryFailure(
        'worktree_not_clean',
        'The worktree holds uncommitted changes.',
      );
    }
    if (
      status.upstream === undefined &&
      !(await this.holdsBaseCommit(ownerUserId, checkout, status.head))
    ) {
      throw repositoryFailure(
        'worktree_not_clean',
        'The worktree has no upstream and its HEAD is not the recorded base commit.',
      );
    }
    if (status.ahead > 0) {
      throw repositoryFailure(
        'worktree_not_clean',
        'The worktree holds commits its upstream does not have.',
      );
    }
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
   * {@link OWNER_ROUTE}. The row stores the canonical address, so one
   * evaluation decides both the submitted and the canonical form.
   */
  private canRemove(checkout: Checkout): ExecutorTarget {
    let target: ExecutorTarget | undefined;
    try {
      target = this.executors.locate(checkout.path);
    } catch (error) {
      throwExecutorFailure(error);
    }
    if (!this.config.config.tools.allowed.includes(WORKSPACE_TOOL_ID)) {
      throw repositoryFailure(
        'tool_not_allowed',
        `${WORKSPACE_TOOL_ID} is not in tools.allowed, so this path may not be inspected.`,
      );
    }
    const decision = decidePermission(this.policy, OWNER_ROUTE, (evaluate) =>
      evaluate({
        toolId: WORKSPACE_TOOL_ID,
        args: { path: projectNativeFilePath(checkout.path) },
      }),
    );
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
