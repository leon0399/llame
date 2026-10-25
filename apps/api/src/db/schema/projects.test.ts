import {
  getTableConfig,
  PgDialect,
  type PgPolicy,
  type PgTable,
} from 'drizzle-orm/pg-core';

import { projects } from './index';

const dialect = new PgDialect();

/** Compiles a policy chunk to the text Postgres receives. */
function sqlText(chunk: NonNullable<PgPolicy['using']>): string {
  return dialect.sqlToQuery(chunk).sql.replaceAll(/\s+/gu, ' ');
}

function indexes(table: PgTable) {
  return getTableConfig(table).indexes.map((entry) => ({
    name: entry.config.name,
    columns: entry.config.columns.map((column) =>
      'name' in column ? column.name : 'expression',
    ),
    unique: entry.config.unique,
  }));
}

function uniqueConstraints(table: PgTable) {
  return getTableConfig(table).uniqueConstraints.map((constraint) => ({
    name: constraint.name,
    columns: constraint.columns.map((column) => column.name),
  }));
}

function policies(table: PgTable) {
  return getTableConfig(table).policies.map((policy) => ({
    name: policy.name,
    using: policy.using === undefined ? undefined : sqlText(policy.using),
  }));
}

const OWNER = "owner_user_id = current_setting('app.current_user_id', true)";

describe('projects schema', () => {
  it('orders the owner list and the archive filter, and forces RLS', () => {
    expect(getTableConfig(projects).enableRLS).toBe(true);
    expect(indexes(projects)).toEqual([
      {
        name: 'projects_owner_created_idx',
        columns: ['owner_user_id', 'created_at'],
        unique: false,
      },
      {
        name: 'projects_owner_archived_created_idx',
        columns: ['owner_user_id', 'archived_at', 'created_at'],
        unique: false,
      },
    ]);
    // Parent key the project links' composite owner foreign key names.
    expect(uniqueConstraints(projects)).toEqual([
      { name: 'projects_owner_id_key', columns: ['owner_user_id', 'id'] },
    ]);
  });

  it('exposes only the owner rows', () => {
    expect(policies(projects)).toEqual([
      { name: 'projects_owner', using: OWNER },
    ]);
  });
});
