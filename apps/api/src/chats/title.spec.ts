/**
 * Title generation unit tests (#78) — pure functions, no DB or model required.
 */

import { MAX_TITLE_LENGTH, sanitizeTitle } from './title';

describe('sanitizeTitle', () => {
  it('passes a clean title through unchanged', () => {
    expect(sanitizeTitle('Weather in NYC')).toBe('Weather in NYC');
  });

  it('strips markdown, quotes, and "Title:" prefixes the prompt forbids', () => {
    expect(sanitizeTitle('# "Space Essay Help"')).toBe('Space Essay Help');
    expect(sanitizeTitle('Title: Python Debugging')).toBe('Python Debugging');
    expect(sanitizeTitle('**Bold Title**')).toBe('Bold Title');
    expect(sanitizeTitle("'Quoted Title'")).toBe('Quoted Title');
  });

  it('collapses internal whitespace and trims', () => {
    expect(sanitizeTitle('  Weather   in\nNYC  ')).toBe('Weather in NYC');
  });

  it('clamps to the max length', () => {
    const long = 'word '.repeat(40);
    const result = sanitizeTitle(long);
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result.endsWith(' ')).toBe(false);
  });

  it('returns empty string for unusable output', () => {
    expect(sanitizeTitle('')).toBe('');
    expect(sanitizeTitle('  "#  " ')).toBe('');
  });
});
