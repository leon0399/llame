import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SkillCatalog } from './skill-catalog';
import {
  SKILL_BASELINE_MAX_BYTES,
  SKILL_BASELINE_MAX_ENTRIES,
  baselineMatchesEpoch,
  boundSkillCatalog,
  proactivelyEligible,
  resolveSkillCatalogBaseline,
} from './skill-prompt-baseline';
import { type SkillCatalogEntry, type SkillCatalogPort } from './skill-catalog';
import { type SkillCatalogBaseline } from '../db/schema/chats';

function entry(
  name: string,
  description: string | null,
  overrides: Partial<SkillCatalogEntry> = {},
): SkillCatalogEntry {
  return {
    name,
    description,
    proactive: true,
    sourceDirectory: '/opt/skills',
    skillDirectory: `/opt/skills/${name}`,
    available: true,
    diagnostics: [],
    ...overrides,
  };
}

function catalogOf(
  entries: ReadonlyArray<SkillCatalogEntry>,
): SkillCatalogPort {
  return {
    getSnapshot: () => ({
      available: true,
      directories: ['/opt/skills'],
      entries: [...entries],
      diagnostics: [],
    }),
  };
}

/** Assert a resolution produced a baseline, and narrow it for the assertions. */
function defined(
  value: SkillCatalogBaseline | undefined,
): SkillCatalogBaseline {
  if (value === undefined) throw new Error('expected a resolved baseline');
  return value;
}

describe('proactivelyEligible', () => {
  it('excludes manual-only and invalid packages', () => {
    const catalog = catalogOf([
      entry('pdf', 'd'),
      entry('review', 'd', { proactive: false }),
      entry('broken', null, { available: false }),
    ]);

    expect(proactivelyEligible(catalog)?.map((e) => e.name)).toEqual(['pdf']);
  });

  it('returns nothing for an empty catalog', () => {
    expect(proactivelyEligible(new SkillCatalog([]))).toEqual([]);
  });

  it('reports unavailability rather than an empty eligible set', () => {
    // A source that cannot be read is NOT a catalog with zero eligible skills.
    // Conflating them would freeze an empty advertisement onto the chat for a
    // whole epoch, so this distinction is the one that matters.
    const missing = new SkillCatalog([
      // Unique per run: a fixed name under a shared tmpdir could exist, and
      // then this asserts nothing.
      path.join(tmpdir(), `no-such-skills-dir-${randomUUID()}`),
    ]);

    expect(proactivelyEligible(missing)).toBeUndefined();
    expect(resolveSkillCatalogBaseline(missing)).toBeUndefined();
  });

  it('still resolves a genuinely empty catalog', () => {
    // No configured source at all is an authoritative empty catalog, not an
    // outage: there is nothing to retry.
    expect(resolveSkillCatalogBaseline(new SkillCatalog([]))).toEqual({
      entries: [],
      omitted: 0,
    });
  });
});

