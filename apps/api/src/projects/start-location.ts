import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  type Checkout,
  type Project,
  type ProjectRepository,
  type ProjectRepositoryDefault,
  type Repository,
} from '../db/schema';

/**
 * The one start-location resolver (openspec `chat-start-location`, design D9).
 *
 * The preview route (`GET /api/v1/projects/:id/start-location`) and chat
 * creation call this function, so the location a composer shows is the location
 * a create uses. It reads persisted owner rows only: the create route adds the
 * checks that need configuration — an unknown executor id answers 422
 * `executor_unknown`, and an implicit step skips an offline Machine — before it
 * uses a resolution. Nothing here writes.
 *
 * A `null` project is a create request that names no project ("new chat here"):
 * the same repository, executor, and checkout order applies, but no link, no
 * remembered default, and no project default executor exist, so an explicit
 * `repositoryId` needs no link. Every link-derived step is then absent rather
 * than skipped by a separate code path.
 *
 * The order is the create request's order:
 *
 * 1. Repository: the request, else the primary link, else the only link, else
 *    none. Several links without a primary resolve no repository — the server
 *    never picks a primary silently.
 * 2. Executor: the request, else the most recently written default of the link,
 *    else `projects.default_executor_id`, else the only (or lowest-id) executor
 *    that holds a `main` checkout of the repository.
 * 3. Checkout: the request, else the default for the link and executor, else the
 *    only `main` checkout on that executor, else none.
 */

export const ISOLATION_DEFAULTS = ['reuse', 'worktree'] as const;
export type IsolationDefault = (typeof ISOLATION_DEFAULTS)[number];

// The reason labels of design D10: the policy decides, or another open chat
// already holds the source checkout, or no link resolved at all.
export const ISOLATION_REASONS = [
  'project_policy',
  'clone_in_use',
  'no_link',
] as const;
export type IsolationReason = (typeof ISOLATION_REASONS)[number];

export type StartLocationInput = {
  readonly repositoryId?: string;
  readonly executorId?: string;
  readonly checkoutId?: string;
};

export type StartLocation = {
  readonly repositoryId: string | null;
  readonly executorId: string | null;
  readonly checkoutId: string | null;
  readonly isolation: IsolationDefault;
  readonly isolationReason: IsolationReason;
  readonly isolationChats: number;
};

/**
 * The read subset of `ProjectLinksRepository` the resolver needs. A narrow
 * interface, not the class, so the order above is tested against an in-memory
 * source instead of a database.
 */
export type StartLocationSource = {
  listLinks(
    ownerUserId: string,
    projectId: string,
  ): Promise<Array<ProjectRepository>>;
  findRepository(
    ownerUserId: string,
    repositoryId: string,
  ): Promise<Repository | undefined>;
  findCheckout(
    ownerUserId: string,
    checkoutId: string,
  ): Promise<Checkout | undefined>;
  findDefault(
    ownerUserId: string,
    linkId: string,
    executorId: string,
  ): Promise<ProjectRepositoryDefault | undefined>;
  findLatestDefault(
    ownerUserId: string,
    linkId: string,
  ): Promise<ProjectRepositoryDefault | undefined>;
  listMainCheckouts(
    ownerUserId: string,
    repositoryId: string,
    executorId?: string,
  ): Promise<Array<Checkout>>;
  countOpenChatsBoundTo(
    ownerUserId: string,
    root: string,
    executorId: string,
  ): Promise<number>;
};

/** The repository step's answer, including a named checkout's own ids. */
type RepositoryStep = {
  readonly link: ProjectRepository | undefined;
  readonly repositoryId: string | null;
  readonly executorId: string | null;
  readonly checkoutId: string | null;
};

type ExecutorStep = {
  readonly executorId: string | null;
  readonly checkoutId: string | null;
};

/** The owner, the request, and the source every step reads. */
type ResolverContext = {
  readonly source: StartLocationSource;
  readonly ownerUserId: string;
  readonly input: StartLocationInput;
};

/**
 * The only `main` checkout's id, or none. "The only main checkout on that
 * executor" is the last fallback of both the executor and the checkout step,
 * and no resolver may pick one of several.
 */
