/**
 * Every Knowledge scope a `grep` call can resolve: one Space's prefix, or a
 * bare `kb://` that expands to every current Space of the owner in byte order
 * with a per-Space access re-check.
 */

import {
  isKnowledgeSpaceId,
  validatePath,
} from '../knowledge/knowledge-filesystem-validation';
import { KnowledgeFilesystemError } from '../knowledge/knowledge-filesystem';
import {
  formatKnowledgeLocator,
  resolveKnowledgeSpaceAccess,
} from '../knowledge/knowledge-locator';
import {
  knowledgeNotConfiguredResult,
  knowledgeNotFoundResult,
  knowledgeUnavailableResult,
} from '../knowledge/knowledge-results';
import { type KnowledgeSpaceCursor } from '../knowledge/knowledge-space.cursor';
import { type GrepScope } from '@workspace/native-file-tools';

import { type GrepReadAdmission } from './grep-admission';
import {
  createKnowledgeWalkPort,
  joinedPath,
  probeKnowledgePath,
} from './grep-ports';
import {
  isGrepToolError,
  invalidPathResult,
  type GrepToolError,
} from './grep-results';
import {
  buildScope,
  encodeSearchLocator,
  hasGlobOperator,
  splitScopePath,
  type ScopeOutcome,
} from './grep-scope-shape';
import { type ToolContext } from './types';

export async function resolveKnowledgeScope(
  context: ToolContext,
  rest: string,
  index: number,
  admission: GrepReadAdmission,
): Promise<ScopeOutcome> {
  if (rest.length === 0) return resolveEverySpace(context, index, admission);
  const separator = rest.indexOf('/');
  const spaceId = separator < 0 ? rest : rest.slice(0, separator);
  const rawPath = separator < 0 ? '' : rest.slice(separator + 1);
  if (hasGlobOperator(spaceId)) {
    return {
      result: invalidPathResult(
        'A Knowledge Space identifier cannot hold a glob.',
      ),
    };
  }
  // `read` refuses a Space that is not a current id of the owner, and so does
  // this: another owner's Space is indistinguishable from an absent one.
  if (!isKnowledgeSpaceId(spaceId))
    return { result: knowledgeNotFoundResult() };
  return resolveKnowledgeSpace({ context, spaceId, rawPath, index, admission });
}

async function resolveEverySpace(
  context: ToolContext,
  index: number,
  admission: GrepReadAdmission,
): Promise<ScopeOutcome> {
  const spaces = await listSpaces(context);
  if ('result' in spaces) return spaces;
  if (spaces.ids.length === 0) {
    return { result: knowledgeNotConfiguredResult() };
  }
  const scopes: Array<GrepScope> = [];
  for (const spaceId of spaces.ids) {
    const outcome = await resolveKnowledgeSpace({
      context,
      spaceId,
      rawPath: '',
      index,
      admission,
    });
    if ('result' in outcome) return outcome;
    scopes.push(...outcome.scopes);
  }
  return { scopes, roots: spaces.ids };
}

/** Every current Space of the owner, in byte order of the identifier. */
async function listSpaces(
  context: ToolContext,
): Promise<
  { readonly ids: ReadonlyArray<string> } | { readonly result: GrepToolError }
> {
  const resolver = context.knowledgeResolver;
  if (resolver === undefined) return { result: knowledgeUnavailableResult() };
  const ids: Array<string> = [];
  try {
    let after: KnowledgeSpaceCursor | undefined;
    while (true) {
      const page = await resolver.listForOwnerPage(context.userId, after);
      ids.push(...page.spaces.map((space) => space.id));
      if (page.nextCursor === undefined) break;
      after = page.nextCursor;
    }
  } catch (error) {
    if (
      error instanceof KnowledgeFilesystemError &&
      error.code === 'knowledge_cancelled'
    ) {
      throw error;
    }
    return { result: knowledgeUnavailableResult() };
  }
  ids.sort((left, right) =>
    Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')),
  );
  return { ids };
}

type KnowledgeScopeInput = {
  readonly context: ToolContext;
  readonly spaceId: string;
  readonly rawPath: string;
  readonly index: number;
  readonly admission: GrepReadAdmission;
};

async function resolveKnowledgeSpace(
  input: KnowledgeScopeInput,
): Promise<ScopeOutcome> {
  const { context, spaceId, rawPath, index, admission } = input;
  if (rawPath.includes(':')) {
    return {
      result: invalidPathResult(
        'Write a literal colon in a kb:// scope as %3A; grep parses no selector.',
      ),
    };
  }
  const parsed = splitScopePath(rawPath, isKnowledgePath);
  if ('status' in parsed) return { result: parsed };

  const access = await resolveKnowledgeSpaceAccess(context, spaceId);
  if ('status' in access) {
    if (!isGrepToolError(access)) {
      throw new Error('A Knowledge access refusal must be an error result.');
    }
    return { result: access };
  }
  const binding = access.binding;
  return buildScope({
    index,
    locatorFor: knowledgeLocatorFor(spaceId, parsed.prefixPath),
    glob: parsed.glob,
    port: () =>
      createKnowledgeWalkPort(binding, parsed.prefixPath, context.abortSignal),
    probe: () =>
      probeKnowledgePath(binding, parsed.prefixPath, context.abortSignal),
    endsWithSeparator: parsed.endsWithSeparator,
    admission,
    root: spaceId,
  });
}

function isKnowledgePath(relativePath: string): boolean {
  if (relativePath.length === 0) return true;
  try {
    validatePath(relativePath);
    return true;
  } catch {
    return false;
  }
}

function knowledgeLocatorFor(spaceId: string, prefixPath: string) {
  return (rel: string) => {
    const relativePath = joinedPath(prefixPath, rel);
    return encodeSearchLocator(
      formatKnowledgeLocator(
        relativePath.length === 0
          ? { knowledgeSpaceId: spaceId }
          : { knowledgeSpaceId: spaceId, relativePath },
      ),
    );
  };
}
