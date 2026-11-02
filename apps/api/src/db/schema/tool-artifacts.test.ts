import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { chats } from './chats';
import { toolArtifactParts, toolArtifacts } from './tool-artifacts';

const dialect = new PgDialect();

function policies(table: typeof toolArtifacts | typeof toolArtifactParts) {
  return getTableConfig(table).policies.map((policy) => ({
    name: policy.name,
    for: policy.for,
    using:
      policy.using === undefined
        ? undefined
        : dialect.sqlToQuery(policy.using).sql.replaceAll(/\s+/gu, ' '),
    withCheck:
      policy.withCheck === undefined
        ? undefined
        : dialect.sqlToQuery(policy.withCheck).sql.replaceAll(/\s+/gu, ' '),
  }));
}

const OWNER = "owner_user_id = current_setting('app.current_user_id', true)";
const OWNED_ARTIFACT = `chat_id IN ( SELECT id FROM chats WHERE ${OWNER} )`;
const OWNED_PART = `artifact_id IN ( SELECT tool_artifacts.id FROM tool_artifacts INNER JOIN chats ON chats.id = tool_artifacts.chat_id WHERE chats.${OWNER} )`;

describe('tool artifact schema', () => {
  it('keys an artifact by its Chat and number, and by its tool call', () => {
    const config = getTableConfig(toolArtifacts);

    expect(config.enableRLS).toBe(true);
    expect(
      config.uniqueConstraints.map((constraint) => [
        constraint.name,
        constraint.columns.map((column) => column.name),
      ]),
    ).toEqual([
      ['tool_artifacts_chat_seq_unique', ['chat_id', 'seq']],
      [
        'tool_artifacts_chat_run_call_unique',
        ['chat_id', 'run_id', 'tool_call_id'],
      ],
    ]);
  });

  it('cascades an artifact with its Chat', () => {
    const foreignKeys = getTableConfig(toolArtifacts).foreignKeys;

    expect(
      foreignKeys.map((key) => [
        key.getName(),
        key.onDelete,
        key.reference().foreignColumns.map((column) => column.name),
      ]),
    ).toEqual([['tool_artifacts_chat_id_chats_id_fk', 'cascade', ['id']]]);
  });

  it('lets an owner only read and insert artifacts of their Chats', () => {
    expect(policies(toolArtifacts)).toEqual([
      {
        name: 'tool_artifacts_owner_select',
        for: 'select',
        using: OWNED_ARTIFACT,
        withCheck: undefined,
      },
      {
        name: 'tool_artifacts_owner_insert',
        for: 'insert',
        using: undefined,
        withCheck: OWNED_ARTIFACT,
      },
    ]);
  });

  it('cascades a part with its artifact and hides it behind the Chat owner', () => {
    const config = getTableConfig(toolArtifactParts);

    expect(config.enableRLS).toBe(true);
    expect(
      config.foreignKeys.map((key) => [key.getName(), key.onDelete]),
    ).toEqual([
      ['tool_artifact_parts_artifact_id_tool_artifacts_id_fk', 'cascade'],
    ]);
    expect(policies(toolArtifactParts)).toEqual([
      {
        name: 'tool_artifact_parts_owner_select',
        for: 'select',
        using: OWNED_PART,
        withCheck: undefined,
      },
      {
        name: 'tool_artifact_parts_owner_insert',
        for: 'insert',
        using: undefined,
        withCheck: OWNED_PART,
      },
    ]);
  });

  it('starts each Chat counter at zero', () => {
    const column = getTableConfig(chats).columns.find(
      (candidate) => candidate.name === 'artifact_seq',
    );

    expect(column?.notNull).toBe(true);
    expect(column?.default).toBe(0);
  });
});
