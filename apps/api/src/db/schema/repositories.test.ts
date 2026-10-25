import {
  getTableConfig,
  PgDialect,
  type PgTable,
  type PgPolicy,
} from 'drizzle-orm/pg-core';

import {
  checkouts,
  repositories,
  repositoryAliases,
  worktreeLeases,
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

describe('repositories schema', () => {
  it('keys one normalized remote per owner and forces RLS', () => {
    expect(getTableConfig(repositories).enableRLS).toBe(true);
    // Remote-less repositories never collide, and the owner column keeps a
    // second owner's remote from being disclosed as a conflict.
    expect(indexes(repositories)).toEqual([
      {
        name: 'repositories_owner_canonical_remote_uidx',
        columns: ['owner_user_id', 'canonical_remote'],
        unique: true,
      },
      {
        name: 'repositories_owner_created_idx',
        columns: ['owner_user_id', 'created_at'],
        unique: false,
      },
    ]);
    // Parent key for the composite owner foreign keys naming a repository.
    expect(uniqueConstraints(repositories)).toEqual([
      { name: 'repositories_owner_id_key', columns: ['owner_user_id', 'id'] },
    ]);
  });

  it('cascades from the owner and exposes only their rows', () => {
    expect(foreignKeys(repositories)).toEqual([
      {
        name: 'repositories_owner_user_id_users_id_fk',
        columns: ['owner_user_id'],
        foreignTable: 'users',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
    ]);
    expect(policies(repositories)).toEqual([
      { name: 'repositories_owner', using: OWNER, withCheck: undefined },
    ]);
  });
});

describe('repository_aliases schema', () => {
  it('selects at most one repository per declared remote and forces RLS', () => {
    expect(getTableConfig(repositoryAliases).enableRLS).toBe(true);
    expect(indexes(repositoryAliases)).toEqual([
      {
        name: 'repository_aliases_owner_alias_uidx',
        columns: ['owner_user_id', 'canonical_alias'],
        unique: true,
      },
      {
        name: 'repository_aliases_owner_repository_idx',
        columns: ['owner_user_id', 'repository_id'],
        unique: false,
      },
    ]);
  });

  it('names its repository through the composite owner key', () => {
    // The composite key is what stops one owner's alias naming another
    // owner's repository, since the foreign-key check bypasses RLS.
    expect(foreignKeys(repositoryAliases)).toEqual([
      {
        name: 'repository_aliases_owner_user_id_users_id_fk',
        columns: ['owner_user_id'],
        foreignTable: 'users',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
      {
        name: 'repository_aliases_repository_owner_fk',
        columns: ['owner_user_id', 'repository_id'],
        foreignTable: 'repositories',
        foreignColumns: ['owner_user_id', 'id'],
        onDelete: 'cascade',
      },
    ]);
    expect(policies(repositoryAliases)).toEqual([
      { name: 'repository_aliases_owner', using: OWNER, withCheck: undefined },
    ]);
  });
});

describe('checkouts schema', () => {
  it('holds a path on an executor once per owner and forces RLS', () => {
    expect(getTableConfig(checkouts).enableRLS).toBe(true);
    // The owner column is part of every key: executors are shared by all
    // owners, so a global key would disclose the first owner's path.
    expect(indexes(checkouts)).toEqual([
      {
        name: 'checkouts_owner_executor_path_uidx',
        columns: ['owner_user_id', 'executor_id', 'path'],
        unique: true,
      },
      {
        name: 'checkouts_owner_repository_idx',
        columns: ['owner_user_id', 'repository_id'],
        unique: false,
      },
      {
        name: 'checkouts_owner_parent_idx',
        columns: ['owner_user_id', 'parent_checkout_id'],
        unique: false,
      },
    ]);
    expect(uniqueConstraints(checkouts)).toEqual([
      { name: 'checkouts_owner_id_key', columns: ['owner_user_id', 'id'] },
    ]);
  });

  it('closes the kind and origin vocabularies in the database', () => {
    expect(checks(checkouts)).toEqual([
      {
        name: 'checkouts_kind_check',
        sql: '"checkouts"."kind" IN (\'main\', \'worktree\')',
      },
      {
        name: 'checkouts_origin_check',
        sql: "\"checkouts\".\"origin\" IN ('registered', 'adopted', 'created')",
      },
      // A worktree names its parent and a main row does not, both directions.
      {
        name: 'checkouts_worktree_parent_check',
        sql: '("checkouts"."kind" = \'worktree\') = ("checkouts"."parent_checkout_id" IS NOT NULL)',
      },
      // An explicit base directory belongs to a main row only.
      {
        name: 'checkouts_worktree_base_check',
        sql: '"checkouts"."kind" = \'main\' OR "checkouts"."worktree_base" IS NULL',
      },
    ]);
  });

  it('cascades from its owner, its repository, and its parent main row', () => {
    expect(foreignKeys(checkouts)).toEqual([
      {
        name: 'checkouts_owner_user_id_users_id_fk',
        columns: ['owner_user_id'],
        foreignTable: 'users',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
      {
        name: 'checkouts_repository_owner_fk',
        columns: ['owner_user_id', 'repository_id'],
        foreignTable: 'repositories',
        foreignColumns: ['owner_user_id', 'id'],
        onDelete: 'cascade',
      },
      // Self-referencing: a parent delete removes the worktree rows, not the
      // directories on disk.
      {
        name: 'checkouts_parent_owner_fk',
        columns: ['owner_user_id', 'parent_checkout_id'],
        foreignTable: 'checkouts',
        foreignColumns: ['owner_user_id', 'id'],
        onDelete: 'cascade',
      },
    ]);
    expect(policies(checkouts)).toEqual([
      { name: 'checkouts_owner', using: OWNER, withCheck: undefined },
    ]);
  });
});

describe('worktree_leases schema', () => {
  it('indexes both receipts per owner and forces RLS', () => {
    expect(getTableConfig(worktreeLeases).enableRLS).toBe(true);
    // A lease refuses nothing, so it needs no key beyond its primary key.
    expect(indexes(worktreeLeases)).toEqual([
      {
        name: 'worktree_leases_owner_checkout_idx',
        columns: ['owner_user_id', 'checkout_id'],
        unique: false,
      },
      {
        name: 'worktree_leases_owner_chat_idx',
        columns: ['owner_user_id', 'chat_id'],
        unique: false,
      },
    ]);
    expect(uniqueConstraints(worktreeLeases)).toEqual([]);
    expect(checks(worktreeLeases)).toEqual([]);
  });

  it('names its checkout and its chat through owner-matched keys', () => {
    expect(foreignKeys(worktreeLeases)).toEqual([
      {
        name: 'worktree_leases_owner_user_id_users_id_fk',
        columns: ['owner_user_id'],
        foreignTable: 'users',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
      {
        name: 'worktree_leases_checkout_owner_fk',
        columns: ['owner_user_id', 'checkout_id'],
        foreignTable: 'checkouts',
        foreignColumns: ['owner_user_id', 'id'],
        onDelete: 'cascade',
      },
      // Column order mirrors `chats_id_owner_user_id_unique_idx`, the unique
      // key this foreign key references; the owner match is the same.
      {
        name: 'worktree_leases_chat_owner_fk',
        columns: ['chat_id', 'owner_user_id'],
        foreignTable: 'chats',
        foreignColumns: ['id', 'owner_user_id'],
        onDelete: 'cascade',
      },
    ]);
    expect(policies(worktreeLeases)).toEqual([
      { name: 'worktree_leases_owner', using: OWNER, withCheck: undefined },
    ]);
  });
});
