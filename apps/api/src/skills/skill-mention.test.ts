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

  it('keeps a fence open past a line that carries an info string', () => {
    // A closing fence carries no info string, so ```` ```ts ```` opens nothing
    // and closes nothing: the block runs on and its mentions stay excluded.
    expect(names('```\n$pdf\n```ts\n$research\n```\n$after')).toEqual([
      'after',
    ]);
  });

  it('excludes a mention in a span that follows an unmatched backtick run', () => {
    // The double run never finds its pair, so it is literal text - but the
    // single-backtick span after it is still code, and scanning must reach it.
    expect(names('``x `$pdf` y')).toEqual([]);
    expect(names('``x `$pdf` $research')).toEqual(['research']);
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

  it.each([
    ['a currency word', 'costs USD$pdf today'],
    ['a longer identifier', '$pdf_tools'],
    ['an uppercase continuation', '$pdfX'],
  ])('ignores a mention glued into %s', (_label, text) => {
    // The name run may be valid while the TOKEN is not: a letter, digit, or
    // underscore on either side means this is one word, not a mention.
    expect(names(text)).toEqual([]);
  });

  it('reads a digit continuation as part of the same name', () => {
    // `$pdf2x` is one valid token, so the name is `pdf2x` — not `pdf`.
    expect(names('$pdf2x')).toEqual(['pdf2x']);
  });

  it('still recognizes a mention beside punctuation', () => {
    expect(names('($pdf)')).toEqual(['pdf']);
    expect(names('[use $pdf]')).toEqual(['pdf']);
    expect(names('$pdf:')).toEqual(['pdf']);
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
