/**
 * The owner-scoped, existence-only view of one Knowledge Space that the
 * instructions producer walks (openspec/changes/instruction-files/knowledge).
 *
 * Resolution runs per Space under the trusted Run owner, so an absent, foreign,
 * or unusable Space is one indistinguishable `undefined` — no probe of its
 * directory and no event. Host paths exist only inside this module: the scope
 * answers in Space-relative terms, so a label, a seen key, an audit event, and
 * the model's own text carry the logical `kb://` locator and never a host path.
 */

import { lstat } from 'node:fs/promises';
import {
  listDirectoryNames,
  type InstructionScope,
} from '../instructions/instruction-files';
import { formatKnowledgeLocator } from './knowledge-locator';
import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';
import { type KnowledgeFilesystemAdapterPort } from './knowledge-filesystem';
import { type KnowledgeToolResolver } from '../tools/types';

/**
 * What one Space-relative path is. A symbolic link, a device, an absent entry,
 * and anything the trusted resolver refuses are all `missing`: the chain simply
 * continues past them, exactly as it does for a host path the probe declines.
 * No host path is carried here; the scope names the entry by its locator.
 */
export type KnowledgeEntryProbe =
  | { readonly kind: 'missing' }
  | { readonly kind: 'directory' | 'file'; readonly size: number };

/** One Space, addressed by Space-relative path; no host path crosses it. */
export interface KnowledgeInstructionScope {
  /** What one Space-relative path is, resolved through the trusted adapter. */
  probe(relativePath: string): Promise<KnowledgeEntryProbe>;
  /** The exact entry names one Space-relative directory holds. */
  list(relativeDirectory: string): Promise<ReadonlyArray<string>>;
}

/**
 * Resolves one Space for the trusted owner. `undefined` means the Space is not
 * this Run's to read, so the caller loads nothing and reveals nothing.
 */
export type KnowledgeInstructionProbe = (
  knowledgeSpaceId: string,
) => Promise<KnowledgeInstructionScope | undefined>;

/**
 * The trusted owner-scoped probe a Run hands the instructions producer. Binding
 * resolution is the only authority: the adapter it returns refuses a symlinked
 * component and keeps every resolved path inside the Space.
 */
export function createKnowledgeInstructionProbe(input: {
  readonly resolver: KnowledgeToolResolver;
  readonly ownerUserId: string;
  readonly signal?: AbortSignal;
}): KnowledgeInstructionProbe {
  return async (knowledgeSpaceId) => {
    let adapter: KnowledgeFilesystemAdapterPort;
    try {
      const binding = await input.resolver.resolveBindingForOwnerById(
        input.ownerUserId,
        knowledgeSpaceId,
      );
      if (binding === undefined) return undefined;
      adapter = input.resolver.createAdapter(binding);
      // The Space's own directory is resolved once, up front, and confirmed
      // inside the Space: a root that is gone, moved, or no longer canonical
      // yields no scope at all, so no candidate in it is ever probed.
      const directory = await adapter.resolveHostPath(undefined, {
        signal: input.signal,
      });
      if (!(await adapter.isInsideSpace(directory, input.signal))) {
        return undefined;
      }
    } catch {
      // An unavailable store is not a Space: the trigger loads nothing, and a
      // failure carrying a host path is a message that reaches no output.
      return undefined;
    }
    return spaceScope(adapter, input.signal);
  };
}

/** The Space's own directory: the root every walk starts from. */
const SPACE_ROOT = '';

/**
 * One Space as an instruction scope: the canonical locator is both the label
 * every candidate is named by and the identity it is keyed by, because the
 * resolver refuses links, so no two spellings inside a Space name the same
 * file.
 *
 * `readSpaceId` is that same id as the step's first triggering `kb://` call
 * spelled it. Only the read selector carries it: a `read` rule the operator
 * wrote against `kb://<Upper-Case>/…` is evaluated for the candidate read
 * exactly as it was for the model's own read of that Space, so a Space
 * reached under one spelling is never read under another.
 */
export function spaceInstructionScope(input: {
  readonly knowledgeSpaceId: string;
  readonly readSpaceId: string;
  readonly space: KnowledgeInstructionScope;
}): InstructionScope {
  const { knowledgeSpaceId, readSpaceId, space } = input;
  const label = (key: string): string =>
    formatKnowledgeLocator({ knowledgeSpaceId, relativePath: key });
  return {
    root: SPACE_ROOT,
    label,
    readLabel: (key) =>
      formatKnowledgeLocator({
        knowledgeSpaceId: readSpaceId,
        relativePath: key,
      }),
    probe: async (key) => {
      const entry = await space.probe(key);
      return entry.kind === 'missing'
        ? { kind: 'missing' }
        : { kind: entry.kind, size: entry.size, canonicalPath: label(key) };
    },
    list: (key) => space.list(key),
  };
}

/** The Space's own trusted view: a validated host path per relative path. */
function spaceScope(
  adapter: KnowledgeFilesystemAdapterPort,
  signal: AbortSignal | undefined,
): KnowledgeInstructionScope {
  /**
   * One Space-relative path's host path, but only while it resolves inside the
   * Space: a component swapped for a link after validation resolves outside,
   * and the chain continues past it exactly as past a refused entry. Neither
   * step may be assumed: a failure of either degrades the entry to missing.
   */
  const inside = async (relativePath: string): Promise<string | undefined> => {
    try {
      const host = await adapter.resolveHostPath(
        relativePath === SPACE_ROOT ? undefined : relativePath,
        { allowMissing: true, signal },
      );
      return (await adapter.isInsideSpace(host, signal)) ? host : undefined;
    } catch (error) {
      // A cancelled Run is not a missing file: it ends the walk where the
      // producer's own abort check would, instead of quietly loading nothing.
      // Any other failure — a path that will not resolve, or a containment
      // check that cannot answer at all — is a refusal, never a pass.
      if (
        error instanceof KnowledgeFilesystemError &&
        error.code === 'knowledge_cancelled'
      ) {
        throw error;
      }
      return undefined;
    }
  };
  return {
    probe: async (relativePath) => probeEntry(await inside(relativePath)),
    list: async (relativeDirectory) => {
      const host = await inside(relativeDirectory);
      return host === undefined ? [] : listDirectoryNames(host);
    },
  };
}

/** What one validated host path is, without following a link. */
async function probeEntry(
  host: string | undefined,
): Promise<KnowledgeEntryProbe> {
  if (host === undefined) return { kind: 'missing' };
  try {
    const stats = await lstat(host);
    if (!stats.isFile() && !stats.isDirectory()) return { kind: 'missing' };
    return {
      kind: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
    };
  } catch {
    return { kind: 'missing' };
  }
}
