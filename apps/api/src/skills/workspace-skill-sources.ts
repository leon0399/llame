import path from 'node:path';

/**
 * Ordered Workspace skill sources, from lowest to highest precedence.
 *
 * The paths are derived from a successfully bound Workspace root. Discovery is
 * intentionally left to SkillCatalog so each source remains live and failures
 * can be isolated from operator sources.
 */
export function workspaceSkillSources(root: string): ReadonlyArray<string> {
  return [
    path.join(root, '.claude', 'skills'),
    path.join(root, '.agents', 'skills'),
    path.join(root, '.llame', 'skills'),
  ];
}
