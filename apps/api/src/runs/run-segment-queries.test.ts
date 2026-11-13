import { drizzle } from 'drizzle-orm/postgres-js';

import { type RunEvent } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  currentSegmentState,
  eventsSinceLatestDelivery,
  findEarlierSegmentBaseline,
  latestDeliverySequence,
} from './run-segment-queries';
import { RunEventsRepository } from './runs-repository';

const runId = '11111111-1111-4111-8111-111111111111';
const userId = 'user-1';
const now = new Date('2026-11-08T00:00:00.000Z');

function event(sequence: number, eventType: RunEvent['eventType']): RunEvent {
  return { sequence, runId, eventType, payload: null, createdAt: now };
}

describe('run segment queries', () => {
  const tx: Db = drizzle.mock();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function serve(delivered: RunEvent | undefined, events: Array<RunEvent>) {
    return {
      findFirst: vi
        .spyOn(RunEventsRepository.prototype, 'findFirstByType')
        .mockResolvedValue(delivered),
      list: vi
        .spyOn(RunEventsRepository.prototype, 'listByRunId')
        .mockResolvedValue(events),
    };
  }

  it('reads the events after the newest delivery', async () => {
    const delivered = event(7, 'run.delivered');
    const started = event(9, 'run.started');
    const spies = serve(delivered, [started]);

    await expect(
      eventsSinceLatestDelivery(tx, runId, userId, {
        eventTypes: ['run.started'],
      }),
    ).resolves.toEqual({ delivered, events: [started] });

    expect(spies.findFirst).toHaveBeenCalledWith(
      runId,
      userId,
      'run.delivered',
      { newest: true },
    );
    expect(spies.list).toHaveBeenCalledWith(runId, userId, {
      eventTypes: ['run.started'],
      afterSequence: 7,
    });
  });

  it('reads every event of the types when the Run delivered nothing', async () => {
    const spies = serve(undefined, []);

    await expect(
      eventsSinceLatestDelivery(tx, runId, userId, {
        eventTypes: ['run.started'],
        limit: 1,
      }),
    ).resolves.toEqual({ delivered: undefined, events: [] });

    expect(spies.list).toHaveBeenCalledWith(runId, userId, {
      eventTypes: ['run.started'],
      limit: 1,
    });
  });

  it('names a delivered segment that has not dispatched yet', async () => {
    const spies = serve(event(7, 'run.delivered'), []);

    await expect(currentSegmentState(tx, runId, userId)).resolves.toEqual({
      delivered: true,
      dispatched: false,
    });

    expect(spies.list).toHaveBeenCalledWith(runId, userId, {
      eventTypes: ['model.requested'],
      limit: 1,
      afterSequence: 7,
    });
  });

  it('names a first segment that already dispatched', async () => {
    serve(undefined, [event(3, 'model.requested')]);

    await expect(currentSegmentState(tx, runId, userId)).resolves.toEqual({
      delivered: false,
      dispatched: true,
    });
  });

  it('reads the earlier segment through the reply usage that names the Run', async () => {
    const queries: Array<string> = [];

    const logged: Db = drizzle.mock({
      logger: { logQuery: (sql) => queries.push(sql) },
    });

    await findEarlierSegmentBaseline(logged, {
      chatId: 'chat-1',
      userId,
      runId,
      beforeSeq: 5,
    }).catch(() => undefined);

    expect(queries[0]).toContain(`"messages" "trigger"`);
    expect(queries[0]).toContain(`->> 'runId'`);
  });
});

describe('latestDeliverySequence', () => {
  it('reads the newest run.delivered event of the Run', async () => {
    const queries: Array<string> = [];

    const db: Db = drizzle.mock({
      logger: { logQuery: (sql) => queries.push(sql) },
    });

    await latestDeliverySequence(db, 'run-1', 'owner-1').catch(() => undefined);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('order by "run_events"."sequence" desc');
  });
});
