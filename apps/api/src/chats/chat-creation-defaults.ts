import { type Logger } from '@nestjs/common';

import { type Project } from '../db/schema';
import { type TenantDbService } from '../db/tenant-db.service';
import { ProjectLinksRepository } from '../projects/project-links.repository';
import { type ProjectsService } from '../projects/projects.service';
import { type StartLocation } from '../projects/start-location';

/*
 * The defaults write-back of one chat start (openspec `chat-start-location`,
 * design D8, and "A failed defaults write does not fail the create").
 *
 * The write runs after the bound root commits, it is best-effort, and the last
 * write wins: its failure is logged and changes nothing — not the response, the
 * bound root, the message, or the Run — and the previous defaults row stays.
 */

/** The start whose link default is written back. */
export type CreationDefaultTarget = {
  readonly ownerUserId: string;
  readonly chatId: string;
  readonly project: Pick<Project, 'id'> | null;
  /** The location the request resolved, which a stored binding leaves null. */
  readonly location: StartLocation | null;
};

/** The collaborators the write-back reads. */
export type CreationDefaultDeps = {
  readonly logger: Pick<Logger, 'error'>;
  readonly tenantDb: TenantDbService;
  readonly projects: Pick<ProjectsService, 'recordProjectDefault'>;
};

/**
 * Record the SOURCE `main` checkout of a successful start as the default of
 * its link on its executor, or log the failure and keep the start as it is.
 */
export async function recordCreationDefault(
  deps: CreationDefaultDeps,
  target: CreationDefaultTarget,
): Promise<void> {
  try {
    await writeBack(deps, target);
  } catch (error) {
    deps.logger.error(
      `The default of Chat ${target.chatId} was not recorded: ${String(error)}`,
    );
  }
}

async function writeBack(
  deps: CreationDefaultDeps,
  target: CreationDefaultTarget,
): Promise<void> {
  const project = target.project;
  const location = target.location;
  const repositoryId = location?.repositoryId ?? null;
  const checkoutId = location?.checkoutId ?? null;
  const executorId = location?.executorId ?? null;
  if (
    project === null ||
    repositoryId === null ||
    checkoutId === null ||
    executorId === null
  ) {
    return;
  }
  const link = await deps.tenantDb.runAs(target.ownerUserId, (tx) =>
    new ProjectLinksRepository(tx).findLinkByRepository(
      target.ownerUserId,
      project.id,
      repositoryId,
    ),
  );
  if (link === undefined) return;
  await deps.projects.recordProjectDefault(
    target.ownerUserId,
    link.id,
    executorId,
    checkoutId,
  );
}