describe('boundSkillCatalog', () => {
  it('orders entries by code point, not by input order', () => {
    const baseline = boundSkillCatalog([
      entry('zeta', 'z'),
      entry('alpha', 'a'),
      entry('Beta', 'b'),
    ]);

    // Uppercase sorts before lowercase in code-point order, unlike locale
    // collation — the order the prompt advertises must be deterministic.
    expect(baseline.entries.map((e) => e.name)).toEqual([
      'Beta',
      'alpha',
      'zeta',
    ]);
  });

  it('omits nothing when the whole catalog fits', () => {
    const baseline = boundSkillCatalog([entry('pdf', 'Extract')]);

    expect(baseline).toEqual({
      entries: [{ name: 'pdf', description: 'Extract' }],
      omitted: 0,
    });
  });

  it('stops at the entry count and reports the remainder as omitted', () => {
    const entries = Array.from(
      { length: SKILL_BASELINE_MAX_ENTRIES + 4 },
      (_, i) => entry(`skill-${String(i).padStart(4, '0')}`, 'd'),
    );

    const baseline = boundSkillCatalog(entries);

    expect(baseline.entries).toHaveLength(SKILL_BASELINE_MAX_ENTRIES);
    expect(baseline.omitted).toBe(4);
    // The first N in code-point order survive, so the advertised set is a
    // prefix rather than an arbitrary slice.
    expect(baseline.entries[0].name).toBe('skill-0000');
  });

  it('retains only whole entries under the byte bound', () => {
    // Each entry costs its name plus a 3 KiB description, so 16 KiB admits
    // five whole entries and cannot admit a sixth.
    const entries = Array.from({ length: 8 }, (_, i) =>
      entry(`s${i}`, 'x'.repeat(3 * 1024)),
    );

    const baseline = boundSkillCatalog(entries);
    const bytes = baseline.entries.reduce(
      (total, e) =>
        total + Buffer.byteLength(e.name) + Buffer.byteLength(e.description),
      0,
    );

    expect(baseline.entries).toHaveLength(5);
    expect(bytes).toBeLessThanOrEqual(SKILL_BASELINE_MAX_BYTES);
    expect(baseline.omitted).toBe(3);
  });

  it('admits a many-entry catalog whose entries are individually tiny', () => {
    // The byte bound alone would admit thousands of one-character entries,
    // which is why the count cap exists: the template owns the per-entry
    // markup, so the count fixes that multiplier.
    const entries = Array.from({ length: 1000 }, (_, i) => entry(`s${i}`, ''));

    const baseline = boundSkillCatalog(entries);

    expect(baseline.entries).toHaveLength(SKILL_BASELINE_MAX_ENTRIES);
    expect(baseline.omitted).toBe(1000 - SKILL_BASELINE_MAX_ENTRIES);
  });

  it('counts a multi-byte description in bytes rather than characters', () => {
    // Two bytes per character here, so the byte bound bites well before the
    // entry count would.
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry(`s${i}`, 'é'.repeat(2 * 1024)),
    );

    const baseline = boundSkillCatalog(entries);

    expect(baseline.entries.length).toBeLessThanOrEqual(4);
    const bytes = baseline.entries.reduce(
      (total, e) => total + Buffer.byteLength(e.description, 'utf8'),
      0,
    );
    expect(bytes).toBeLessThanOrEqual(SKILL_BASELINE_MAX_BYTES);
  });
});

describe('resolveSkillCatalogBaseline', () => {
  it('resolves the eligible set through the catalog', () => {
    const baseline = defined(
      resolveSkillCatalogBaseline(
        catalogOf([
          entry('pdf', 'Extract'),
          entry('review', 'Review', { proactive: false }),
        ]),
      ),
    );

    expect(baseline.entries.map((e) => e.name)).toEqual(['pdf']);
    expect(baseline.omitted).toBe(0);
  });
});

describe('baselineMatchesEpoch', () => {
  const baseline = { entries: [], omitted: 0 };

  it('reuses a baseline bound to the current compaction', () => {
    expect(baselineMatchesEpoch(baseline, 'compaction-1', 'compaction-1')).toBe(
      true,
    );
  });

  it('reuses an uncompacted chat baseline, which pairs null with null', () => {
    expect(baselineMatchesEpoch(baseline, null, null)).toBe(true);
  });

  it('re-resolves after a new compaction', () => {
    expect(baselineMatchesEpoch(baseline, 'compaction-1', 'compaction-2')).toBe(
      false,
    );
    // A chat compacted while it already had a baseline needs a new epoch even
    // though the stored id is non-null.
    expect(baselineMatchesEpoch(baseline, null, 'compaction-1')).toBe(false);
  });

  it('re-resolves when no baseline was ever stored', () => {
    expect(baselineMatchesEpoch(null, null, null)).toBe(false);
    expect(baselineMatchesEpoch(null, 'compaction-1', 'compaction-1')).toBe(
      false,
    );
  });
});
