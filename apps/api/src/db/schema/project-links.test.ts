import {
  getTableConfig,
  PgDialect,
  type PgTable,
  type PgPolicy,
} from 'drizzle-orm/pg-core';

import { projectRepositories } from './index';

const dialect = new PgDialect();

/** Compiles a policy, CHECK, or predicate chunk to the text Postgres receives. */
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
    where:
      entry.config.where === undefined
        ? undefined
        : sqlText(entry.config.where),
  }));
}

function uniqueConstraints(table: PgTable) {
  return getTableConfig(table).uniqueConstraints.map((constraint) => ({
    name: constraint.name,
    columns: constraint.columns.map((column) => column.name),
  }));
}

function checks(table: PgTable) {
  return getTableConfig(table).checks.map((constraint) => ({
    name: constraint.name,
    sql: sqlText(constraint.value),
  }));
}

function foreignKeys(table: PgTable) {
  return getTableConfig(table).foreignKeys.map((key) => {
    const reference = key.reference();

    return {
      name: key.getName(),
      columns: reference.columns.map((column) => column.name),
      foreignTable: getTableConfig(reference.foreignTable).name,
      foreignColumns: reference.foreignColumns.map((column) => column.name),
      onDelete: key.onDelete,
    };
  });
}

function policies(table: PgTable) {
  return getTableConfig(table).policies.map((policy) => ({
    name: policy.name,
    using: policy.using === undefined ? undefined : sqlText(policy.using),
    withCheck:
      policy.withCheck === undefined ? undefined : sqlText(policy.withCheck),
  }));
}

const OWNER = "owner_user_id = current_setting('app.current_user_id', true)";
const OWNER_PROJECT = `${OWNER} AND project_id IN (SELECT id FROM projects WHERE ${OWNER})`;

describe('project_repositories schema', () => {
  it('keys one link per project and repository, one primary per project', () => {
    expect(getTableConfig(projectRepositories).enableRLS).toBe(true);
    expect(indexes(projectRepositories)).toEqual([
      {
        name: 'project_repositories_owner_project_repository_uidx',
        columns: ['owner_user_id', 'project_id', 'repository_id'],
        unique: true,
        where: undefined,
      },
      {
        // Partial: only the primary rows are constrained, so the writer can
        // clear the previous primary and set the new one in one transaction.
        name: 'project_repositories_owner_project_primary_uidx',
        columns: ['owner_user_id', 'project_id'],
        unique: true,
        where: '"project_repositories"."is_primary"',
      },
      {
        name: 'project_repositories_owner_project_idx',
        columns: ['owner_user_id', 'project_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'project_repositories_owner_repository_idx',
        columns: ['owner_user_id', 'repository_id'],
        unique: false,
        where: undefined,
      },
    ]);
    // Parent key for the composite owner foreign key naming a link.
    expect(uniqueConstraints(projectRepositories)).toEqual([
      {
        name: 'project_repositories_owner_id_key',
        columns: ['owner_user_id', 'id'],
      },
    ]);
  });

  it('restricts the isolation column to the three runtime values', () => {
    expect(checks(projectRepositories)).toEqual([
      {
        name: 'project_repositories_isolation_check',
        sql: `"project_repositories"."isolation" IN ('inherit', 'always_worktree', 'never')`,
      },
    ]);
  });

  it('cascades from the owner and names its parents by the composite owner key', () => {
    // Both parent edges are composite `(owner_user_id, parent_id)`: a
    // single-column key would let one owner's link name another owner's
    // project or repository, since a foreign-key check bypasses RLS.
    expect(foreignKeys(projectRepositories)).toEqual([
      {
        name: 'project_repositories_owner_user_id_users_id_fk',
        columns: ['owner_user_id'],
        foreignTable: 'users',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
      {
        name: 'project_repositories_project_owner_fk',
        columns: ['owner_user_id', 'project_id'],
        foreignTable: 'projects',
        foreignColumns: ['owner_user_id', 'id'],
        onDelete: 'cascade',
      },
      {
        name: 'project_repositories_repository_owner_fk',
        columns: ['owner_user_id', 'repository_id'],
        foreignTable: 'repositories',
        foreignColumns: ['owner_user_id', 'id'],
        onDelete: 'cascade',
      },
    ]);
  });

  it('exposes a link only through a project the caller owns', () => {
    expect(policies(projectRepositories)).toEqual([
      {
        name: 'project_repositories_owner',
        using: OWNER_PROJECT,
        withCheck: OWNER_PROJECT,
      },
    ]);
  });
});
