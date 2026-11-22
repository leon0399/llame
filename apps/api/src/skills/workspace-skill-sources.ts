import path from 'node:path';

import {
  formatMachineLocator,
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

/** One Workspace skill source, and the address behind it. */
export type MachineSkillSource = {
  /** The Machine the source lives on. */
  readonly name: string;
  /** The source directory's absolute path on that Machine. */
  readonly path: string;
  /** `machine://<name><path>`: the text SkillCatalog joins children onto. */
  readonly locator: string;
};

/**
 * Ordered Workspace skill sources, from lowest to highest precedence.
 *
 * The paths are derived from a successfully bound Workspace root. Discovery is
 * intentionally left to SkillCatalog so each source remains live and failures
 * can be isolated from operator sources.
 *
 * A Workspace root names a Machine, so its sources are `machine://<name>/…`
 * locators (remote-machines "Machine Workspace skills come from the Machine"),
 * the host Machine included: the catalog reads them through the attempt's
 * in-memory snapshot, which is filled over the Machine's daemon, and every
 * entry it publishes stays a Machine locator. `path.join` cannot build that
 * text — it collapses the scheme's `//` — so a root is joined as decoded path
 * segments and re-encoded once by the locator grammar. A root that is not a
 * Machine path locator names no source at all.
 */
export function workspaceSkillSources(root: string): ReadonlyArray<string> {
  const sources = machineWorkspaceSkillSources(root);

  return sources === undefined ? [] : sources.map((source) => source.locator);
}

/**
 * The three sources of a Machine Workspace root, as locators and as the
 * absolute Machine paths the snapshot must read. Undefined for every root that
 * is not a Machine path locator: the two listing forms (`machine://`,
 * `machine://<name>`) and any value the locator grammar refuses.
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
