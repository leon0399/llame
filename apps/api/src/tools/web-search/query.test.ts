import { splitSiteFilters } from './query';

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
  expect(splitSiteFilters(query)).toEqual(expected);
});

it.each(['site:', '-site:', 'xsite:example.test', 'not-site:example.test'])(
  'keeps a non-token site expression %s',
  (query) => {
    expect(splitSiteFilters(query)).toEqual({
      query,
      include: [],
      exclude: [],
    });
  },
);

it('collapses whitespace after removing filters', () => {
  expect(splitSiteFilters('\talpha\nsite:a.test\r\n beta')).toEqual({
    query: 'alpha beta',
    include: ['a.test'],
    exclude: [],
  });
});
