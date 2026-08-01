import { getTableConfig } from 'drizzle-orm/pg-core';

import { modelContextSnapshots, runs } from './index';

describe('model context snapshot schema', () => {
  it('stores immutable owner-scoped context with deterministic hashes', () => {
    const config = getTableConfig(modelContextSnapshots);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(config.enableRLS).toBe(true);
    expect(columns).toMatchObject({
      id: { notNull: true },
      owner_user_id: { notNull: true },
      content_hash: { notNull: true },
      prompt_hash: { notNull: true },
      tool_hash: { notNull: true },
      source: { notNull: true },
      system_prompt: { notNull: true },
      tool_declarations: { notNull: true },
      created_at: { notNull: true },
    });

    expect(
      config.policies.map(({ name, for: operation }) => [name, operation]),
    ).toEqual([
      ['model_context_snapshots_owner_select', 'select'],
      ['model_context_snapshots_owner_insert', 'insert'],
    ]);
    expect(
      config.indexes.map((index) => ({
        name: index.config.name,
        unique: index.config.unique,
        columns: index.config.columns.map((column) =>
          'name' in column ? column.name : undefined,
        ),
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          name: 'model_context_snapshots_id_owner_user_id_unique_idx',
          unique: true,
          columns: ['id', 'owner_user_id'],
        },
        {
          name: 'model_context_snapshots_owner_content_source_unique_idx',
          unique: true,
          columns: ['owner_user_id', 'content_hash', 'source'],
        },
      ]),
    );
  });

  it('keeps the run reference nullable for history but owner-constrains every binding', () => {
    expect(runs.modelContextSnapshotId.notNull).toBe(false);

    const config = getTableConfig(runs);
    const snapshotForeignKey = config.foreignKeys.find(
      (foreignKey) =>
        foreignKey.getName() === 'runs_model_context_snapshot_id_user_id_fk',
    );
    const reference = snapshotForeignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'model_context_snapshot_id',
      'user_id',
    ]);
    expect(reference?.foreignTable).toBe(modelContextSnapshots);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
      'owner_user_id',
    ]);
  });
});
