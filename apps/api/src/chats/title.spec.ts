/**
 * Title generation unit tests (#78) — pure functions, no DB or model required.
 */

import {
  MAX_TITLE_LENGTH,
  TITLE_INPUT_MAX_CHARS,
  sanitizeTitle,
  titleFromObject,
  titlePromptInput,
  titleUserPrompt,
} from './title';

describe('sanitizeTitle', () => {
  it('passes a clean title through unchanged', () => {
    expect(sanitizeTitle('Weather in NYC')).toBe('Weather in NYC');
  });

  it('strips markdown, quotes, and "Title:" prefixes the prompt forbids', () => {
    expect(sanitizeTitle('# "Space Essay Help"')).toBe('Space Essay Help');
    expect(sanitizeTitle('Title: Python Debugging')).toBe('Python Debugging');
    expect(sanitizeTitle('**Title: Weather in NYC**')).toBe('Weather in NYC');
    expect(sanitizeTitle('"Title: Weather in NYC"')).toBe('Weather in NYC');
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

describe('titlePromptInput', () => {
  it('trims and bounds the text sent to the title model', () => {
    const result = titlePromptInput(
      `  ${'x'.repeat(TITLE_INPUT_MAX_CHARS + 50)}`,
    );

    expect(result).toHaveLength(TITLE_INPUT_MAX_CHARS);
    expect(result).toBe('x'.repeat(TITLE_INPUT_MAX_CHARS));
  });
});

describe('titleUserPrompt', () => {
  it('wraps the user text as tagged data under the titling instruction', () => {
    const prompt = titleUserPrompt('help me plan a trip');

    expect(prompt).toContain('generate a very short and descriptive title');
    expect(prompt).toContain('<user>\nhelp me plan a trip\n</user>');
  });
});

describe('titleFromObject', () => {
  it('extracts the title from a valid structured output', () => {
    expect(titleFromObject({ title: 'Trip Planning' })).toBe('Trip Planning');
  });

  it('returns undefined for malformed structured output', () => {
    expect(titleFromObject(null)).toBeUndefined();
    expect(titleFromObject('Trip Planning')).toBeUndefined();
    expect(titleFromObject({ title: 42 })).toBeUndefined();
    expect(titleFromObject({})).toBeUndefined();
  });
});
