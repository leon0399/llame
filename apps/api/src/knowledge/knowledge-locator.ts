import { type ToolResult } from '@workspace/runtime-safety';

import { sep } from 'node:path';

import { isSelectorSuffix } from '@workspace/native-file-tools';

import {
  KnowledgeFilesystemError,
  type KnowledgeFilesystemAdapterPort,
} from './knowledge-filesystem';
import { KNOWLEDGE_CONTENT_NOTICE } from './knowledge-content-notice';
import {
  isKnowledgeSpaceId,
  validatePath,
} from './knowledge-filesystem-validation';
import {
  knowledgeNotFoundResult,
  knowledgeUnavailableResult,
  mapKnowledgeResolverFailure,
} from './knowledge-results';
import {
  encodeRelativePath,
  encodeSelectorSuffix,
  selectorRefusalMessage,
} from '../tools/locator-spelling';
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

/**
 * Why a locator did not parse. A suffix the grammar refuses on a locator that
 * does parse is `invalid_selector`, the answer every other source gives; a
 * part that is not a locator at all is `invalid_path`, as it has always been.
 */
export type KnowledgeLocatorFailure = {
  readonly type: 'invalid_path' | 'invalid_selector';
  readonly message: string;
};

/**
 * Parse `<space-id>[/<path>][:selector]` and report why a locator that does
 * not parse failed. The path part is decoded and validated before the suffix
 * is judged, so a refusal for a suffix outside the grammar names a locator
 * that resolves rather than one the Space rules would refuse.
 */
export function parseKnowledgeLocator(
  rest: string,
): ParsedKnowledgeLocator | KnowledgeLocatorFailure {
  const separator = rest.indexOf('/');
  const knowledgeSpaceId = separator < 0 ? rest : rest.slice(0, separator);
  if (knowledgeSpaceId.length === 0) return invalidPathFailure();
  const remainder = separator < 0 ? '' : rest.slice(separator + 1);
  if (remainder.length === 0) return { knowledgeSpaceId };

  // Split before decoding so an encoded colon remains part of the filename.
  const colon = remainder.indexOf(':');
  const selector = colon < 0 ? undefined : remainder.slice(colon + 1);
  const rawPath = colon < 0 ? remainder : remainder.slice(0, colon);
  // A trailing separator addresses a directory; the native reader already
  // fails a file target that carries one, and here it can only address the
  // Space directory or a subdirectory.
  const trailing = rawPath.endsWith('/');
  const relativePath = decodeKnowledgePath(
    trailing ? rawPath.slice(0, -1) : rawPath,
  );
  if (relativePath === undefined) return invalidPathFailure();
  if (relativePath.length > 0 && !isSpaceRelativePath(relativePath)) {
    return invalidPathFailure();
  }
  if (selector !== undefined && !isSelectorSuffix(selector)) {
    // The Space directory has no resource path, so nothing is spelled for it.
    const spelling =
      relativePath.length === 0
        ? undefined
        : `${KNOWLEDGE_LOCATOR_SCHEME}://${knowledgeSpaceId}/${encodeRelativePath(relativePath)}%3A${encodeSelectorSuffix(selector)}`;
    return {
      type: 'invalid_selector',
      message: selectorRefusalMessage(spelling),
    };
  }
  if (relativePath.length === 0) {
    return selector === undefined
      ? { knowledgeSpaceId }
      : { knowledgeSpaceId, selector };
  }
  const base =
    selector === undefined
      ? { knowledgeSpaceId, relativePath }
      : { knowledgeSpaceId, relativePath, selector };
  return trailing ? { ...base, trailingSeparator: true } : base;
}

/**
 * The Knowledge path rules, applied where the locator is parsed rather than
 * where the adapter opens it: the same `validatePath` the adapter applies
 * decides a path part, so an escaping or oversized one is `invalid_path` here
 * rather than a hint the resolver would refuse anyway.
 */
function isSpaceRelativePath(relativePath: string): boolean {
  try {
    validatePath(relativePath);
    return true;
  } catch {
    return false;
  }
}

function invalidPathFailure(): KnowledgeLocatorFailure {
  return { type: 'invalid_path', message: 'The Knowledge locator is invalid.' };
}

function decodeKnowledgePath(path: string): string | undefined {
  try {
    const segments = path
      .split('/')
      .map((segment) => decodeURIComponent(segment));
    // Check before joining: validation cannot distinguish an introduced slash.
    if (segments.some((segment) => segment.includes('/'))) return undefined;
    return segments.join('/');
  } catch (error) {
    if (error instanceof URIError) return undefined;
    throw error;
  }
}

