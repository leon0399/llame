import { getTableConfig } from 'drizzle-orm/pg-core';

import { isRecord } from '@workspace/runtime-safety';

import { runs, systemPromptReceipts } from './index';

describe('system prompt receipt schema', () => {
  it('stores only owner-scoped system prompt fields', () => {
    const config = getTableConfig(systemPromptReceipts);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column]),
    );

    expect(config.enableRLS).toBe(true);
    expect(columns).toMatchObject({
      id: { notNull: true },
      owner_user_id: { notNull: true },
      run_id: { notNull: true },
      attempt_id: { notNull: true },
      source: { notNull: true },
      system_prompt: { notNull: true },
      prompt_hash: { notNull: true },
      created_at: { notNull: true },
    });
    expect(Object.keys(columns).sort()).toEqual([
      'attempt_id',
      'created_at',
      'id',
      'owner_user_id',
      'prompt_hash',
      'run_id',
      'source',
      'system_prompt',
    ]);
    expect(
      config.policies.map(({ name, for: operation }) => [name, operation]),
    ).toEqual([
      ['system_prompt_receipts_owner_select', 'select'],
      ['system_prompt_receipts_owner_insert', 'insert'],
    ]);
    const hasOwnerRunAttemptIndex = config.indexes.some((index) => {
      const indexConfig: unknown = index.config;
      return (
        isRecord(indexConfig) &&
        indexConfig.name === 'system_prompt_receipts_owner_run_attempt_uidx' &&
        indexConfig.unique === true
      );
    });
    expect(hasOwnerRunAttemptIndex).toBe(true);
  });

  it('owner-constrains each receipt to its run', () => {
    const config = getTableConfig(systemPromptReceipts);
    const receiptForeignKey = config.foreignKeys.find(
      (foreignKey) =>
        foreignKey.getName() === 'system_prompt_receipts_run_id_user_id_fk',
    );
    const reference = receiptForeignKey?.reference();

    expect(reference?.columns.map((column) => column.name)).toEqual([
      'run_id',
      'owner_user_id',
    ]);
    expect(reference?.foreignTable).toBe(runs);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      'id',
      'user_id',
    ]);
    expect(receiptForeignKey?.onDelete).toBe('cascade');
  });
});
