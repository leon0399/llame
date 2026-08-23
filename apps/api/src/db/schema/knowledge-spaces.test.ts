import { getTableConfig } from 'drizzle-orm/pg-core';

import { knowledgeSpaces } from './index';

describe('knowledge_spaces schema', () => {
  it('stores one opaque stable ID per owner and no local binding data', () => {
    const config = getTableConfig(knowledgeSpaces);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(config.enableRLS).toBe(true);
    expect(columns).toMatchObject({
      knowledge_space_id: { notNull: true, primary: true },
      owner_user_id: { notNull: true },
    });
    expect(columns).not.toHaveProperty('root');
    expect(columns).not.toHaveProperty('path');
    expect(columns).not.toHaveProperty('source_key');

    expect(columns.owner_user_id.isUnique).toBe(true);
  });

  it('exposes explicit owner-only policies for every mutation', () => {
    const config = getTableConfig(knowledgeSpaces);

    expect(
      config.policies.map(({ name, for: operation }) => [name, operation]),
    ).toEqual([
      ['knowledge_spaces_owner_select', 'select'],
      ['knowledge_spaces_owner_insert', 'insert'],
      ['knowledge_spaces_owner_update', 'update'],
      ['knowledge_spaces_owner_delete', 'delete'],
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

  it('references the tenant user with cascade deletion', () => {
    const config = getTableConfig(knowledgeSpaces);
    const [foreignKey] = config.foreignKeys;

    expect(foreignKey?.onDelete).toBe('cascade');
    expect(
      foreignKey?.reference().foreignColumns.map((column) => column.name),
    ).toEqual(['id']);
  });
});
