import { parseSkillMentions } from './skill-mention';

const names = (text: string): Array<string> =>
  parseSkillMentions(text).map((mention) => mention.name);

describe('parseSkillMentions', () => {
  it('recognizes a bare mention', () => {
    expect(names('please $pdf this file')).toEqual(['pdf']);
  });

  it('returns distinct names in first-mention order', () => {
    expect(names('$research then $pdf then $research again')).toEqual([
      'research',
      'pdf',
    ]);
  });

  it('matches the full valid name rather than a prefix', () => {
    expect(names('$pdf-tools')).toEqual(['pdf-tools']);
    expect(names('$pdf2')).toEqual(['pdf2']);
    // `pdf-` is not a valid name, so nothing matches — not the `pdf` prefix.
    expect(names('$pdf-')).toEqual([]);
    expect(names('$pdf--x')).toEqual([]);
  });

  it.each([
    ['a fenced block', 'text\n```\n$pdf\n```\n'],
    ['a tilde fence', 'text\n~~~\n$pdf\n~~~\n'],
    ['an inline code span', 'use `$pdf` here'],
    ['a longer inline span', 'use ``$pdf`` here'],
    ['an escaped dollar', String.raw`literally \$pdf`],
    ['an uppercase name', '$PDF'],
    ['a lone dollar', 'costs $5'],
    ['a mention glued to a word', 'usd$pdf'],
  ])('ignores %s', (_label, text) => {
    expect(names(text)).toEqual([]);
  });

  it('recognizes a mention after a closed fence', () => {
    expect(names('```\n$pdf\n```\nthen $research')).toEqual(['research']);
  });

  it('treats an all-digit token as a quantity, not a skill', () => {
    // The catalog grammar permits a digit-only name, but `$5` in prose is a
    // price; parsing it would emit a spurious not-found notice.
    expect(names('the license costs $5')).toEqual([]);
    expect(names('$12 $3')).toEqual([]);
  });

  it('still recognizes a name that merely begins with a digit', () => {
    expect(names('audit with $2fa')).toEqual(['2fa']);
  });

  it('recognizes a mention after a closed inline span', () => {
    expect(names('`$pdf` and then $research')).toEqual(['research']);
  });

  it('keeps a doubled backslash from escaping the dollar', () => {
    // `\\$pdf` is a literal backslash followed by a real mention.
    expect(names(String.raw`path \\$pdf`)).toEqual(['pdf']);
  });

  it('reports the source index of each mention', () => {
    const mentions = parseSkillMentions('hi $pdf there');
    expect(mentions).toEqual([{ name: 'pdf', index: 3 }]);
  });

  it('handles a name at the very end of the text', () => {
    expect(names('run $pdf')).toEqual(['pdf']);
  });

  it('handles a name followed immediately by punctuation', () => {
    expect(names('use $pdf.')).toEqual(['pdf']);
    expect(names('use $pdf, then $research!')).toEqual(['pdf', 'research']);
  });

  it('does not scan text that is only a fence', () => {
    expect(names('```\n$pdf\n$research\n')).toEqual([]);
  });
});
