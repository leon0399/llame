import {
  ARTIFACT_LINE_UNITS,
  artifactLineCount,
  artifactLinePieces,
  artifactText,
} from './lines';

/** One UTF-16 code unit repeated `count` times. */
function units(unit: string, count: number): string {
  return unit.repeat(count);
}

describe('artifact line numbering', () => {
  it('counts a source line up to the bound as one line', () => {
    const source = `${units('a', ARTIFACT_LINE_UNITS)}\nb\n`;

    expect(artifactLineCount(source)).toBe(2);
    expect(artifactLinePieces(source)).toEqual([
      units('a', ARTIFACT_LINE_UNITS),
      'b',
    ]);
  });

  it('turns a longer line into one line per piece', () => {
    const long = units('x', ARTIFACT_LINE_UNITS * 2 + 1);
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

  it('keeps a surrogate pair that starts exactly at the cut', () => {
    const body = `${units('a', ARTIFACT_LINE_UNITS)}😀end`;

    expect(artifactLinePieces(body)).toEqual([
      units('a', ARTIFACT_LINE_UNITS),
      '😀end',
    ]);
  });

  it('steps back when the cut falls on either low surrogate end', () => {
    for (const low of ['\uDC00', '\uDFFF']) {
      const body = `${units('a', ARTIFACT_LINE_UNITS - 1)}\uD800${low}y`;

      expect(artifactLinePieces(body)).toEqual([
        units('a', ARTIFACT_LINE_UNITS - 1),
        `\uD800${low}y`,
      ]);
    }
  });

  it('keeps a pair that ends just before the cut', () => {
    const body = `${units('a', ARTIFACT_LINE_UNITS - 2)}😀bbb`;

    expect(artifactLinePieces(body)).toEqual([
      `${units('a', ARTIFACT_LINE_UNITS - 2)}😀`,
      'bbb',
    ]);
  });

  it('does not step back for a plain code point at the cut', () => {
    const body = `${units('a', ARTIFACT_LINE_UNITS - 1)}€xy`;

    expect(artifactLinePieces(body)).toEqual([
      `${units('a', ARTIFACT_LINE_UNITS - 1)}€`,
      'xy',
    ]);
  });

  it('keeps every piece within the bound', () => {
    const body = units('😀', ARTIFACT_LINE_UNITS);

    for (const piece of artifactLinePieces(body)) {
      expect(piece.length).toBeLessThanOrEqual(ARTIFACT_LINE_UNITS);
    }
    expect(artifactLinePieces(body).join('')).toBe(body);
  });

  it('treats a CRLF terminator as the line break, not line content', () => {
    const source = `${units('a', ARTIFACT_LINE_UNITS)}\r\nb\r\n`;

    expect(artifactLineCount(source)).toBe(2);
    expect(artifactLinePieces(source)).toEqual([
      units('a', ARTIFACT_LINE_UNITS),
      'b',
    ]);
    expect(artifactText(source)).toBe(
      `${units('a', ARTIFACT_LINE_UNITS)}\nb\n`,
    );

    // 8,002 UTF-16 units with the terminator, one artifact line.
    expect(artifactLineCount(`${units('a', ARTIFACT_LINE_UNITS)}\r\n`)).toBe(1);
    expect(artifactLinePieces('a\rb\r\n')).toEqual(['a\rb']);
  });

  it('reproduces a source without a long line and keeps its terminator', () => {
    expect(artifactText('a\nb\n')).toBe('a\nb\n');
    expect(artifactText('a\nb')).toBe('a\nb');
    expect(artifactLineCount('\n')).toBe(1);
    expect(artifactLineCount('')).toBe(0);
  });
});
