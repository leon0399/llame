import { getTableConfig } from 'drizzle-orm/pg-core';

import { compactions } from './index';

describe('compaction replacement history storage', () => {
  it('requires JSONB replacement history and has no legacy ledger column', () => {
    const columns = Object.fromEntries(
      getTableConfig(compactions).columns.map((column) => [
        column.name,
        column,
      ]),
    );
    const replacementHistory = columns['replacement_history'];

    expect(replacementHistory).toMatchObject({ notNull: true });
    expect(replacementHistory?.hasDefault).not.toBe(true);
    expect(replacementHistory?.getSQLType()).toBe('jsonb');
    expect(columns).not.toHaveProperty('tool_observation_ledger');
  });

  it('keeps replacement history owner-only with no public policy', () => {
    const config = getTableConfig(compactions);

    expect(config.enableRLS).toBe(true);
    expect(config.policies.map(({ name }) => name)).toEqual([
      'compactions_owner',
    ]);
    expect(config.policies.some(({ name }) => name.includes('public'))).toBe(
      false,
    );
  });
});
