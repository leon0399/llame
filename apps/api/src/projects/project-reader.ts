/**
 * The `projects://` reader (project-discovery D5-D7).
 *
 * It routes before local path resolution, needs no native executor, Workspace,
 * or Machine, and reads only through the Run owner's tenant identity. A bare
 * locator lists the owner's active Projects, `projects://archived` lists the
 * archived ones, and a UUID locator returns one Project's current metadata,
 * literal instructions, and registered repository checkouts.
 *
 * The result is a Markdown source with its own line count, so the ordinary
 * native text selectors, `raw`, `outline`, result bound, and continuation apply
 * unchanged. Checkout locations are registered data, not authority: this read
 * probes no filesystem, git repository, or Machine and binds nothing.
 *
 * A Project locator is read-only. `edit` and `write` refuse before any
 * datastore access, a malformed locator or selector refuses before any
 * datastore access, and a foreign Project is indistinguishable from a missing
 * one.
 */

import {
  applySelectorSuffix,
  splitSourceLines,
  type ReadTarget,
} from '@workspace/native-file-tools';

import { type Db } from '../db/tenant-db.service';
import { nativeErrorResult, selectInMemoryText } from '../tools/text-selection';
import { type ToolContext, type ToolResult } from '../tools/types';
import { renderProjectDetail, renderProjectListing } from './project-document';
import { ProjectDiscoveryRepository } from './project-discovery.repository';
import { parseProjectLocator, type ProjectLocator } from './project-locator';
import { ProjectsRepository } from './projects-repository';

export async function readProjectResource(
  context: ToolContext,
  operation: 'read' | 'edit' | 'write',
  submitted: string,
): Promise<ToolResult> {
  if (operation !== 'read') return mutationUnsupportedResult();

  const locator = parseProjectLocator(submitted);

  if (locator === undefined) return invalidLocatorResult();

  // The native grammar decides the suffix, not the resource: applying it here
  // makes a malformed selector its own refusal, so neither a missing nor a
  // foreign Project can relabel it `not_found`, and no datastore is opened.
  const prepared = selectorTarget(locator);

  if ('refusal' in prepared) return prepared.refusal;

  const target = prepared.target;

  context.abortSignal?.throwIfAborted();

  // One owner-scoped transaction, with each repository built from its handle:
  // a Project read never opens a second transaction behind a service.
  return context.tenantDb.runAs(context.userId, async (db) => {
    const source =
      locator.kind === 'listing'
        ? await listingSource(
            context.userId,
            new ProjectDiscoveryRepository(db),
            locator,
          )
        : await detailSource(context.userId, db, locator.projectId);

    if (source === undefined) return notFoundResult();

    return selectSource(target, source);
  });
}

/** A computed read target, or the native refusal its suffix earned. */
type SelectorTarget =
  | { readonly target: ReadTarget }
  | { readonly refusal: ToolResult };

/** Apply the locator's selector suffix once, before any lookup. */
function selectorTarget(locator: ProjectLocator): SelectorTarget {
  try {
    return { target: applySelectorSuffix(locator.canonical, locator.selector) };
  } catch (error) {
    const refusal = nativeErrorResult(error);

    if (refusal === undefined) throw error;

    return { refusal };
  }
}

/** The active listing is the unarchived filter and the archived listing the
 *  archived one; both read discovery metadata only, inside the caller's
 *  transaction. */
async function listingSource(
  ownerUserId: string,
  discovery: ProjectDiscoveryRepository,
  locator: Extract<ProjectLocator, { kind: 'listing' }>,
): Promise<string> {
  const projects = await discovery.listProjects(ownerUserId, locator.archived);

  return renderProjectListing(projects, locator.archived);
}

/** `undefined` means the owner lookup found nothing — the same answer for a
 *  missing UUID and another owner's UUID. A datastore failure is not that. */
async function detailSource(
  ownerUserId: string,
  db: Db,
  projectId: string,
): Promise<string | undefined> {
  const project = await new ProjectsRepository(db).findById(
    projectId,
    ownerUserId,
  );

  if (project === undefined) return undefined;

  const repositories = await new ProjectDiscoveryRepository(db).listForProject(
    ownerUserId,
    project.id,
  );

  return renderProjectDetail(project, repositories);
}

/** The fetched source supplies what only it can: its own line count places an
 *  end-relative or `N-` member, and every other selector needs none. */
async function selectSource(
  target: ReadTarget,
  source: string,
): Promise<ToolResult> {
  try {
    return await selectInMemoryText({
      target,
      text: source,
      lineCount:
        target.pending === undefined ? 0 : splitSourceLines(source).length,
      mediaType: 'text/markdown',
    });
  } catch (error) {
    const refused = nativeErrorResult(error);

    if (refused !== undefined) return refused;
    throw error;
  }
}

function mutationUnsupportedResult(): ToolResult {
  return {
    status: 'error',
    type: 'unsupported_operation',
    message:
      'Project locators are read-only; edit and write cannot target them.',
  };
}

function invalidLocatorResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_path',
    message:
      'A Project locator is projects://, projects://archived, or projects://<project id>, optionally followed by a line selector.',
  };
}

/** Foreign and missing answers are this one object, identical in every field. */
function notFoundResult(): ToolResult {
  return {
    status: 'error',
    type: 'not_found',
    message: 'The Project is not found.',
  };
}
