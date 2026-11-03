import { describe, expect, it } from 'vitest';

import { removalFor } from '../../testing/web-search-removal';

/** One reject clause on the read group: the only shape that removes an entry. */
const rejectsGrokipedia = {
  allow: [{ field: 'path', regex: '^https://' }],
  reject: [{ field: 'path', regex: '^https://grokipedia\\.com/' }],
} as const;

describe('createResultRemoval', () => {
  it('Read-only removes a rejected host', () => {
    const removal = removalFor(rejectsGrokipedia, [], 'read-only');

    expect(removal.removes('https://grokipedia.com/page')).toBe(true);
    expect(removal.removes('https://example.com/page')).toBe(false);
  });

  it('removes a rejected host in default too', () => {
    const removal = removalFor(rejectsGrokipedia, [], 'default');

    expect(removal.removes('https://grokipedia.com/page')).toBe(true);
  });

  it('Bypass keeps the results', () => {
    const removal = removalFor(rejectsGrokipedia, [], 'bypass');

    expect(removal.removes('https://grokipedia.com/page')).toBe(false);
  });
});
