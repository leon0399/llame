/**
 * The Agent Skills package-name grammar (agentskills.io specification): 1-64
 * characters, lowercase letters, digits, and hyphens only, with no leading,
 * trailing, or consecutive hyphen. A package directory's name is its catalog
 * identity and must match the frontmatter `name`; later layers reuse this same
 * grammar to recognize explicit `$name` mentions.
 *
 * The negative lookahead rejects consecutive hyphens; the anchored group
 * rejects a leading or trailing one; the lookahead bounds the length without
 * a second check.
 */
const SKILL_NAME_PATTERN = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

export function isValidSkillName(value: string): boolean {
  return SKILL_NAME_PATTERN.test(value);
}
