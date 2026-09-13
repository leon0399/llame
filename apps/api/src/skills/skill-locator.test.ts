import {
  formatSkillLocator,
  parseSkillLocator,
  validateSkillResourcePath,
} from './skill-locator';

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
    'pdf:notaselector',
    'pdf/references/x:notaselector',
    'pdf:raw/x',
    'pdf/a%2Fb',
    'pdf/%ZZ',
  ])('rejects the malformed locator %s', (rest) => {
    expect(parseSkillLocator(rest)).toBeUndefined();
  });

  it('decodes once, leaving traversal for the pre-open validation', () => {
    // The parser decodes exactly once; `validateSkillResourcePath` rejects the
    // result before any open, so the two agree without double-decoding.
    expect(parseSkillLocator('pdf/%2e%2e/secret')).toEqual({
      name: 'pdf',
      relativePath: '../secret',
    });
    expect(validateSkillResourcePath('../secret')).toBeUndefined();
  });
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
    expect(parsed).toBeDefined();
    expect(formatSkillLocator(parsed!)).toBe('skill://pdf/references/a%20b.md');
  });
});

describe('validateSkillResourcePath', () => {
  it('accepts an ordinary nested resource path', () => {
    expect(validateSkillResourcePath('references/formats.md')).toEqual([
      'references',
      'formats.md',
    ]);
  });

  it.each([
    '../../../etc/passwd',
    'a/../../b',
    '/etc/passwd',
    './a',
    'a//b',
    'a/./b',
    String.raw`back\slash`,
    '',
    'nul\u0000byte',
  ])('rejects the escaping or malformed path %s', (relativePath) => {
    expect(validateSkillResourcePath(relativePath)).toBeUndefined();
  });

  it('rejects a path past the component or byte bound', () => {
    expect(
      validateSkillResourcePath(
        Array.from({ length: 33 }, () => 'a').join('/'),
      ),
    ).toBeUndefined();
    expect(validateSkillResourcePath('a'.repeat(1025))).toBeUndefined();
  });
});
