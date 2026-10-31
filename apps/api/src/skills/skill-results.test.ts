import {
  measureJson,
  neutralizeReservedDelimitersDeep,
  RESULT_TRUNCATE_CHARS,
} from '@workspace/runtime-safety';

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

    expect(
      measureJson(neutralizeReservedDelimitersDeep(listing)),
    ).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
    expect(listing.skills.length).toBeGreaterThan(0);
    expect(listing.skills.length).toBeLessThan(entries.length);
    // The continuation resumes exactly where the page stopped, so no entry is
    // skipped between pages.
    expect(listing.nextOffset).toBe(listing.skills.length);
  });

  it('admits a catalog that fills the cap exactly and refuses one unit more', () => {
    // The fitting bound is inclusive: a listing whose neutralized JSON is
    // exactly the shared cap is a page that fits. The base measurement gives
    // the fixed width, so each added description character is one more unit.
    const base = skillCatalogEnvelope([entry(1, 0)], { offset: 0 });
    const baseSize = measureJson(neutralizeReservedDelimitersDeep(base));
    const padding = RESULT_TRUNCATE_CHARS - baseSize;

    const atCap = skillCatalogEnvelope([entry(1, padding)], { offset: 0 });
    expect(measureJson(neutralizeReservedDelimitersDeep(atCap))).toBe(
      RESULT_TRUNCATE_CHARS,
    );
    expect(atCap.skills).toHaveLength(1);
    expect(atCap).not.toHaveProperty('nextOffset');

    const overCap = skillCatalogEnvelope([entry(1, padding + 1)], {
      offset: 0,
    });
    expect(overCap.skills).toHaveLength(0);
    expect(overCap.nextOffset).toBe(0);
  });

  it('measures the escaping the reserved-name rule adds', () => {
    // A description full of reserved delimiters grows by six code units per
    // token once the listing renders, so a page sized on the raw JSON would be
    // cut later by the runner and skip its continuation entries.
    const plain = Array.from({ length: 300 }, (_, index) => entry(index, 1000));
    const reserved = plain.map((item) => ({
      ...item,
      description: '<skill>'.repeat(125),
    }));

    const plainListing = skillCatalogEnvelope(plain, { offset: 0 });
    const reservedListing = skillCatalogEnvelope(reserved, { offset: 0 });

    expect(
      measureJson(neutralizeReservedDelimitersDeep(reservedListing)),
    ).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
    expect(reservedListing.skills.length).toBeLessThan(
      plainListing.skills.length,
    );
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
    expect(
      measureJson(neutralizeReservedDelimitersDeep(listing)),
    ).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
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

    expect(
      measureJson(neutralizeReservedDelimitersDeep(listing)),
    ).toBeLessThanOrEqual(RESULT_TRUNCATE_CHARS);
    expect(listing.nextOffset).toBe(100 + listing.skills.length);
  });

  it('carries entry diagnostics into the listing', () => {
    // A DIAGNOSTIC-bearing entry must arrive intact: a projection that dropped
    // or aliased the array would hide the only operator-facing explanation of
    // why an entry is unavailable.
    const broken: SkillCatalogEntry = {
      ...entry(1, 20),
      description: null,
      available: false,
      diagnostics: ['SKILL.md frontmatter is missing a description.'],
    };

    const listing = skillCatalogEnvelope([broken], { offset: 0 });

    expect(listing.skills[0].diagnostics).toEqual([
      'SKILL.md frontmatter is missing a description.',
    ]);
  });

  it('reports a continuation only when entries remain past the page', () => {
    const entries = Array.from({ length: 5 }, (_, index) => entry(index, 20));

    // Exactly the whole set: no continuation.
    expect(
      skillCatalogEnvelope(entries, { offset: 0, limit: 5 }),
    ).not.toHaveProperty('nextOffset');
    // One short of the whole set: a continuation starting at the last entry.
    expect(
      skillCatalogEnvelope(entries, { offset: 0, limit: 4 }).nextOffset,
    ).toBe(4);
    // A window past the end still reports nothing more.
    expect(
      skillCatalogEnvelope(entries, { offset: 5, limit: 1 }),
    ).not.toHaveProperty('nextOffset');
  });

  it('offsets the continuation by the requested window, not just the page', () => {
    // `offset + shown` rather than `shown`: resuming must account for where the
    // window STARTED, or a non-zero offset would re-serve earlier entries.
    const entries = Array.from({ length: 20 }, (_, index) => entry(index, 20));

    const listing = skillCatalogEnvelope(entries, { offset: 10, limit: 3 });

    expect(listing.skills.map((skill) => skill.name)).toEqual([
      'skill-00010',
      'skill-00011',
      'skill-00012',
    ]);
    expect(listing.nextOffset).toBe(13);
  });

  it('reports no continuation when the window reaches past the end', () => {
    const entries = Array.from({ length: 3 }, (_, index) => entry(index, 20));

    // The requested window runs off the end, so there is nothing to resume to.
    const listing = skillCatalogEnvelope(entries, { offset: 2, limit: 5 });

    expect(listing.skills.map((skill) => skill.name)).toEqual(['skill-00002']);
    expect(listing).not.toHaveProperty('nextOffset');
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