function onlyMainCheckoutId(checkouts: ReadonlyArray<Checkout>): string | null {
  return checkouts.length === 1 ? checkouts[0].id : null;
}

export async function resolveStartLocation(
  source: StartLocationSource,
  ownerUserId: string,
  project: Pick<Project, 'id' | 'defaultExecutorId'> | null,
  input: StartLocationInput,
): Promise<StartLocation> {
  const context: ResolverContext = { source, ownerUserId, input };
  const links =
    project === null ? [] : await source.listLinks(ownerUserId, project.id);
  const repository = await resolveRepositoryStep(context, project, links);

  let executorId = repository.executorId;
  let checkoutId = repository.checkoutId;
  if (repository.repositoryId === null) {
    // Without a repository the executor order still applies: the request's
    // `executorId`, else the project default. Only the checkout steps need a
    // repository to name one (openspec `chat-creation`: the implicit steps are
    // scoped to the resolved repository, the explicit ones are not).
    executorId = context.input.executorId ?? project?.defaultExecutorId ?? null;
  } else if (checkoutId === null) {
    ({ executorId, checkoutId } = await resolveExecutorStep(
      context,
      project,
      repository.link,
      repository.repositoryId,
    ));
  }

  // A default row's checkout is guaranteed by its foreign key; this read is
  // what the isolation reason needs, and it also drops a stale id.
  const checkout =
    checkoutId === null
      ? undefined
      : await source.findCheckout(ownerUserId, checkoutId);
  const isolation = await resolveIsolationDefault(
    context,
    repository.link,
    checkout,
  );

  return {
    repositoryId: repository.repositoryId,
    executorId,
    checkoutId: checkout === undefined ? null : checkoutId,
    ...isolation,
  };
}

async function resolveRepositoryStep(
  context: ResolverContext,
  project: Pick<Project, 'id' | 'defaultExecutorId'> | null,
  links: ReadonlyArray<ProjectRepository>,
): Promise<RepositoryStep> {
  if (context.input.checkoutId !== undefined) {
    return resolveNamedCheckout(
      context,
      project,
      links,
      context.input.checkoutId,
    );
  }
  // Never a silent primary when several links have none.
  const link =
    context.input.repositoryId === undefined
      ? (links.find((row) => row.isPrimary) ??
        (links.length === 1 ? links[0] : undefined))
      : await linkedRepository(
          context,
          links,
          context.input.repositoryId,
          project !== null,
        );
  return {
    link,
    repositoryId: link?.repositoryId ?? null,
    executorId: null,
    checkoutId: null,
  };
}

/** A named checkout decides its own repository and executor. */
async function resolveNamedCheckout(
  context: ResolverContext,
  project: Pick<Project, 'id'> | null,
  links: ReadonlyArray<ProjectRepository>,
  checkoutId: string,
): Promise<RepositoryStep> {
  const checkout = await context.source.findCheckout(
    context.ownerUserId,
    checkoutId,
  );
  if (checkout === undefined) {
    throw new NotFoundException(`Checkout ${checkoutId} not found`);
  }
  if (checkout.kind !== 'main') {
    throw new UnprocessableEntityException(
      'A worktree checkout cannot start a chat; name its main checkout.',
    );
  }
  assertCheckoutAgrees(checkout, context.input);
  const link = links.find((row) => row.repositoryId === checkout.repositoryId);
  if (link === undefined && project !== null) {
    throw new UnprocessableEntityException(
      'The project does not link that checkout.',
    );
  }
  return {
    link,
    repositoryId: checkout.repositoryId,
    executorId: checkout.executorId,
    checkoutId: checkout.id,
  };
}

/** An explicit repository or executor may only agree with a named checkout. */
function assertCheckoutAgrees(
  checkout: Checkout,
  input: StartLocationInput,
): void {
  if (
    input.repositoryId !== undefined &&
    input.repositoryId !== checkout.repositoryId
  ) {
    throw new UnprocessableEntityException(
      'The named repository does not hold that checkout.',
    );
  }
  if (
    input.executorId !== undefined &&
    input.executorId !== checkout.executorId
  ) {
    throw new UnprocessableEntityException(
      'The named executor does not hold that checkout.',
    );
  }
}

