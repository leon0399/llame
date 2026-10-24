import {
  getTableConfig,
  PgDialect,
  type PgPolicy,
  type PgTable,
} from 'drizzle-orm/pg-core';

import {
  projectRepositories,
  projects,
  projectRepositoryDefaults,
} from './index';

const dialect = new PgDialect();

/** Compiles a policy or CHECK chunk to the text Postgres receives. */
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

describe('project_repositories schema', () => {
  it('keys one link per project repository and at most one primary', () => {
    expect(getTableConfig(projectRepositories).enableRLS).toBe(true);
    expect(indexes(projectRepositories)).toEqual([
      {
        name: 'project_repositories_owner_project_repository_uidx',
        columns: ['owner_user_id', 'project_id', 'repository_id'],
        unique: true,
        where: undefined,
      },
      // Partial: the non-primary rows of a project stay unconstrained.
      {
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
    // Parent key for the defaults table's composite owner foreign key.
    expect(uniqueConstraints(projectRepositories)).toEqual([
      {
        name: 'project_repositories_owner_id_key',
        columns: ['owner_user_id', 'id'],
      },
    ]);
  });

  it('restricts the isolation policy to the three runtime values', () => {
    expect(checks(projectRepositories)).toEqual([
      {
        name: 'project_repositories_isolation_check',
        sql: `"project_repositories"."isolation" IN ('inherit', 'always_worktree', 'never')`,
      },
    ]);
  });

  it('cascades from every composite owner edge', () => {
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
    const scoped = `${OWNER} AND project_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting('app.current_user_id', true))`;

    expect(policies(projectRepositories)).toEqual([
      { name: 'project_repositories_owner', using: scoped, withCheck: scoped },
    ]);
  });
});

describe('project_repository_defaults schema', () => {
  it('keys one default per link and executor and forces RLS', () => {
    expect(getTableConfig(projectRepositoryDefaults).enableRLS).toBe(true);
    expect(indexes(projectRepositoryDefaults)).toEqual([
      {
        name: 'project_repository_defaults_owner_link_executor_uidx',
        columns: ['owner_user_id', 'project_repository_id', 'executor_id'],
        unique: true,
        where: undefined,
      },
      {
        name: 'project_repository_defaults_owner_link_idx',
        columns: ['owner_user_id', 'project_repository_id'],
        unique: false,
        where: undefined,
      },
      {
        name: 'project_repository_defaults_owner_checkout_idx',
        columns: ['owner_user_id', 'checkout_id'],
        unique: false,
        where: undefined,
      },
    ]);
    expect(uniqueConstraints(projectRepositoryDefaults)).toEqual([]);
    expect(checks(projectRepositoryDefaults)).toEqual([]);
  });

  it('cascades from the link and the checkout', () => {
    expect(foreignKeys(projectRepositoryDefaults)).toEqual([
      {
        name: 'project_repository_defaults_owner_user_id_users_id_fk',
        columns: ['owner_user_id'],
        foreignTable: 'users',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
      {
        name: 'project_repository_defaults_link_owner_fk',
        columns: ['owner_user_id', 'project_repository_id'],
        foreignTable: 'project_repositories',
        foreignColumns: ['owner_user_id', 'id'],
        onDelete: 'cascade',
      },
      {
        name: 'project_repository_defaults_checkout_owner_fk',
        columns: ['owner_user_id', 'checkout_id'],
        foreignTable: 'checkouts',
        foreignColumns: ['owner_user_id', 'id'],
        onDelete: 'cascade',
      },
    ]);
  });

  it('exposes a default only through a link the caller owns', () => {
    const scoped = `${OWNER} AND project_repository_id IN (SELECT id FROM project_repositories WHERE owner_user_id = current_setting('app.current_user_id', true))`;

    expect(policies(projectRepositoryDefaults)).toEqual([
      {
        name: 'project_repository_defaults_owner',
        using: scoped,
        withCheck: scoped,
      },
    ]);
  });
});

describe('projects parent key', () => {
  it('declares the composite owner key the link foreign key references', () => {
    // The project links add this key in the same change: their composite owner
    // foreign key references it, so a single-column key would let one owner's
    // link name another owner's project.
    expect(uniqueConstraints(projects)).toEqual([
      { name: 'projects_owner_id_key', columns: ['owner_user_id', 'id'] },
    ]);
  });
});
