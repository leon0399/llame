import { getTableConfig } from 'drizzle-orm/pg-core';

import { runs } from './index';
import { toRunResponse } from '../../runs/dto/runs.dto';

describe('per-run context-item record', () => {
  it('is a nullable additive column on runs', () => {
    const columns = Object.fromEntries(
      getTableConfig(runs).columns.map((column) => [column.name, column]),
    );

    // Additive and nullable on purpose: a run that predates the column, or one
    // that injected nothing, needs no backfill and no sentinel.
    expect(columns['context_items']).toMatchObject({ notNull: false });
  });

  it('inherits owner-only visibility with no public-read branch', () => {
    const config = getTableConfig(runs);

    // The record carries rendered item prose, so it must never be reachable by
    // a non-owner. `runs` already enforces that, which is precisely why the
    // record lives here rather than on a table of its own or on the streamed
    // `run_events` surface.
    expect(config.enableRLS).toBe(true);
    expect(config.policies.map(({ name }) => name)).toEqual(['runs_owner']);
    expect(config.policies.some(({ name }) => name.includes('public'))).toBe(
      false,
    );
  });

  it('is absent from the run egress allowlist, which has no read surface yet', () => {
    const response = toRunResponse({
      id: 'run-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      userId: 'user-1',
      modelId: 'system:openai:gpt-5.4-mini',
      modelContextSnapshotId: null,
      effort: null,
      status: 'completed',
      workerId: null,
      cancelRequestedAt: null,
      error: null,
      contextItems: [
        {
          producer: 'recency-digest',
          form: 'notice',
          residency: 'rail',
          text: 'PRIVATE_ITEM_PROSE',
        },
      ],
      createdAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    // The record is written but nothing reads it yet — deliberately, so the
    // storage does not have to be retrofitted behind a second coordinated
    // boundary once a surface wants it.
    expect(JSON.stringify(response)).not.toContain('PRIVATE_ITEM_PROSE');
    expect(response).not.toHaveProperty('contextItems');
  });
});
