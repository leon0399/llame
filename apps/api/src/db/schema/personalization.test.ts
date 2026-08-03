import { getTableConfig } from 'drizzle-orm/pg-core';

import { personalization } from './index';

describe('personalization schema', () => {
  it('stores one owner-scoped profile per user with RLS enabled', () => {
    const config = getTableConfig(personalization);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(config.enableRLS).toBe(true);
    expect(columns).toMatchObject({
      user_id: { notNull: true, primary: true },
      // Every authored field is nullable: "no value" must be representable, and
      // is what the render projection omits from the context entirely.
      preferred_name: { notNull: false },
      about: { notNull: false },
      response_preferences: { notNull: false },
      enabled: { notNull: true },
      share_account_identity: { notNull: true },
      created_at: { notNull: true },
      updated_at: { notNull: true },
    });
  });

  it('defaults enabled on and account-identity sharing off', () => {
    // The asymmetry is the decision, not an accident (design D4a): `enabled`
    // gates only authored content, so on-by-default costs nothing; identity is
    // account-derived, so on-by-default would move existing users' addresses to
    // the configured provider the moment an operator references them.
    expect(personalization.enabled.default).toBe(true);
    expect(personalization.shareAccountIdentity.default).toBe(false);
  });

  it('exposes owner-only policies with no public-read branch', () => {
    const config = getTableConfig(personalization);

    expect(
      config.policies.map(({ name, for: operation }) => [name, operation]),
    ).toEqual([
      ['personalization_owner_select', 'select'],
      ['personalization_owner_insert', 'insert'],
      ['personalization_owner_update', 'update'],
      ['personalization_owner_delete', 'delete'],
    ]);

    // Unlike chats, personalization is never reachable through the shared-chat
    // path, so no policy may admit the empty (public) identity. Every policy
    // compares against app.current_user_id, which is '' under runAsPublic.
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

  it('cascades the profile away with its user', () => {
    const config = getTableConfig(personalization);
    const [foreignKey] = config.foreignKeys;

    expect(foreignKey?.onDelete).toBe('cascade');
    expect(
      foreignKey?.reference().foreignColumns.map((column) => column.name),
    ).toEqual(['id']);
  });
});
