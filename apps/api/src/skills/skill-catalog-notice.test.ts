import {
  deriveSkillCatalogDelta,
  skillCatalogDeltaFits,
  toldFromBaseline,
} from './skill-catalog-notice';

const entry = (name: string, description = `The ${name} skill.`) => ({
  name,
  description,
});

describe('deriveSkillCatalogDelta', () => {
  it('reports additions with their current description', () => {
    const delta = deriveSkillCatalogDelta({
      advertised: [entry('pdf'), entry('research', 'Plan an investigation')],
      told: ['pdf'],
    });

    expect(delta).toEqual({
      added: [{ name: 'research', description: 'Plan an investigation' }],
      removed: [],
      told: ['pdf', 'research'],
    });
  });

  it('reports removals by name only', () => {
    const delta = deriveSkillCatalogDelta({
      advertised: [entry('pdf')],
      told: ['pdf', 'legacy-review'],
    });

    expect(delta).toEqual({
      added: [],
      removed: ['legacy-review'],
      told: ['pdf'],
    });
  });

  it('reports nothing when the advertised set is unchanged', () => {
    expect(
      deriveSkillCatalogDelta({
        advertised: [entry('pdf'), entry('research')],
        told: ['pdf', 'research'],
      }),
    ).toBeNull();
  });

  it('ignores a changed description of a still-advertised entry', () => {
    // Membership is by name, so a description edit is not a catalog change in
    // this capability; reads are live, so the next load returns current content.
    expect(
      deriveSkillCatalogDelta({
        advertised: [entry('pdf', 'Totally different wording')],
        told: ['pdf'],
      }),
    ).toBeNull();
  });

  it('treats an eligibility flip as an add or a remove', () => {
    // The told state is the ADVERTISED set, so a package that becomes
    // manual-only leaves it and one that becomes proactive joins it.
    const becameManualOnly = deriveSkillCatalogDelta({
      advertised: [entry('pdf')],
      told: ['pdf', 'review'],
    });
    expect(becameManualOnly?.removed).toEqual(['review']);

    const becameProactive = deriveSkillCatalogDelta({
      advertised: [entry('pdf'), entry('review')],
      told: ['pdf'],
    });
    expect(becameProactive?.added.map((e) => e.name)).toEqual(['review']);
  });

  it('reports a whole first-time catalog as additions', () => {
    const delta = deriveSkillCatalogDelta({
      advertised: [entry('pdf'), entry('research')],
      told: [],
    });

    expect(delta?.added).toHaveLength(2);
    expect(delta?.told).toEqual(['pdf', 'research']);
  });

  it('treats an empty advertised set as a full removal', () => {
    const delta = deriveSkillCatalogDelta({
      advertised: [],
      told: ['pdf', 'research'],
    });

    expect(delta).toEqual({
      added: [],
      removed: ['pdf', 'research'],
      told: [],
    });
  });
});

describe('skillCatalogDeltaFits', () => {
  it('accepts a small delta', () => {
    expect(
      skillCatalogDeltaFits({
        added: [entry('pdf')],
        removed: ['legacy'],
        told: ['pdf'],
      }),
    ).toBe(true);
  });

  it('rejects a delta past the entry count', () => {
    expect(
      skillCatalogDeltaFits({
        added: [],
        removed: Array.from({ length: 300 }, (_, i) => `skill-${i}`),
        told: [],
      }),
    ).toBe(false);
  });

  it('rejects a delta past the byte bound', () => {
    expect(
      skillCatalogDeltaFits({
        added: [entry('pdf', 'x'.repeat(20 * 1024))],
        removed: [],
        told: [],
      }),
    ).toBe(false);
  });
});

describe('toldFromBaseline', () => {
  it('is the admitted names in order', () => {
    expect(
      toldFromBaseline({
        entries: [entry('pdf'), entry('research')],
        omitted: 3,
      }),
    ).toEqual(['pdf', 'research']);
  });

  it('is empty for a baseline that admits nothing', () => {
    expect(toldFromBaseline({ entries: [], omitted: 5 })).toEqual([]);
  });
});
