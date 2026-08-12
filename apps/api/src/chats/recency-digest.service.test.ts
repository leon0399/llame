import { describe, expect, it } from 'vitest';

import {
  buildRecencyDigestBaseline,
  truncateRecencyDigestExcerpt,
} from './recency-digest.service';

describe('recency digest baseline', () => {
  it('truncates at a Unicode code-point boundary', () => {
    expect(truncateRecencyDigestExcerpt('😀'.repeat(200) + 'x')).toHaveLength(
      400,
    );
    expect(
      Array.from(truncateRecencyDigestExcerpt('😀'.repeat(200) + 'x')),
    ).toHaveLength(200);
    expect(
      Array.from(truncateRecencyDigestExcerpt('Привет'.repeat(40))),
    ).toHaveLength(200);
  });

  it('freezes four renderable fields and never an identifier', () => {
    const baseline = buildRecencyDigestBaseline({
      pinned: [
        {
          id: 'must-not-render',
          title: 'Pinned',
          updatedAt: new Date('2026-08-12T12:00:00.000Z'),
          messages: [
            { role: 'user', seq: 1, parts: [{ type: 'text', text: 'hello' }] },
          ],
        },
      ],
      recent: [],
      pinnedTotal: 1,
      recentTotal: 0,
      compiledOn: new Date('2026-08-12T00:00:00.000Z'),
    });

    expect(baseline).toEqual({
      pinned: [
        {
          title: 'Pinned',
          date: '2026-08-12',
          messageCount: 1,
          excerpt: 'hello',
        },
      ],
      recent: [],
      pinnedShown: 1,
      pinnedTotal: 1,
      recentShown: 0,
      recentTotal: 0,
      compiledOn: '2026-08-12',
    });
    expect(JSON.stringify(baseline)).not.toContain('must-not-render');
  });
});
