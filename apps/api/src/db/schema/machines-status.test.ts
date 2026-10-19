import { is, SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { machinesStatus } from './index';

const dialect = new PgDialect();

function checkSql(name: string): string {
  const check = getTableConfig(machinesStatus).checks.find(
    (candidate) => candidate.name === name,
  );
  if (check === undefined) throw new Error(`${name} missing`);
  return dialect.sqlToQuery(check.value).sql;
}

describe('machines_status schema', () => {
  it('keeps the name grammar and the closed failure vocabulary as named checks', () => {
    const config = getTableConfig(machinesStatus);

    expect(config.checks.map(({ name }) => name)).toEqual([
      'machines_status_name_check',
      'machines_status_failure_reason_check',
    ]);
    expect(checkSql('machines_status_name_check')).toBe(
      `"machines_status"."name" ~ '^[a-z0-9-]{1,63}$'`,
    );
    // The exact body is asserted, vocabulary included: a check that lost a
    // reason (or gained one machines-status.ts does not know) would admit a row
    // the derivation cannot classify.
    expect(checkSql('machines_status_failure_reason_check')).toBe(
      `"machines_status"."last_failure_reason" IS NULL OR "machines_status"."last_failure_reason" IN ('unreachable', 'host_key_mismatch', 'auth_failed', 'incompatible_version', 'session_lost')`,
    );
  });

  it('stores the contact, failure, and daemon report columns with an empty roots default', () => {
    const config = getTableConfig(machinesStatus);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(config.enableRLS).toBe(true);
    expect(Object.keys(columns).sort()).toEqual([
      'daemon_protocol_version',
      'daemon_version',
      'first_contact_at',
      'hub_protocol_version',
      'last_contact_at',
      'last_failure_at',
      'last_failure_reason',
      'name',
      'roots',
      'updated_at',
    ]);
    expect(columns.name).toMatchObject({ notNull: true, primary: true });
    expect(columns.hub_protocol_version.notNull).toBe(true);
    // A failure is not a contact: both contact stamps are nullable, and a row
    // llame has only ever failed to reach carries neither.
    expect(columns.first_contact_at.notNull).toBe(false);
    expect(columns.last_contact_at.notNull).toBe(false);
    expect(columns.last_failure_at.notNull).toBe(false);
    expect(columns.last_failure_reason.notNull).toBe(false);
    expect(columns.daemon_protocol_version.notNull).toBe(false);
    expect(columns.daemon_version.notNull).toBe(false);
    expect(columns.roots.notNull).toBe(true);
    expect(columns.updated_at.notNull).toBe(true);

    const rootsDefault = columns.roots.default;
    if (!is(rootsDefault, SQL))
      throw new Error('roots default missing or not SQL');
    expect(dialect.sqlToQuery(rootsDefault).sql).toBe(`'[]'::jsonb`);
  });

  it('keeps one authenticated select policy and the system-only write policy', () => {
    const policies = getTableConfig(machinesStatus).policies.map((policy) => ({
      name: policy.name,
      for: policy.for,
      using:
        policy.using === undefined
          ? null
          : dialect.sqlToQuery(policy.using).sql,
      withCheck:
        policy.withCheck === undefined
          ? null
          : dialect.sqlToQuery(policy.withCheck).sql,
    }));

    // An empty identity must match nothing, and the write policy is one
    // `for: 'all'` predicate on both USING and WITH CHECK, so a request that
    // never sets the marker cannot write status and the identity-less writer
    // can still see the row it updates.
    expect(policies).toEqual([
      {
        name: 'machines_status_authenticated_select',
        for: 'select',
        using: `current_setting('app.current_user_id', true) <> ''`,
        withCheck: null,
      },
      {
        name: 'machines_status_system_write',
        for: 'all',
        using: `current_setting('app.machines_system', true) = '1'`,
        withCheck: `current_setting('app.machines_system', true) = '1'`,
      },
    ]);
  });
});
