import { SkillCatalog, type SkillCatalogPort } from './skill-catalog';

/**
 * A catalog for tests that construct services directly. With no directories it
 * behaves exactly like an instance whose `skills.directories` is empty: an
 * available catalog with no entries, which is also the built-in default.
 */
export function noopSkillCatalog(): SkillCatalogPort {
  return new SkillCatalog([]);
}
