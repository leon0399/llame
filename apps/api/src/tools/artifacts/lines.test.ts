import {
  ARTIFACT_LINE_UNITS,
  artifactLineCount,
  artifactLinePieces,
  artifactText,
} from './lines';

describe('artifact line numbering', () => {
  it('counts a source line up to the bound as one line', () => {
    const source = `${'a'.repeat(ARTIFACT_LINE_UNITS)}\nb\n`;

    expect(artifactLineCount(source)).toBe(2);
    expect(artifactLinePieces(source)).toEqual([
      'a'.repeat(ARTIFACT_LINE_UNITS),
      'b',
    ]);
  });

  it('turns a longer line into one line per piece', () => {
    const long = 'x'.repeat(ARTIFACT_LINE_UNITS * 2 + 1);
    const source = `head\n${long}\n${long}tail\n`;

    expect(artifactLineCount(source)).toBe(7);
    expect(artifactLinePieces(source).map((piece) => piece.length)).toEqual([
      4,
      ARTIFACT_LINE_UNITS,
      ARTIFACT_LINE_UNITS,
      1,
      ARTIFACT_LINE_UNITS,
      ARTIFACT_LINE_UNITS,
      5,
    ]);
    expect(artifactText(source).split('\n')).toHaveLength(8);
    expect(artifactText(source).endsWith('xtail\n')).toBe(true);
  });

  it('ends a piece on a code-point boundary', () => {
    // The pair occupies units 8,000 and 8,001, so the boundary index points at
    // its low half: the piece ends before the pair and the next piece opens it.
    const body = `${'a'.repeat(ARTIFACT_LINE_UNITS - 1)}😀end`;
    const pieces = artifactLinePieces(body);

    expect(pieces).toEqual(['a'.repeat(ARTIFACT_LINE_UNITS - 1), `😀end`]);
    expect(pieces.join('')).toBe(body);
  });

  it('reproduces a source without a long line and keeps its terminator', () => {
    expect(artifactText('a\nb\n')).toBe('a\nb\n');
    expect(artifactText('a\nb')).toBe('a\nb');
    expect(artifactLineCount('\n')).toBe(1);
    expect(artifactLineCount('')).toBe(0);
  });
});
