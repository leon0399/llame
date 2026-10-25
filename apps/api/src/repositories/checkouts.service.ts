import path from 'node:path';

import { Injectable } from '@nestjs/common';

import { type Checkout } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import {
  formatMachineLocator,
  isMachineLocator,
  machineExecutorId,
  parseMachineLocator,
} from '../machines/machine-locator';
import {
  CheckoutRegistrationService,
  type RegisterCheckoutInput,
} from './checkout-registration.service';
import { notFound, repositoryFailure, worktreesPresent } from './failure';
import { RepositoriesRepository } from './repositories.repository';

/** One checkout as the owner reads it: the row plus who is bound to it. */
export type CheckoutSummary = Checkout & {
  readonly chatIds: ReadonlyArray<string>;
  readonly leaseChatId: string | null;
};

@Injectable()
export class CheckoutsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly registration: CheckoutRegistrationService,
  ) {}

  /**
   * Register one path, then read the row as the owner will: a chat already
   * bound to that root is listed as bound to it from the start.
   */
  async register(
    ownerUserId: string,
    input: RegisterCheckoutInput,
  ): Promise<CheckoutSummary> {
    const checkout = await this.registration.register(ownerUserId, input);
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const repository = new RepositoriesRepository(tx);
      const [summary] = await summarize(repository, ownerUserId, [checkout]);
      return summary;
    });
  }

  /** Every row of the owner, each with its bound chats and lease chat. */
  async listCheckouts(
    ownerUserId: string,
    repositoryId?: string,
  ): Promise<Array<CheckoutSummary>> {
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const repository = new RepositoriesRepository(tx);
      return summarize(
        repository,
        ownerUserId,
        await repository.listCheckouts(ownerUserId, repositoryId),
      );
    });
  }

  /**
   * Set the worktree base of a `main` checkout. The value must use that row's
   * own executor: an absolute host path for a local checkout, and a
   * `machine://<same name>/...` locator for a Machine checkout. A worktree row
   * refuses the field, because placement hangs off the main clone.
   */
  async setWorktreeBase(
    ownerUserId: string,
    checkoutId: string,
    worktreeBase: string,
  ): Promise<CheckoutSummary> {
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const repository = new RepositoriesRepository(tx);
      const checkout = await repository.findCheckout(ownerUserId, checkoutId);
      if (checkout === undefined) throw notFound();
      if (checkout.kind !== 'main') {
        throw invalidWorktreeBase(
          'A worktree checkout cannot carry a worktree base; placement hangs off its main clone.',
        );
      }
      const base = worktreeBaseFor(checkout, worktreeBase);
      const updated = await repository.setWorktreeBase(
        ownerUserId,
        checkoutId,
        base,
      );
      if (updated === undefined) throw notFound();
      const [summary] = await summarize(repository, ownerUserId, [updated]);
      return summary;
    });
  }

  /** Row-only deletion: the directory on the executor is never touched. */
  async deleteCheckout(ownerUserId: string, checkoutId: string): Promise<void> {
    await this.tenantDb.runAs(ownerUserId, async (tx) => {
      const repository = new RepositoriesRepository(tx);
      // A `main` row with worktree children would cascade them while their
      // directories stay on the executor.
      if (
        (await repository.countWorktrees(ownerUserId, {
          parentCheckoutId: checkoutId,
        })) > 0
      ) {
        throw worktreesPresent();
      }
      const deleted = await repository.deleteCheckout(ownerUserId, checkoutId);
      if (!deleted) throw notFound();
    });
  }
}

/**
 * Attach the bound chats and the lease chat to rows of one owner: the Chat
 * whose Workspace root equals the row's path, and the earliest lease of a
 * worktree row.
 */
async function summarize(
  repository: RepositoriesRepository,
  ownerUserId: string,
  rows: ReadonlyArray<Checkout>,
): Promise<Array<CheckoutSummary>> {
  const bound = await repository.chatsBoundTo(
    ownerUserId,
    rows.map((row) => row.path),
  );
  const leases = await repository.leaseChats(
    ownerUserId,
    rows.flatMap((row) => (row.kind === 'worktree' ? [row.id] : [])),
  );
  return rows.map((row) => ({
    ...row,
    chatIds: bound.get(row.path) ?? [],
    leaseChatId: leases.get(row.id) ?? null,
  }));
}

/**
 * Validate a submitted worktree base against the checkout's executor. The
 * value is stored as submitted: it is placement intent, and the directory it
 * names need not exist yet.
 */
function worktreeBaseFor(checkout: Checkout, submitted: string): string {
  if (isMachineLocator(submitted)) {
    const parsed = parseMachineLocator(submitted);
    if (
      parsed.kind !== 'path' ||
      machineExecutorId(parsed.name) !== checkout.executorId
    ) {
      throw invalidWorktreeBase(
        'A worktree base must name the Machine of its own checkout.',
      );
    }
    const canonical = formatMachineLocator(parsed.name, parsed.path);
    if (canonical === undefined) {
      throw invalidWorktreeBase('A worktree base must be a locator path.');
    }
    return canonical;
  }
  if (checkout.executorId.startsWith('machine:')) {
    throw invalidWorktreeBase(
      'A worktree base on a Machine checkout must be a machine:// locator.',
    );
  }
  if (submitted.includes('\0') || !path.isAbsolute(submitted)) {
    throw invalidWorktreeBase(
      'A worktree base on a local checkout must be an absolute path.',
    );
  }
  return submitted;
}

function invalidWorktreeBase(message: string) {
  return repositoryFailure('invalid_worktree_base', message);
}
