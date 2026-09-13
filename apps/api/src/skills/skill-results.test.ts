import { RESULT_TRUNCATE_CHARS } from '@workspace/runtime-safety';
import { measureNativeModelOutput } from '@workspace/native-file-tools';

import { type SkillCatalogEntry } from './skill-catalog';
import { skillCatalogEnvelope } from './skill-results';

function entry(index: number, descriptionLength: number): SkillCatalogEntry {
  return {
    name: `skill-${String(index).padStart(5, '0')}`,
    description: 'x'.repeat(descriptionLength),
    proactive: true,
    sourceDirectory: '/opt/skills',
    skillDirectory: `/opt/skills/skill-${index}`,
    available: true,
    diagnostics: [],
  };
}

describe('skillCatalogEnvelope', () => {
  it('returns a page that fits the shared result cap', () => {
    const entries = Array.from({ length: 300 }, (_, index) =>
      entry(index, 1000),
    );

    const listing = skillCatalogEnvelope(entries, { offset: 0 });

    expect(measureNativeModelOutput(listing)).toBeLessThanOrEqual(
      RESULT_TRUNCATE_CHARS,
    );
    expect(listing.skills.length).toBeGreaterThan(0);
    expect(listing.skills.length).toBeLessThan(entries.length);
    // The continuation resumes exactly where the page stopped, so no entry is
    // skipped between pages.
    expect(listing.nextOffset).toBe(listing.skills.length);
  });

  it('bounds one call regardless of how large the window is', () => {
    // A model can ask for an arbitrarily large window; the search must not
    // scale with the catalog. 50,000 entries through the pre-fix linear scan
    // re-serialized tens of millions of entries and took minutes.
    const entries = Array.from({ length: 50_000 }, (_, index) =>
      entry(index, 1000),
    );

    const started = performance.now();
    const listing = skillCatalogEnvelope(entries, {
      offset: 0,
      limit: 999_999,
    });
    const elapsed = performance.now() - started;

    expect(listing.skillCount).toBe(50_000);
    expect(listing.skills.length).toBeGreaterThan(0);
    expect(measureNativeModelOutput(listing)).toBeLessThanOrEqual(
      RESULT_TRUNCATE_CHARS,
    );
    expect(elapsed).toBeLessThan(1000);
  });

  it('admits every entry when the whole catalog fits', () => {
    const entries = [entry(1, 20), entry(2, 20)];

    const listing = skillCatalogEnvelope(entries, { offset: 0 });

    expect(listing.skills).toHaveLength(2);
    expect(listing).not.toHaveProperty('nextOffset');
  });

  it('reports a continuation from a non-zero offset', () => {
    const entries = Array.from({ length: 300 }, (_, index) =>
      entry(index, 1000),
    );

    const listing = skillCatalogEnvelope(entries, { offset: 100, limit: 500 });

    expect(measureNativeModelOutput(listing)).toBeLessThanOrEqual(
      RESULT_TRUNCATE_CHARS,
    );
    expect(listing.nextOffset).toBe(100 + listing.skills.length);
  });

  it('discloses the real catalog size and the requested window', () => {
    const entries = Array.from({ length: 5 }, (_, index) => entry(index, 20));

    const listing = skillCatalogEnvelope(entries, { offset: 2, limit: 2 });

    expect(listing.skillCount).toBe(5);
    expect(listing.skills.map((skill) => skill.name)).toEqual([
      'skill-00002',
      'skill-00003',
    ]);
    expect(listing.nextOffset).toBe(4);
  });
});
