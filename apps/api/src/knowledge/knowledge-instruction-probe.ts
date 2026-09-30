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

import { lstat, readdir } from 'node:fs/promises';

import { type InstructionScope } from '../instructions/instruction-files';
import { formatKnowledgeLocator } from './knowledge-locator';
import { type KnowledgeFilesystemAdapterPort } from './knowledge-filesystem';
import { type KnowledgeToolResolver } from '../tools/types';

/**
 * What one Space-relative path is. A symbolic link, a device, an absent entry,
 * and anything the trusted resolver refuses are all `missing`: the chain simply
 * continues past them, exactly as it does for a host path the probe declines.
 */
export type KnowledgeEntryProbe =
  | { readonly kind: 'directory' }
  | { readonly kind: 'file'; readonly size: number }
  | { readonly kind: 'missing' };

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
    } catch {
      // An unavailable store or a cancelled Run is not a Space: the trigger
      // loads nothing and the model is told nothing about why.
      return undefined;
    }
    return spaceScope(adapter, input.signal);
  };
}

/** The Space's own directory: the root every walk starts from. */
const SPACE_ROOT = '';

/**
 * One Space as an instruction scope: the locator is both the label every
 * candidate is named by and the identity it is keyed by, because the resolver
 * refuses links, so no two spellings inside a Space name the same file.
 */
export function spaceInstructionScope(
  knowledgeSpaceId: string,
  space: KnowledgeInstructionScope,
): InstructionScope {
  const label = (key: string): string =>
    formatKnowledgeLocator(
      key === SPACE_ROOT
        ? { knowledgeSpaceId }
        : { knowledgeSpaceId, relativePath: key },
    );
  return {
    root: SPACE_ROOT,
    label,
    probe: async (key) => {
      const probe = await space.probe(key);
      const identity = label(key);
      if (probe.kind === 'directory') {
        return { kind: 'directory', size: 0, canonicalPath: identity };
      }
      return probe.kind === 'file'
        ? { kind: 'file', size: probe.size, canonicalPath: identity }
        : { kind: 'missing' };
    },
    list: (key) => space.list(key),
  };
}

/** The Space's own trusted view: a validated host path per relative path. */
function spaceScope(
  adapter: KnowledgeFilesystemAdapterPort,
  signal: AbortSignal | undefined,
): KnowledgeInstructionScope {
  return {
    probe: async (relativePath) =>
      probeEntry(await hostPathOf(adapter, signal, relativePath)),
    list: async (relativeDirectory) =>
      listEntries(await hostPathOf(adapter, signal, relativeDirectory)),
  };
}

/** The validated host path of one Space-relative path, or nothing. */
async function hostPathOf(
  adapter: KnowledgeFilesystemAdapterPort,
  signal: AbortSignal | undefined,
  relativePath: string,
): Promise<string | undefined> {
  try {
    return await adapter.resolveHostPath(
      relativePath === SPACE_ROOT ? undefined : relativePath,
      { allowMissing: true, signal },
    );
  } catch {
    return undefined;
  }
}

/** What one validated host path is, without following a link. */
async function probeEntry(
  host: string | undefined,
): Promise<KnowledgeEntryProbe> {
  if (host === undefined) return { kind: 'missing' };
  try {
    const stats = await lstat(host);
    if (stats.isDirectory()) return { kind: 'directory' };
    return stats.isFile()
      ? { kind: 'file', size: stats.size }
      : { kind: 'missing' };
  } catch {
    return { kind: 'missing' };
  }
}

/** The exact entry names one validated host directory holds. */
async function listEntries(
  host: string | undefined,
): Promise<ReadonlyArray<string>> {
  if (host === undefined) return [];
  try {
    return await readdir(host);
  } catch {
    return [];
  }
}
