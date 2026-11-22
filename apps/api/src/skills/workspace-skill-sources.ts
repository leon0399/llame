import path from 'node:path';

import {
  formatMachineLocator,
  isMachineLocator,
  parseMachineLocator,
} from '../machines/machine-locator';

/**
 * The three Skill sources of a Workspace root, from lowest to highest
 * precedence: Claude's convention, the Agent Skills convention, and llame's
 * own.
 */
const SKILL_SOURCE_SEGMENTS: ReadonlyArray<ReadonlyArray<string>> = [
  ['.claude', 'skills'],
  ['.agents', 'skills'],
  ['.llame', 'skills'],
];

/** One Workspace skill source, and — for a Machine — the address behind it. */
export type MachineSkillSource = {
  /** The Machine the source lives on. */
  readonly name: string;
  /** The source directory's absolute path on that Machine. */
  readonly path: string;
  /** `machine://<name><path>`: the text SkillCatalog joins children onto. */
  readonly locator: string;
};

/** What one call reads, and whether its host paths may be read at all. */
export type WorkspaceSkillSourcesOptions = {
  /** `machines.local`: the Machine this process hosts, served in process. */
  readonly localMachine?: string;
  /**
   * Whether this read's identity-checked handshake with the local Machine
   * verified (design D8). Host paths — a bare root's, or one on the local
   * Machine — are this process's own filesystem, so they are returned only
   * after a successful handshake: an attempt that could not verify the local
   * Machine contributes no Workspace skills, exactly as an unreachable remote
   * Machine does. Unread for a root on another Machine, whose sources are
   * locators.
   */
  readonly localVerified: boolean;
};

/**
 * Whether a root names this process's own filesystem: a bare path, or a
 * `machine://` path locator on `localMachine`.
 */
function hostSkillRoot(
  root: string,
  localMachine: string | undefined,
): boolean {
  const parsed = parseMachineLocator(root);

  if (parsed.kind === 'path')
    return parsed.name === localMachine?.toLowerCase();

  return !isMachineLocator(root);
}

/** The three sources of a root this process reads itself, as host paths. */
function hostSkillSources(root: string): ReadonlyArray<string> {
  const parsed = parseMachineLocator(root);

  if (parsed.kind === 'path') {
    return SKILL_SOURCE_SEGMENTS.map((segments) =>
      path.posix.join(parsed.path, ...segments),
    );
  }

  return SKILL_SOURCE_SEGMENTS.map((segments) => path.join(root, ...segments));
}

/**
 * Ordered Workspace skill sources, from lowest to highest precedence.
 *
 * The paths are derived from a successfully bound Workspace root. Discovery is
 * intentionally left to SkillCatalog so each source remains live and failures
 * can be isolated from operator sources.
 *
 * A Machine root yields `machine://<name>/…` locators instead of host paths
 * (remote-machines "Machine Workspace skills come from the Machine"): the
 * catalog reads them through the snapshot's in-memory file system, and every
 * entry it publishes stays a Machine locator. `path.join` cannot build that
 * text — it collapses the scheme's `//` — so a Machine root is joined as
 * decoded path segments and re-encoded once by the locator grammar.
 *
 * A root this process reads itself — a bare root, or one naming `localMachine`
 * — yields the plain host paths the catalog already reads: no Machine snapshot
 * is taken. Those paths are host filesystem reads, so they require
 * `localVerified` (remote-machines "In-process host operations need a verified
 * host Machine daemon").
 */
export function workspaceSkillSources(
  root: string,
  options: WorkspaceSkillSourcesOptions,
): ReadonlyArray<string> {
  if (hostSkillRoot(root, options.localMachine)) {
    return options.localVerified ? hostSkillSources(root) : [];
  }

  const sources = machineWorkspaceSkillSources(root);

  return sources === undefined ? [] : sources.map((source) => source.locator);
}

/**
 * The Workspace skill sources one tool call may read: the local Machine's host
 * paths only when `verifyLocal` passed first, and no source at all when the
 * handshake refused. A root on another Machine never runs the verification,
 * because its sources are locators the in-memory catalog reads.
 */
export async function verifiedWorkspaceSkillSources(
  root: string,
  options: {
    readonly localMachine?: string;
    readonly verifyLocal: () => Promise<boolean>;
  },
): Promise<ReadonlyArray<string>> {
  const localVerified = hostSkillRoot(root, options.localMachine)
    ? await options.verifyLocal()
    : false;

  return workspaceSkillSources(root, {
    ...(options.localMachine !== undefined && {
      localMachine: options.localMachine,
    }),
    localVerified,
  });
}

/**
 * The three sources of a Machine Workspace root, as locators and as the
 * absolute Machine paths the snapshot must read. Undefined for every root that
 * is not a Machine path locator: a local root, and the two listing forms
 * (`machine://`, `machine://<name>`).
 */
export function machineWorkspaceSkillSources(
  root: string,
): ReadonlyArray<MachineSkillSource> | undefined {
  const parsed = parseMachineLocator(root);

  if (parsed.kind !== 'path') return undefined;

  return SKILL_SOURCE_SEGMENTS.map((segments) => {
    const sourcePath = path.posix.join(parsed.path, ...segments);

    return {
      name: parsed.name,
      path: sourcePath,
      // A parsed path always encodes again; the fallback keeps the spelling
      // this function produced before Machine roots could be joined rather
      // than inventing one.
      locator:
        formatMachineLocator(parsed.name, sourcePath) ??
        path.join(root, ...segments),
    };
  });
}
