import {
  KnowledgeSpaceNameError,
  normalizeKnowledgeSpaceName,
} from './knowledge-space-name';

describe('Knowledge Space names', () => {
  it('trims names before validation and persistence', () => {
    expect(normalizeKnowledgeSpaceName('  Personal  ')).toBe('Personal');
  });

  it('counts Unicode code points rather than UTF-16 code units', () => {
    expect(normalizeKnowledgeSpaceName('😀'.repeat(100))).toBe(
      '😀'.repeat(100),
    );
    expect(() => normalizeKnowledgeSpaceName('😀'.repeat(101))).toThrow(
      KnowledgeSpaceNameError,
    );
  });

  it.each([
    '',
    '   ',
    `a${String.fromCodePoint(0x00_00)}b`,
    `a${String.fromCodePoint(0x20_0e)}b`,
    `a${String.fromCodePoint(0x20_28)}b`,
    `a${String.fromCodePoint(0x20_29)}b`,
  ])('rejects invalid label %j', (name) => {
    expect(() => normalizeKnowledgeSpaceName(name)).toThrow(
      KnowledgeSpaceNameError,
    );
  });

  it('allows duplicate labels', () => {
    expect(normalizeKnowledgeSpaceName('Personal')).toBe('Personal');
    expect(normalizeKnowledgeSpaceName('Personal')).toBe('Personal');
  });
});
