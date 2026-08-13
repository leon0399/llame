import { getTableConfig } from 'drizzle-orm/pg-core';

import { memorySettings } from './index';

describe('memory settings schema', () => {
  it('exports owner-scoped memory settings with RLS enabled', () => {
    const config = getTableConfig(memorySettings);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(config.enableRLS).toBe(true);
    expect(columns).toMatchObject({
      user_id: { notNull: true, primary: true },
      share_recent_chats: { notNull: true },
      created_at: { notNull: true },
      updated_at: { notNull: true },
    });
  });

  it('defaults recent-chat sharing off', () => {
    expect(memorySettings.shareRecentChats.default).toBe(false);
  });

  it('exposes all four owner-only policies with no public-read branch', () => {
    const config = getTableConfig(memorySettings);

    expect(
      config.policies.map(({ name, for: operation }) => [name, operation]),
    ).toEqual([
      ['memory_settings_owner_select', 'select'],
      ['memory_settings_owner_insert', 'insert'],
      ['memory_settings_owner_update', 'update'],
      ['memory_settings_owner_delete', 'delete'],
    ]);

    for (const policy of config.policies) {
      const clauses = [policy.using, policy.withCheck]
        .filter((clause) => clause !== undefined)
        .map((clause) => JSON.stringify(clause));

      expect(clauses.length).toBeGreaterThan(0);
      for (const clause of clauses) {
        expect(clause).toContain('app.current_user_id');
      }
    }
  });

  it('cascades settings away with their user', () => {
    const config = getTableConfig(memorySettings);
    const [foreignKey] = config.foreignKeys;

    expect(foreignKey?.onDelete).toBe('cascade');
    expect(
      foreignKey?.reference().foreignColumns.map((column) => column.name),
    ).toEqual(['id']);
  });
});
