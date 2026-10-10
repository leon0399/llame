import {
  isCanonicalMediaId,
  mediaLocator,
  parseMediaLocator,
} from './media-locator';

const ID = '01927c1e-8f3a-7b2c-9d4e-5f6a7b8c9d0e';

describe('media locator grammar', () => {
  it('formats and parses the canonical locator', () => {
    expect(mediaLocator(ID)).toBe(`media://${ID}`);
    expect(parseMediaLocator(`media://${ID}`)).toBe(ID);
  });

  it('reserves bare media:// as invalid, not a listing', () => {
    expect(parseMediaLocator('media://')).toBeUndefined();
  });

  it('rejects upper-case hex digits', () => {
    expect(parseMediaLocator(`media://${ID.toUpperCase()}`)).toBeUndefined();
    expect(isCanonicalMediaId(ID.toUpperCase())).toBe(false);
  });

  it('rejects anything but exactly one canonical UUID after the scheme', () => {
    for (const locator of [
      `media://${ID}/`,
      `media://${ID}:raw`,
      `media://{${ID}}`,
      `media://${ID.replaceAll('-', '')}`,
      `MEDIA://${ID}`,
      `media:/${ID}`,
      ` media://${ID}`,
      `kb://${ID}`,
    ]) {
      expect(parseMediaLocator(locator)).toBeUndefined();
    }
  });

  it('accepts only the lower-case canonical id shape', () => {
    expect(isCanonicalMediaId(ID)).toBe(true);
    expect(isCanonicalMediaId('')).toBe(false);
    expect(isCanonicalMediaId(`${ID}x`)).toBe(false);
    expect(isCanonicalMediaId('not-a-uuid')).toBe(false);
  });
});
