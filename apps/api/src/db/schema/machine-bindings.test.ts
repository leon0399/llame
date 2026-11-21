import { is, SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { machineBindings } from './index';

const dialect = new PgDialect();

describe('machine_bindings schema', () => {
  it('keeps the Machine name grammar as the only named check', () => {
    const config = getTableConfig(machineBindings);
    const [check] = config.checks;

    if (check === undefined) throw new Error('name check missing');
    expect(config.checks.map(({ name }) => name)).toEqual([
      'machine_bindings_name_check',
    ]);
    expect(dialect.sqlToQuery(check.value).sql).toBe(
      `"machine_bindings"."name" ~ '^[a-z0-9-]{1,63}$'`,
    );
  });

  it('binds a name to one instance id and stamps the binding time', () => {
    const config = getTableConfig(machineBindings);

    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(config.enableRLS).toBe(true);
    expect(Object.keys(columns).sort()).toEqual([
      'bound_at',
      'instance_id',
      'name',
    ]);
    expect(columns.name).toMatchObject({ notNull: true, primary: true });
    expect(columns.instance_id).toMatchObject({
      notNull: true,
      columnType: 'PgUUID',
    });
    expect(columns.bound_at.notNull).toBe(true);

    const boundAtDefault = columns.bound_at.default;

    if (!is(boundAtDefault, SQL))
      throw new Error('bound_at default missing or not SQL');
    expect(dialect.sqlToQuery(boundAtDefault).sql).toBe(`now()`);
  });

  it('has one system-only policy and no user-readable one', () => {
    const policies = getTableConfig(machineBindings).policies.map((policy) => ({
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

    // An instance id never reaches a user surface, so there is deliberately no
    // authenticated select: the marked system context is the only reader and
    // writer, on both USING and WITH CHECK.
    expect(policies).toEqual([
      {
        name: 'machine_bindings_system_write',
        for: 'all',
        using: `current_setting('app.machines_system', true) = '1'`,
        withCheck: `current_setting('app.machines_system', true) = '1'`,
      },
    ]);
  });
});
