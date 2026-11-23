import { formatSkillLocator, parseSkillLocator } from './skill-locator';

/** The shared refusal, pinned once so a reverted form set fails this file. */
const SHARED_REFUSAL =
  'A line selector is :L5, :L5-10, :L5+10, :L5-, or :-L5, or a comma-separated list of them. A bare number also reads as a line. :raw is the whole file, or :raw: followed by a list of them, and :outline takes one of them after the colon. A line number starts at 1.';

describe('parseSkillLocator', () => {
  it('addresses the catalog for the bare and selector-only forms', () => {
    expect(parseSkillLocator('')).toEqual({ catalog: true });
    expect(parseSkillLocator(':raw')).toEqual({
      catalog: true,
      selector: 'raw',
    });
    expect(parseSkillLocator(':1-50')).toEqual({
      catalog: true,
      selector: '1-50',
    });
    expect(parseSkillLocator(':outline')).toEqual({
      catalog: true,
      selector: 'outline',
    });
  });

  it('addresses the package root, its directory, and a resource', () => {
    expect(parseSkillLocator('pdf')).toEqual({ name: 'pdf' });
    expect(parseSkillLocator('pdf/')).toEqual({
      name: 'pdf',
      trailingSeparator: true,
    });
    expect(parseSkillLocator('pdf/references/formats.md')).toEqual({
      name: 'pdf',
      relativePath: 'references/formats.md',
    });
  });

  it('separates a selector from the path it reads', () => {
    expect(parseSkillLocator('pdf:raw')).toEqual({
      name: 'pdf',
      selector: 'raw',
    });
    expect(parseSkillLocator('pdf:10-20')).toEqual({
      name: 'pdf',
      selector: '10-20',
    });
    expect(parseSkillLocator('pdf/scripts/extract.py:5+10')).toEqual({
      name: 'pdf',
      relativePath: 'scripts/extract.py',
      selector: '5+10',
    });
  });

  it('preserves outline selectors on package roots and resources', () => {
    expect(parseSkillLocator('pdf:outline')).toEqual({
      name: 'pdf',
      selector: 'outline',
    });
    expect(parseSkillLocator('pdf/ref.md:outline:2-4')).toEqual({
      name: 'pdf',
      relativePath: 'ref.md',
      selector: 'outline:2-4',
    });
  });

  it('decodes resource segments exactly once', () => {
    expect(parseSkillLocator('pdf/references/a%20b.md')).toEqual({
      name: 'pdf',
      relativePath: 'references/a b.md',
    });
    // An encoded colon stays part of the filename, not a selector.
    expect(parseSkillLocator('pdf/notes%3A1.md')).toEqual({
      name: 'pdf',
      relativePath: 'notes:1.md',
    });
  });

  it.each([
    'PDF',
    '-pdf',
    'pdf--x',
    'pdf:raw/x',
    // A path part is decoded and validated before the suffix is judged, so a
    // suffix on a path the resolver would refuse is `invalid_path`, never an
    // `invalid_selector` whose hint names a locator that cannot open.
    'pdf/%ZZ',
    'pdf/%ZZ:1-2',
    'pdf/a%2Fb:1-2',
    'pdf/../research:1-2',
    'pdf/%2e%2e/secret',
    'pdf//',
    'pdf//:1-2',
    'pdf//guide.md',
    'pdf/./guide.md',
    String.raw`pdf/back\slash`,
    'pdf/nul\u0000byte',
    'pdf/\uD800:1-2',
    'pdf/\uD800:nonsense',
    `pdf/${Array.from({ length: 33 }, () => 'a').join('/')}`,
    `pdf/${'a'.repeat(1025)}`,
  ])('rejects the malformed locator %s as an invalid path', (rest) => {
    expect(parseSkillLocator(rest)).toStrictEqual({
      type: 'invalid_path',
      message: 'The skill locator is invalid.',
    });
  });

  it.each([
    // A resource path has an encoded spelling to name after the forms; the
    // catalog and a package root address no resource, so nothing is spelled.
    ['pdf/references/a:b.md', 'skill://pdf/references/a%3Ab.md'],
    ['pdf/references/x:5-10,,20-30', 'skill://pdf/references/x%3A5-10,,20-30'],
    ['pdf:raw:outline', undefined],
    [':5-10,,20-30', undefined],
    ['pdf:notaselector', undefined],
    [':raw:outline', undefined],
    [':outline:1,3', undefined],
    ['pdf:outline:1,3', undefined],
    ['pdf/ref.md:outline:1,3', 'skill://pdf/ref.md%3Aoutline%3A1,3'],
    ['pdf:outline:raw', undefined],
    ['pdf:outline:', undefined],
  ])('reports %s as an invalid selector', (rest, spelling) => {
    const parsed = parseSkillLocator(rest);
    expect(parsed).toMatchObject({ type: 'invalid_selector' });

    if (spelling !== undefined) {
      expect(parsed).toHaveProperty(
        'message',
        expect.stringContaining(spelling),
      );
    }
  });

  it('answers a malformed selector with the shared forms and the spelling', () => {
    // A letter that is not the unit is outside the grammar, so the suffix is
    // refused: the forms come first, then the `%3A` spelling of the locator.
    expect(parseSkillLocator('pdf/ref.md:5-10x')).toStrictEqual({
      type: 'invalid_selector',
      message: `${SHARED_REFUSAL} For a literal colon, write this locator as skill://pdf/ref.md%3A5-10x`,
    });
  });

  it('encodes a percent in the suffix so the hint reads the same file', () => {
    // `a:100%.md` splits at the colon, so the suffix carries a literal `%`.
    // The hint must encode it before the colon, or the locator it names decodes
    // to something else on the next attempt.
    const parsed = parseSkillLocator('pdf/ref/a:100%.md');
    expect(parsed).toMatchObject({ type: 'invalid_selector' });
    expect(parsed).toHaveProperty(
      'message',
      expect.stringContaining('skill://pdf/ref/a%3A100%25.md'),
    );
    const hinted = parseSkillLocator('pdf/ref/a%3A100%25.md');
    expect(hinted).toStrictEqual({
      name: 'pdf',
      relativePath: 'ref/a:100%.md',
    });
  });

  it.each([
    [
      'pdf/notes/:foo',
      'skill://pdf/notes/%3Afoo',
      'pdf/notes/%3Afoo',
      'notes/:foo',
    ],
    [
      'pdf/notes/:50%.md',
      'skill://pdf/notes/%3A50%25.md',
      'pdf/notes/%3A50%25.md',
      'notes/:50%.md',
    ],
  ] as const)(
    'keeps the trailing separator in the invalid-selector spelling for %s',
    (
      rest: string,
      spelling: string,
      hintedRest: string,
      relativePath: string,
    ) => {
      const parsed = parseSkillLocator(rest);
      expect(parsed).toMatchObject({ type: 'invalid_selector' });
      expect(parsed).toHaveProperty(
        'message',
        expect.stringContaining(spelling),
      );
      expect(parseSkillLocator(hintedRest)).toStrictEqual({
        name: 'pdf',
        relativePath,
      });
    },
  );
  it.each([
    ['pdf:-5', { name: 'pdf', selector: '-5' }],
    ['pdf:5-', { name: 'pdf', selector: '5-' }],
    [':-10', { catalog: true, selector: '-10' }],
    ['pdf:1-5:raw', { name: 'pdf', selector: '1-5:raw' }],
    [
      'pdf/ref.md:1-5:raw',
      { name: 'pdf', relativePath: 'ref.md', selector: '1-5:raw' },
    ],
    // The unit letter, the refused shapes, and the line-and-column form all
    // reach this layer as written: the split hands the selector on and the
    // applier is what drops the letter or refuses the shape.
    [
      'pdf/ref.md:L5-10',
      { name: 'pdf', relativePath: 'ref.md', selector: 'L5-10' },
    ],
    [
      'pdf/ref.md:L-5',
      { name: 'pdf', relativePath: 'ref.md', selector: 'L-5' },
    ],
    ['pdf/ref.md:P3', { name: 'pdf', relativePath: 'ref.md', selector: 'P3' }],
    [
      'pdf/ref.md:outline:12:5',
      { name: 'pdf', relativePath: 'ref.md', selector: 'outline:12:5' },
    ],
    [
      'pdf/ref.md:12:5',
      { name: 'pdf', relativePath: 'ref.md', selector: '12:5' },
    ],
  ])(
    'accepts the members, the raw forms, and the line-and-column form in %s',
    (rest, parsed) => {
      expect(parseSkillLocator(rest)).toStrictEqual(parsed);
    },
  );
});

describe('formatSkillLocator', () => {
  it('re-encodes the canonical resource identity without the selector', () => {
    expect(formatSkillLocator({ catalog: true })).toBe('skill://');
    expect(formatSkillLocator({ name: 'pdf' })).toBe('skill://pdf');
    expect(formatSkillLocator({ name: 'pdf', selector: 'raw' })).toBe(
      'skill://pdf',
    );
    expect(formatSkillLocator({ name: 'pdf', relativePath: 'a b/c.md' })).toBe(
      'skill://pdf/a%20b/c.md',
    );
    expect(formatSkillLocator({ name: 'pdf', trailingSeparator: true })).toBe(
      'skill://pdf/',
    );
  });

  it('round-trips a written locator to one canonical spelling', () => {
    const written = 'skill://pdf/references/a%20b.md:raw';
    const parsed = parseSkillLocator(written.slice('skill://'.length));

    if ('type' in parsed) throw new Error('the written locator should parse');
    expect(parsed).toStrictEqual({
      name: 'pdf',
      relativePath: 'references/a b.md',
      selector: 'raw',
    });
    expect(formatSkillLocator(parsed)).toBe('skill://pdf/references/a%20b.md');
  });
});
