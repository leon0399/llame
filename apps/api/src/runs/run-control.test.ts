import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { type Db } from '../db/tenant-db.service';
import {
  notifyRunControl,
  parseRunControl,
  RUN_CONTROL_CHANNEL,
} from './run-control';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

describe('notifyRunControl', () => {
  it('sends the message as a pg_notify on the run-control channel', async () => {
    const execute = vi.fn((_statement: SQL) => Promise.resolve([]));
    // SAFETY: notifyRunControl only calls `execute`.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    const tx: Db = { execute } as never;

    await notifyRunControl(tx, { runId: RUN_ID, kind: 'cancel' });

    expect(execute).toHaveBeenCalledTimes(1);
    const statement = execute.mock.calls[0][0];
    const { sql, params } = new PgDialect().sqlToQuery(statement);
    expect(sql).toBe('select pg_notify($1, $2)');
    expect(params).toEqual([
      RUN_CONTROL_CHANNEL,
      JSON.stringify({ runId: RUN_ID, kind: 'cancel' }),
    ]);
  });
});

describe('parseRunControl', () => {
  it.each(['cancel', 'interrupt'] as const)('parses a %s message', (kind) => {
    expect(parseRunControl(JSON.stringify({ runId: RUN_ID, kind }))).toEqual({
      runId: RUN_ID,
      kind,
    });
  });

  it('parses a job-stop pointer without trusting a supplied owner', () => {
    expect(
      parseRunControl(
        JSON.stringify({
          kind: 'job-stop',
          jobId: RUN_ID,
          ownerUserId: 'untrusted',
        }),
      ),
    ).toEqual({ kind: 'job-stop', jobId: RUN_ID });
    expect(parseRunControl('{"kind":"job-stop","jobId":1}')).toBeUndefined();
  });

  it('answers undefined for text that is not JSON', () => {
    expect(parseRunControl('{not json')).toBeUndefined();
  });

  it('answers undefined for a payload that is not an object', () => {
    expect(parseRunControl('"cancel"')).toBeUndefined();
  });

  it('answers undefined when the run id is not a string', () => {
    expect(
      parseRunControl(JSON.stringify({ runId: 1, kind: 'cancel' })),
    ).toBeUndefined();
  });

  it('answers undefined for an unknown kind', () => {
    expect(
      parseRunControl(JSON.stringify({ runId: RUN_ID, kind: 'pause' })),
    ).toBeUndefined();
  });
});
