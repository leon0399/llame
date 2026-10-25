import { SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core';

import { chatCreationRecords } from './index';

const dialect = new PgDialect();

/** Compiles a policy, CHECK, or column-default chunk to the text Postgres receives. */
function sqlText(chunk: SQL): string {
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

/** One named column of the table under test. */
const column = (name: string) => {
  const found = getTableConfig(chatCreationRecords).columns.find(
    (entry) => entry.name === name,
  );
  if (found === undefined) throw new Error(`No column ${name}`);
  return found;
};

const OWNER = "owner_user_id = current_setting('app.current_user_id', true)";

describe('chat_creation_records schema', () => {
  it('is owner-scoped by row level security', () => {
    expect(getTableConfig(chatCreationRecords).enableRLS).toBe(true);
  });

  it('requires the owner and the chat on every row, and one row per chat', () => {
    expect(column('owner_user_id').notNull).toBe(true);
    expect(column('chat_id').notNull).toBe(true);
    expect(column('attempts').notNull).toBe(true);
    expect(column('created_at').notNull).toBe(true);
    expect(indexes(chatCreationRecords)).toEqual([
      {
        name: 'chat_creation_records_owner_chat_uidx',
        columns: ['owner_user_id', 'chat_id'],
        unique: true,
      },
    ]);
  });

  it('defaults the attempt list to an empty array', () => {
    const attempts = column('attempts').default;

    if (!(attempts instanceof SQL)) throw new Error('No SQL default');
    expect(sqlText(attempts)).toBe("'[]'::jsonb");
  });

  it('requires the attempt list to be an array', () => {
    expect(checks(chatCreationRecords)).toEqual([
      {
        name: 'chat_creation_records_attempts_check',
        sql: 'jsonb_typeof("chat_creation_records"."attempts") = \'array\'',
      },
    ]);
  });

  it('cascades from the owner and from the chat by the composite owner key', () => {
    expect(foreignKeys(chatCreationRecords)).toEqual([
      {
        name: 'chat_creation_records_owner_user_id_users_id_fk',
        columns: ['owner_user_id'],
        foreignTable: 'users',
        foreignColumns: ['id'],
        onDelete: 'cascade',
      },
      {
        name: 'chat_creation_records_chat_owner_fk',
        columns: ['chat_id', 'owner_user_id'],
        foreignTable: 'chats',
        foreignColumns: ['id', 'owner_user_id'],
        onDelete: 'cascade',
      },
    ]);
  });

  it('exposes a record only to its owner', () => {
    expect(policies(chatCreationRecords)).toEqual([
      {
        name: 'chat_creation_records_owner',
        using: OWNER,
        withCheck: undefined,
      },
    ]);
  });
});
