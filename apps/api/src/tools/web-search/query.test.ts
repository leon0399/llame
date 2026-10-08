import { describe, expect, it } from 'vitest';
import { splitSiteFilters } from './query';

describe('splitSiteFilters', () => {
  it.each([
    [
      '  latest   SITE:Example.test -site:spam.test  updates  ',
      {
        query: 'latest updates',
        include: ['Example.test'],
        exclude: ['spam.test'],
      },
    ],
    [
      'site:one.test site:two.test -SITE:three.test',
      {
        query: '',
        include: ['one.test', 'two.test'],
        exclude: ['three.test'],
      },
    ],
    [
      'before site:example.test/path after',
      { query: 'before after', include: ['example.test/path'], exclude: [] },
    ],
  ])('extracts site operators from %s', (query, expected) => {
    expect(splitSiteFilters(query)).toStrictEqual(expected);
  });

  it('keeps punctuation-wrapped site operators in the query', () => {
    expect(splitSiteFilters('"rust site:docs.rs" async')).toStrictEqual({
      query: '"rust site:docs.rs" async',
      include: [],
      exclude: [],
    });
    expect(splitSiteFilters('(site:a.com OR site:b.com) x')).toStrictEqual({
      query: '(site:a.com OR site:b.com) x',
      include: [],
      exclude: [],
    });
  });

  it.each([
    'site:',
    '-site:',
    'site:()',
    '-site:""',
    'xsite:example.test',
    'not-site:example.test',
  ])('keeps a non-token site expression %s', (query) => {
    expect(splitSiteFilters(query)).toStrictEqual({
      query,
      include: [],
      exclude: [],
    });
  });

  it('collapses whitespace after removing filters', () => {
    expect(splitSiteFilters('\talpha\nsite:a.test\r\n beta')).toStrictEqual({
      query: 'alpha beta',
      include: ['a.test'],
      exclude: [],
    });
  });
});
