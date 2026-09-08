import { type ToolResult } from '@workspace/runtime-safety';

import { sep } from 'node:path';

import { isSelectorSuffix } from '@workspace/native-file-tools';

import {
  KnowledgeFilesystemError,
  type KnowledgeFilesystemAdapterPort,
} from './knowledge-filesystem';
import { KNOWLEDGE_CONTENT_NOTICE } from './knowledge-content-notice';
import { isKnowledgeSpaceId } from './knowledge-filesystem-validation';
import {
  knowledgeNotFoundResult,
  knowledgeUnavailableResult,
  mapKnowledgeResolverFailure,
} from './knowledge-results';
import { type ToolContext } from '../tools/types';

/** The scheme this capability resolves; every other scheme fails closed. */
export const KNOWLEDGE_LOCATOR_SCHEME = 'kb';

export type ParsedKnowledgeLocator = {
  readonly knowledgeSpaceId: string;
  /** Undefined addresses the Space's own directory. */
  readonly relativePath?: string;
  readonly selector?: string;
  /** The locator ended in `/`, which addresses a directory. Kept rather than
   *  normalized away: the native contract accepts it on a directory and fails
   *  `not_found` on a file, and dropping it here would read the file. */
  readonly trailingSeparator?: true;
};

/** Parse `<space-id>[/<path>][:selector]`; `undefined` means `invalid_path`. */
export function parseKnowledgeLocator(
  rest: string,
): ParsedKnowledgeLocator | undefined {
  const separator = rest.indexOf('/');
  const knowledgeSpaceId = separator < 0 ? rest : rest.slice(0, separator);
  if (knowledgeSpaceId.length === 0) return undefined;
  const remainder = separator < 0 ? '' : rest.slice(separator + 1);
  if (remainder.length === 0) return { knowledgeSpaceId };

  // A `kb://` path component never contains `:`, so the first colon after the
  // Space identifier always starts the selector. A suffix that is not one means
  // the colon was inside the path: an invalid path, not an invalid selector.
  // The shape test is the native reader own grammar, so the two cannot drift.
  const colon = remainder.indexOf(':');
  const selector = colon < 0 ? undefined : remainder.slice(colon + 1);
  if (selector !== undefined && !isSelectorSuffix(selector)) return undefined;
  const rawPath = colon < 0 ? remainder : remainder.slice(0, colon);
  // A trailing separator addresses a directory; the native reader already
  // fails a file target that carries one, and here it can only address the
  // Space directory or a subdirectory.
  const trailing = rawPath.endsWith('/');
  const relativePath = trailing ? rawPath.slice(0, -1) : rawPath;
  if (relativePath.length === 0)
    return selector === undefined
      ? { knowledgeSpaceId }
      : { knowledgeSpaceId, selector };
  const base =
    selector === undefined
      ? { knowledgeSpaceId, relativePath }
      : { knowledgeSpaceId, relativePath, selector };
  return trailing ? { ...base, trailingSeparator: true } : base;
}

export type ResolvedKnowledgeTarget = {
  readonly hostPath: string;
  readonly locator: string;
  readonly knowledgeSpaceId: string;
  readonly knowledgeSpaceName: string;
  readonly selector?: string;
};

/**
 * Resolve one `kb://` locator to a host path under the trusted Run owner's
 * current Space access. Resolution runs on every call, so revoked access is
 * refused immediately; an absent, malformed, or other-owner identifier is one
 * indistinguishable closed result, and no host path reaches the caller's
 * error surface.
 */
export async function resolveKnowledgeLocator(
  context: ToolContext,
  locator: string,
  rest: string,
): Promise<ResolvedKnowledgeTarget | ToolResult> {
  const parsed = parseKnowledgeLocator(rest);
  if (parsed === undefined) return invalidPathResult();
  if (!isKnowledgeSpaceId(parsed.knowledgeSpaceId))
    return knowledgeNotFoundResult();

  const access = await resolveSpaceAccess(context, parsed.knowledgeSpaceId);
  if ('status' in access) return access;

  try {
    const hostPath = await access.adapter.resolveHostPath(
      parsed.relativePath,
      context.abortSignal,
    );
    const target: ResolvedKnowledgeTarget = {
      // The separator rides along so the reader's own `lstat`/open applies the
      // native rule: a directory resolves, a file is `ENOTDIR` and reports
      // `not_found`.
      hostPath:
        parsed.trailingSeparator === true ? `${hostPath}${sep}` : hostPath,
      locator,
      knowledgeSpaceId: parsed.knowledgeSpaceId,
      knowledgeSpaceName: access.knowledgeSpaceName,
    };
    return parsed.selector === undefined
      ? target
      : { ...target, selector: parsed.selector };
  } catch (error) {
    return mapResolutionFailure(error);
  }
}

type KnowledgeSpaceAccess = {
  readonly adapter: KnowledgeFilesystemAdapterPort;
  readonly knowledgeSpaceName: string;
};

/** Resolution runs under the trusted Run owner and RLS on every call, so an
 *  absent, removed, or other-owner Space is one indistinguishable result. */
async function resolveSpaceAccess(
  context: ToolContext,
  knowledgeSpaceId: string,
): Promise<KnowledgeSpaceAccess | ToolResult> {
  const resolver = context.knowledgeResolver;
  if (resolver === undefined) return knowledgeUnavailableResult();
  try {
    const binding = await resolver.resolveBindingForOwnerById(
      context.userId,
      knowledgeSpaceId,
    );
    if (binding === undefined) return knowledgeNotFoundResult();
    return {
      adapter: resolver.createAdapter(binding),
      knowledgeSpaceName: binding.name ?? binding.id,
    };
  } catch (error) {
    return mapKnowledgeResolverFailure(error);
  }
}

/**
 * Path and file failures speak the native vocabulary; only the Space segment
 * keeps the Knowledge one, so one tool never mixes two error languages.
 */
function mapResolutionFailure(error: unknown): ToolResult {
  if (!(error instanceof KnowledgeFilesystemError))
    return knowledgeUnavailableResult();
  switch (error.code) {
    case 'knowledge_cancelled':
      throw error;
    case 'knowledge_not_found':
      return { status: 'error', type: 'not_found', message: 'File not found.' };
    case 'knowledge_space_unavailable':
      return knowledgeUnavailableResult();
    default:
      return invalidPathResult();
  }
}

/** The response-time attribution and trust framing every `kb://` result adds. */
export function knowledgeResultEnvelope(target: ResolvedKnowledgeTarget) {
  return {
    knowledgeSpaceId: target.knowledgeSpaceId,
    knowledgeSpaceName: target.knowledgeSpaceName,
    notice: KNOWLEDGE_CONTENT_NOTICE,
  };
}

function invalidPathResult(): ToolResult {
  return {
    status: 'error',
    type: 'invalid_path',
    message: 'The Knowledge locator is invalid.',
  };
}
