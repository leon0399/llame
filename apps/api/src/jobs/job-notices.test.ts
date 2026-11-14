import { isSQLWrapper, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { PgDialect } from 'drizzle-orm/pg-core';

import { type ChatJob, type Run } from '../db/schema';
import * as schema from '../db/schema';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { RunsRepository } from '../runs/runs-repository';
import { asDouble } from '../testing/support';
import { recordJobSettlementNotice } from './job-notices';

const CHAT_ID = '33333333-3333-4333-8333-333333333333';
const OWNER_ID = 'owner-1';

function job(): ChatJob {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    chatId: CHAT_ID,
    ownerUserId: OWNER_ID,
    executor: 'bash',
    seq: 4,
    state: 'succeeded',
    stoppedBy: null,
    runId: '11111111-1111-4111-8111-111111111111',
    toolCallId: 'call-4',
    workerInstanceId: '44444444-4444-4444-8444-444444444444',
    pid: null,
    startedAt: new Date('2026-11-12T12:00:00.000Z'),
    settledAt: new Date('2026-11-12T12:00:03.000Z'),
    deadlineAt: null,
    stopRequestedAt: null,
    stopRequestedBy: null,
    result: { exitCode: 0 },
    outputs: ['stdout'],
    artifactId: null,
    artifactReadable: true,
    settings: { modelId: 'gpt-5.5', permissionMode: 'default' },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('recordJobSettlementNotice', () => {
  function setup(run: Run | undefined) {
    const tx = drizzle.mock({ schema });

    const execute = vi.spyOn(tx, 'execute').mockResolvedValue(
      Object.assign([], {
        columns: [],
        count: 0,
        command: 'SELECT',
        statement: { name: '', string: '', types: [], columns: [] },
        state: { status: 'I', pid: 0, secret: 0 },
      }),
    );

    const insertNotice = vi
      .spyOn(ChatDeliveriesRepository.prototype, 'insertJobNotice')
      .mockResolvedValue(undefined);

    vi.spyOn(RunsRepository.prototype, 'findActiveByChatId').mockResolvedValue(
      run,
    );

    return { tx, execute, insertNotice };
  }

  it('records the notice but does not steer a Run suspended for jobs', async () => {
    const awaitingRun = asDouble<Run>({
      id: '55555555-5555-4555-8555-555555555555',
      status: 'awaiting_jobs',
    });

    const { tx, execute, insertNotice } = setup(awaitingRun);

    await recordJobSettlementNotice(tx, job());

    expect(insertNotice).toHaveBeenCalledWith(job());
    expect(execute).not.toHaveBeenCalled();
  });

  it('notifies a Run that is actively processing the model', async () => {
    const activeRun = asDouble<Run>({
      id: '66666666-6666-4666-8666-666666666666',
      status: 'running_model',
    });

    const { tx, execute, insertNotice } = setup(activeRun);

    await recordJobSettlementNotice(tx, job());

    expect(insertNotice).toHaveBeenCalledWith(job());

    const notifications: Array<SQL> = execute.mock.calls.map(([statement]) => {
      if (!isSQLWrapper(statement)) {
        throw new Error('Expected a SQL notification');
      }

      return statement.getSQL();
    });

    expect(notifications).toHaveLength(1);
    expect(
      notifications.map((statement) => {
        const { sql, params } = new PgDialect().sqlToQuery(statement);
        expect(sql).toBe('select pg_notify($1, $2)');

        return params;
      }),
    ).toEqual([
      [
        'llame_run_control',
        JSON.stringify({
          runId: '66666666-6666-4666-8666-666666666666',
          kind: 'steer',
        }),
      ],
    ]);
  });

  it('records the notice without notifying when there is no active Run', async () => {
    const { tx, execute, insertNotice } = setup(undefined);

    await recordJobSettlementNotice(tx, job());

    expect(insertNotice).toHaveBeenCalledWith(job());
    expect(execute).not.toHaveBeenCalled();
  });
});
