import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { type Chat, type Checkout, type Repository } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ProjectLinksRepository } from '../projects/project-links.repository';
import { type StartLocation } from '../projects/start-location';
import { type WorktreeRequest } from '../tools/workspace-worktree';
import {
  type AdmittedChat,
  type CreationLease,
} from './chat-creation-admission';
import { executorTarget } from './chat-creation-executors';
import {
  recordedWorktreeUnknown,
  storedBinding,
  worktreeOf,
} from './chat-creation-outcomes';
import {
  ChatCreationWorkspace,
  type CreationWorkspaceResult,
} from './chat-creation-workspace';
import { type ValidatedChatTurn } from './chat-loop.service';
import { WorkspaceBindingRepository } from './workspace-binding.repository';

/*
 * The Workspace step of one chat creation (openspec `chat-start-location`,
 * design D9 step 5): from an admitted Chat and its resolved start location to
 * the response's closed workspace status set. A stored binding or a creation
 * lease is reused as it stands; otherwise the resolved checkout is read under
 * owner RLS and bound, or the requested worktree is created, by
 * {@link ChatCreationWorkspace}.
 */

/** What the step binds through and reads its rows in. */
type WorkspaceStepDeps = {
  readonly tenantDb: TenantDbService;
  readonly workspace: ChatCreationWorkspace;
};

/** One admitted request's Workspace outcome, and the turn it may start with. */
type WorkspaceStepInput = {
  readonly userId: string;
  readonly admitted: AdmittedChat;
  readonly worktree: WorktreeRequest | undefined;
  readonly turn: ValidatedChatTurn | undefined;
};

/** The Workspace step of one request, in the response's closed status set. */
export async function enterCreatedWorkspace(
  deps: WorkspaceStepDeps,
  input: WorkspaceStepInput,
): Promise<CreationWorkspaceResult> {
  const { chat, lease } = input.admitted;

  if (chat.workspaceRoot !== null) {
    return storedBinding(chat.workspaceRoot, chat.workspaceExecutorId, lease);
  }

  if (lease !== null) {
    return rebindLease(deps.tenantDb, input.userId, chat, lease);
  }

  if (input.admitted.recordedWorktree !== null) {
    return recordedWorktreeUnknown(input.admitted.recordedWorktree);
  }

  return enterLocated(deps, input);
}

/** The bind or worktree the resolved location decides, on an online executor. */
async function enterLocated(
  deps: WorkspaceStepDeps,
  input: WorkspaceStepInput,
): Promise<CreationWorkspaceResult> {
  const located = await readLocated(
    deps.tenantDb,
    input.userId,
    input.admitted.location,
  );

  if (located === null) return { status: 'unbound' };

  // An implicit step never reaches an offline executor (the resolver saw only
  // online ones), so this is an explicit, named, or remembered executor.
  if (!input.admitted.online(located.executorId)) {
    return {
      status: 'machine_unavailable',
      message: `The executor ${located.executorId} is offline.`,
    };
  }

  const target = executorTarget(located.executorId, located.checkout.path);

  if (target === undefined) {
    return {
      status: 'bind_failed',
      code: 'not_found',
      message: 'The resolved checkout does not belong to its executor.',
    };
  }

  return deps.workspace.enter({
    ownerUserId: input.userId,
    chatId: input.admitted.chat.id,
    permissionMode: input.turn?.permissionMode ?? 'default',
    target,
    checkout: located.checkout,
    repository: located.repository,
    worktree: input.worktree,
  });
}

/**
 * The resolved checkout and repository rows, or null when no location
 * resolved. A `main` row is the only source a start may bind.
 */
async function readLocated(
  tenantDb: TenantDbService,
  userId: string,
  location: StartLocation | null,
): Promise<{
  readonly checkout: Checkout;
  readonly repository: Repository;
  readonly executorId: string;
} | null> {
  const executorId = location?.executorId ?? null;
  const checkoutId = location?.checkoutId ?? null;
  const repositoryId = location?.repositoryId ?? null;

  if (executorId === null || checkoutId === null) return null;

  const located = await readCheckoutAndRepository(
    tenantDb,
    userId,
    checkoutId,
    repositoryId,
  );

  if (located.checkout === undefined || located.repository === undefined) {
    throw new NotFoundException(
      'The resolved checkout or repository no longer exists.',
    );
  }

  if (located.checkout.kind !== 'main') {
    throw new UnprocessableEntityException(
      'A worktree checkout cannot start a chat; name its main checkout.',
    );
  }

  return {
    checkout: located.checkout,
    repository: located.repository,
    executorId,
  };
}

/** The two rows a resolved location names, read in one transaction. */
async function readCheckoutAndRepository(
  tenantDb: TenantDbService,
  userId: string,
  checkoutId: string,
  repositoryId: string | null,
): Promise<{ checkout?: Checkout; repository?: Repository }> {
  return tenantDb.runAs(userId, async (tx) => {
    const links = new ProjectLinksRepository(tx);

    return {
      checkout: await links.findCheckout(userId, checkoutId),
      repository:
        repositoryId === null
          ? undefined
          : await links.findRepository(userId, repositoryId),
    };
  });
}

/** A resend with a creation lease reuses that worktree and root. */
async function rebindLease(
  tenantDb: TenantDbService,
  userId: string,
  chat: Chat,
  lease: CreationLease,
): Promise<CreationWorkspaceResult> {
  const result = await tenantDb.runAs(userId, (tx) =>
    new WorkspaceBindingRepository(tx).bindAtCreation({
      chatId: chat.id,
      ownerUserId: userId,
      executorId: lease.checkout.executorId,
      root: lease.checkout.path,
    }),
  );

  if (result.status === 'conflict') return { status: 'conflict' };

  if (result.status === 'not_found') {
    throw new NotFoundException(`Chat ${chat.id} not found`);
  }

  return {
    status: 'bound',
    root: lease.checkout.path,
    executorId: lease.checkout.executorId,
    worktree: worktreeOf(lease),
  };
}
