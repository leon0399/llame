import { type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Chat, type ChatDelivery, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { chatDeliveryRow } from '../testing/chat-delivery-rows';
import { asDouble } from '../testing/support';
import { ChatDeliveriesRepository } from './chat-deliveries.repository';
import { ChatsRepository } from './chats-repository';

const chatId = '3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10';
const userId = 'user-id';

function runOf(overrides: Partial<Run>): Run {
  return asDouble<Run>({
    id: 'run-1',
    chatId,
    userId,
    status: 'failed',
    cancelRequestedAt: null,
    ...overrides,
  });
}

type DeliverySet = Partial<ChatDelivery>;

/** The written fields, with the clock stamp checked and set aside. */
function withoutStamp(sets: Array<DeliverySet>) {
  return sets.map(({ updatedAt, ...written }) => {
    expect(updatedAt).toBeInstanceOf(Date);

    return written;
  });
}

/** A `db.update` double that records each `set` and the row it targets. */
function makeDb() {
  const db: Db = drizzle.mock();
  const sets: Array<DeliverySet> = [];
  vi.spyOn(db, 'update').mockImplementation(() => {
    const where = () => Promise.resolve([]);

    const set = (values: DeliverySet) => {
      sets.push(values);

      return Object.assign(Promise.resolve([]), {
        where,
        returning: where,
      });
    };

    // SAFETY: the double implements only the fluent members these methods use.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return { set } as never;
  });

  return { db, sets };
}

function spyPauseReads(options: {
  moving: Array<ReturnType<typeof chatDeliveryRow>>;
  head?: ReturnType<typeof chatDeliveryRow>;
}) {
  const lock = vi
    .spyOn(ChatsRepository.prototype, 'lock')
    .mockResolvedValue(asDouble<Chat>({ id: chatId }));

  const lockPendingSteering = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'lockPendingSteering')
    .mockResolvedValue(options.moving);

  const firstPendingQueueItem = vi
    .spyOn(ChatDeliveriesRepository.prototype, 'firstPendingQueueItem')
    .mockResolvedValue(options.head);

  return { lock, lockPendingSteering, firstPendingQueueItem };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatDeliveriesRepository.pauseBehind', () => {
  it('leaves the steering items to a Run that completed without a recorded cancellation', async () => {
    const { db, sets } = makeDb();

    const reads = spyPauseReads({
      moving: [chatDeliveryRow({ mode: 'steer' })],
    });

    await new ChatDeliveriesRepository(db).pauseBehind(
      runOf({ status: 'completed' }),
    );

    expect(reads.lock).not.toHaveBeenCalled();
    expect(reads.lockPendingSteering).not.toHaveBeenCalled();
    expect(sets).toEqual([]);
  });

  it.each([
    ['completed with a recorded cancellation', 'completed', new Date()],
    ['failed', 'failed', null],
  ] as const)(
    'moves the steering items behind a Run that %s',
    async (_name, status, cancelRequestedAt) => {
      const { db, sets } = makeDb();

      const reads = spyPauseReads({
        moving: [chatDeliveryRow({ mode: 'steer' })],
      });

      await new ChatDeliveriesRepository(db).pauseBehind(
        runOf({ status, cancelRequestedAt }),
      );

      expect(reads.lock).toHaveBeenCalledWith(chatId, userId);
      expect(reads.lockPendingSteering).toHaveBeenCalledWith(chatId, userId);
      expect(sets).toHaveLength(1);
    },
  );

  it('writes nothing, and reads no queue head, when no steering item is pending', async () => {
    const { db, sets } = makeDb();
    const reads = spyPauseReads({ moving: [] });

    await new ChatDeliveriesRepository(db).pauseBehind(runOf({}));

    expect(reads.firstPendingQueueItem).not.toHaveBeenCalled();
    expect(sets).toEqual([]);
  });

  it('places the items, in order, directly before the first queue item', async () => {
    const { db, sets } = makeDb();
    spyPauseReads({
      moving: [
        chatDeliveryRow({ id: 'a', mode: 'steer', position: 9 }),
        chatDeliveryRow({ id: 'b', mode: 'interrupt', position: 10 }),
      ],
      head: chatDeliveryRow({ position: 5 }),
    });

    await new ChatDeliveriesRepository(db).pauseBehind(runOf({}));

    expect(withoutStamp(sets)).toEqual([
      { mode: 'queue', position: 3 },
      { mode: 'queue', position: 4 },
    ]);
  });

  it('keeps the positions where they are when no queue item exists', async () => {
    const { db, sets } = makeDb();
    spyPauseReads({
      moving: [chatDeliveryRow({ mode: 'steer', position: 9 })],
    });

    await new ChatDeliveriesRepository(db).pauseBehind(runOf({}));

    expect(withoutStamp(sets)).toEqual([{ mode: 'queue' }]);
  });
});

describe('ChatDeliveriesRepository.changePendingMode', () => {
  it('writes the requested mode and returns the changed row', async () => {
    const db: Db = drizzle.mock();
    const changed = chatDeliveryRow({ mode: 'steer' });
    const sets: Array<DeliverySet> = [];
    vi.spyOn(db, 'update').mockImplementation(() => {
      const returning = () => Promise.resolve([changed]);

      const set = (values: DeliverySet) => {
        sets.push(values);

        return { where: () => ({ returning }) };
      };

      // SAFETY: the double implements only the fluent members this method uses.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion
      return { set } as never;
    });

    await expect(
      new ChatDeliveriesRepository(db).changePendingMode(
        chatId,
        changed.id,
        userId,
        'steer',
      ),
    ).resolves.toBe(changed);

    expect(withoutStamp(sets)).toEqual([{ mode: 'steer' }]);
  });
});

describe('ChatDeliveriesRepository.hasPendingInterrupt', () => {
  /** A repository whose select answers `rows` and records the SQL it built. */
  function repositoryAnswering(rows: Array<{ id: string }>) {
    const real: Db = drizzle.mock();
    const queries: Array<{ sql: string; params: Array<unknown> }> = [];

    // Builds the real query, but stops it at the end of the chain.
    const select = (fields: { id: typeof schema.chatDeliveries.id }) => ({
      from: (table: typeof schema.chatDeliveries) => {
        const base = real.select(fields).from(table).$dynamic();

        return {
          where: (condition: SQL | undefined) => {
            const filtered = base.where(condition);

            return {
              limit: (count: number) => {
                queries.push(filtered.limit(count).toSQL());

                return Promise.resolve(rows);
              },
            };
          },
        };
      },
    });

    return {
      repository: new ChatDeliveriesRepository(asDouble<Db>({ select })),
      queries,
    };
  }

  it('is true when the Chat holds a pending interrupt item', async () => {
    const { repository, queries } = repositoryAnswering([{ id: 'item-1' }]);

    await expect(repository.hasPendingInterrupt(chatId, userId)).resolves.toBe(
      true,
    );

    const [query] = queries;
    expect(query?.sql).toMatch(/^select "id" from "chat_deliveries" where /);
    expect(query?.params).toEqual(
      expect.arrayContaining([chatId, userId, 'pending', 'interrupt']),
    );
  });

  it('is false when the Chat holds none', async () => {
    const { repository } = repositoryAnswering([]);

    await expect(repository.hasPendingInterrupt(chatId, userId)).resolves.toBe(
      false,
    );
  });
});