/** An explicit repository must be the caller's, and linked when a project names one. */
async function linkedRepository(
  context: ResolverContext,
  links: ReadonlyArray<ProjectRepository>,
  repositoryId: string,
  requireLink: boolean,
): Promise<ProjectRepository | undefined> {
  const repository = await context.source.findRepository(
    context.ownerUserId,
    repositoryId,
  );
  if (repository === undefined) {
    throw new NotFoundException(`Repository ${repositoryId} not found`);
  }
  const link = links.find((row) => row.repositoryId === repository.id);
  if (link === undefined && requireLink) {
    throw new UnprocessableEntityException(
      'The project does not link that repository.',
    );
  }
  return link;
}

async function resolveExecutorStep(
  context: ResolverContext,
  project: Pick<Project, 'defaultExecutorId'> | null,
  link: ProjectRepository | undefined,
  repositoryId: string,
): Promise<ExecutorStep> {
  const requested = context.input.executorId;
  if (requested !== undefined) {
    return executorForLink(context, link?.id, repositoryId, requested);
  }

  const latest =
    link === undefined
      ? undefined
      : await context.source.findLatestDefault(context.ownerUserId, link.id);
  if (latest !== undefined) {
    return { executorId: latest.executorId, checkoutId: latest.checkoutId };
  }

  if (project !== null && project.defaultExecutorId !== null) {
    return executorForLink(
      context,
      link?.id,
      repositoryId,
      project.defaultExecutorId,
    );
  }
  return executorWithAnyMainCheckout(context, repositoryId);
}

/**
 * One executor's answer for one link: its remembered default, else the only
 * main checkout there, else none. Without a link there is no default to
 * remember, so only the checkout step runs.
 */
async function executorForLink(
  context: ResolverContext,
  linkId: string | undefined,
  repositoryId: string,
  executorId: string,
): Promise<ExecutorStep> {
  const remembered =
    linkId === undefined
      ? undefined
      : await context.source.findDefault(
          context.ownerUserId,
          linkId,
          executorId,
        );
  if (remembered !== undefined) {
    return {
      executorId: remembered.executorId,
      checkoutId: remembered.checkoutId,
    };
  }
  return {
    executorId,
    checkoutId: onlyMainCheckoutId(
      await context.source.listMainCheckouts(
        context.ownerUserId,
        repositoryId,
        executorId,
      ),
    ),
  };
}

/**
 * The only executor that holds a main checkout, or the lowest id when several
 * do. Creation drops an offline Machine from this step before it takes the
 * first one.
 */
async function executorWithAnyMainCheckout(
  context: ResolverContext,
  repositoryId: string,
): Promise<ExecutorStep> {
  const mains = await context.source.listMainCheckouts(
    context.ownerUserId,
    repositoryId,
  );
  const executorId = [...new Set(mains.map((row) => row.executorId))].sort()[0];
  if (executorId === undefined) {
    return { executorId: null, checkoutId: null };
  }
  return {
    executorId,
    checkoutId: onlyMainCheckoutId(
      mains.filter((row) => row.executorId === executorId),
    ),
  };
}

async function resolveIsolationDefault(
  context: ResolverContext,
  link: ProjectRepository | undefined,
  checkout: Checkout | undefined,
): Promise<{
  isolation: IsolationDefault;
  isolationReason: IsolationReason;
  isolationChats: number;
}> {
  if (link === undefined) {
    return {
      isolation: 'reuse',
      isolationReason: 'no_link',
      isolationChats: 0,
    };
  }
  // A policy other than `inherit` selects its own default, and the composer
  // labels it as the project's policy.
  if (link.isolation !== 'inherit') {
    return {
      isolation: link.isolation === 'always_worktree' ? 'worktree' : 'reuse',
      isolationReason: 'project_policy',
      isolationChats: 0,
    };
  }
  // `inherit`: another open chat that already binds the source checkout turns
  // the worktree start on, so the new chat does not share a tree in use.
  const isolationChats =
    checkout === undefined
      ? 0
      : await context.source.countOpenChatsBoundTo(
          context.ownerUserId,
          checkout.path,
          checkout.executorId,
        );
  return {
    isolation: isolationChats > 0 ? 'worktree' : 'reuse',
    isolationReason: isolationChats > 0 ? 'clone_in_use' : 'project_policy',
    isolationChats,
  };
}