/**
 * Canonical logical resource identity for a parsed locator: the Space ID and
 * the relative path encoded exactly once, with any read selector excluded.
 * This is the shared projection for both the native resolver and permission
 * matching, so encoded spellings of the same target agree. Direct host paths
 * are not formatted here.
 */
export function formatKnowledgeLocator(parsed: ParsedKnowledgeLocator): string {
  const base = `${KNOWLEDGE_LOCATOR_SCHEME}://${parsed.knowledgeSpaceId}`;
  const relativePath = parsed.relativePath;
  if (relativePath === undefined || relativePath.length === 0) return base;
  const encoded = encodeRelativePath(relativePath);
  return parsed.trailingSeparator === true
    ? `${base}/${encoded}/`
    : `${base}/${encoded}`;
}

export type ResolvedKnowledgeTarget = {
  readonly hostPath: string;
  readonly locator: string;
  readonly knowledgeSpaceId: string;
  readonly knowledgeSpaceName: string;
  readonly selector?: string;
  /**
   * Creates the directories a write needs, refusing a symbolic link at every
   * component exactly as resolution did. Kept as a deferred step because it is
   * a filesystem effect: it must not run until the attempt is durably
   * recorded, and re-walking immediately before the write also narrows the
   * window in which an already-checked parent could be replaced.
   */
  readonly createDirectories: () => Promise<ToolResult | undefined>;
  /**
   * Re-checks, as late as possible, that the target still resolves inside the
   * Space. Node exposes no descriptor-relative open, so this cannot be atomic
   * with the operation; it narrows the window from a fence round trip to the
   * gap before the syscall.
   */
  readonly assertInsideSpace: () => Promise<ToolResult | undefined>;
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
  allowMissing = false,
): Promise<ResolvedKnowledgeTarget | ToolResult> {
  const parsed = parseKnowledgeLocator(rest);
  if ('type' in parsed) return { status: 'error', ...parsed };
  if (!isKnowledgeSpaceId(parsed.knowledgeSpaceId))
    return knowledgeNotFoundResult();

  const access = await resolveSpaceAccess(context, parsed.knowledgeSpaceId);
  if ('status' in access) return access;

  try {
    const hostPath = await access.adapter.resolveHostPath(parsed.relativePath, {
      allowMissing,
      signal: context.abortSignal,
    });
    const target: ResolvedKnowledgeTarget = {
      // The separator rides along so the reader's own `lstat`/open applies the
      // native rule: a directory resolves, a file is `ENOTDIR` and reports
      // `not_found`.
      hostPath:
        parsed.trailingSeparator === true ? `${hostPath}${sep}` : hostPath,
      locator,
      knowledgeSpaceId: parsed.knowledgeSpaceId,
      knowledgeSpaceName: access.knowledgeSpaceName,
      createDirectories: () => createDirectories(context, access, parsed),
      assertInsideSpace: () => assertInsideSpace(context, access, hostPath),
    };
    return parsed.selector === undefined
      ? target
      : { ...target, selector: parsed.selector };
  } catch (error) {
    return mapResolutionFailure(error);
  }
}

/** The deferred filesystem effect a write needs, kept out of resolution so the
 *  durable attempt is recorded before anything touches the disk. */
async function createDirectories(
  context: ToolContext,
  access: KnowledgeSpaceAccess,
  parsed: ParsedKnowledgeLocator,
): Promise<ToolResult | undefined> {
  try {
    await access.adapter.resolveHostPath(parsed.relativePath, {
      allowMissing: true,
      createDirectories: true,
      signal: context.abortSignal,
    });
    return undefined;
  } catch (error) {
    return mapResolutionFailure(error);
  }
}

async function assertInsideSpace(
  context: ToolContext,
  access: KnowledgeSpaceAccess,
  hostPath: string,
): Promise<ToolResult | undefined> {
  try {
    const inside = await access.adapter.isInsideSpace(
      hostPath,
      context.abortSignal,
    );
    return inside ? undefined : knowledgeNotFoundResult();
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
    case 'knowledge_not_directory':
      return {
        status: 'error',
        type: 'not_regular_file',
        message: 'A path component is not a directory.',
      };
    case 'knowledge_space_unavailable':
      return knowledgeUnavailableResult();
    default:
      return { status: 'error', ...invalidPathFailure() };
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
