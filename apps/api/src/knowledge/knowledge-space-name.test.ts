import { normalizeKnowledgeSpaceName } from './knowledge-space-name';

describe('Knowledge Space names', () => {
  it('trims names before validation and persistence', () => {
    expect(normalizeKnowledgeSpaceName('  Personal  ')).toBe('Personal');
  });

  it('counts Unicode code points rather than UTF-16 code units', () => {
    expect(normalizeKnowledgeSpaceName('😀'.repeat(100))).toBe(
      '😀'.repeat(100),
    );
    expect(() => normalizeKnowledgeSpaceName('😀'.repeat(101))).toThrow();
  });

  it.each([
    '',
    '   ',
    `a${String.fromCodePoint(0x0000)}b`,
    `a${String.fromCodePoint(0x200e)}b`,
    `a${String.fromCodePoint(0x2028)}b`,
    `a${String.fromCodePoint(0x2029)}b`,
  ])('rejects invalid label %j', (name) => {
    expect(() => normalizeKnowledgeSpaceName(name)).toThrow();
  });

  it('allows duplicate labels', () => {
    expect(normalizeKnowledgeSpaceName('Personal')).toBe('Personal');
    expect(normalizeKnowledgeSpaceName('Personal')).toBe('Personal');
  });
});
