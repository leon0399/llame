import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Sql } from 'postgres';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';

/*
 * The per-Chat creation lock (openspec `chat-start-location`, design D9 step 2,
 * and "Creation serializes requests for one chat id").
 *
 * A create request holds the chat id's SESSION advisory lock on one dedicated
 * connection for the whole request, because its steps keep their separate
 * transactions. That connection comes from its own small pool
 * (`DB_CREATION_LOCK`), never from the tenant pool those transactions use: a
 * reserved connection is out of the pool until the create ends, so a
 * `db.poolSize: 1` tenant pool would wait for a connection that it is itself
 * holding.
 *
 * The message route takes the same key as a TRANSACTION lock inside its
 * admission transaction, so a message that overlaps a create is refused
 * instead of blocking behind it, and a create that overlaps a message answers
 * the same refusal.
 *
 * The key names its family: org-unit triggers hash the bare id with seed 0, and
 * a Chat id must never collide with one of those keys by accident.
 */

/** The lock family, prefixed to the id in the one derived key. */
const CREATION_LOCK_FAMILY = 'chat-creation';

/** The body code both routes answer while the other holds the lock. */
export const CREATION_IN_PROGRESS = 'creation_in_progress';

/**
 * The one key derivation both routes use. The id is lowercased, because
 * `@IsUUID` and `ParseUUIDPipe` accept either case and Postgres stores the
 * lowercase form: `A` and `a` name one Chat, so they must name one lock.
 */
export function chatCreationLockKey(chatId: string): string {
  return `${CREATION_LOCK_FAMILY}:${chatId.toLowerCase()}`;
}

/** The 409 a create or a message answers when a create holds the Chat. */
export function creationInProgress(): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message:
      'A chat-creation request holds this Chat; retry after it finishes.',
    code: CREATION_IN_PROGRESS,
  });
}

/**
 * The message route's transaction lock: same key, shared, released with the
 * transaction.
 *
 * SHARED, because two sends to one Chat already serialize on the Chat row and
 * must keep doing so: an exclusive transaction lock here would make the second
 * send answer `409` instead of superseding the first. A create request takes
 * the same key EXCLUSIVELY for its whole session, so it conflicts with this
 * lock in both directions — a send during a create is refused, and a create
 * that starts during a send cannot take the key until that send's transaction
 * ends.
 */
export async function tryCreationTransactionLock(
  tx: Db,
  chatId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock_shared(hashtextextended(${chatCreationLockKey(chatId)}, 0)) as locked`,
  );
  return [...rows][0]?.locked === true;
}

type DbWithClient = PostgresJsDatabase<typeof schema> & {
  readonly $client: Sql;
};

@Injectable()
export class ChatCreationLock {
  constructor(
    // Its own connection, not `DB_DEV`: the reserved connection below lives for
    // the whole request, so sharing the tenant pool would deadlock a small one
    // (`db.poolSize: 1`) against the transactions the create then needs.
    @Inject('DB_CREATION_LOCK')
    private readonly db: DbWithClient,
  ) {}

  /**
   * Run one whole create while holding the Chat's session lock on one reserved
   * connection. A concurrent create with the same id answers 409 and changes
   * nothing; the lock is released, and the connection returned, even when the
   * request throws.
   */
  async runExclusively<T>(chatId: string, run: () => Promise<T>): Promise<T> {
    const key = chatCreationLockKey(chatId);
    const reserved = await this.db.$client.reserve();
    try {
      const [row] = await reserved<Array<{ locked: boolean }>>`
        select pg_try_advisory_lock(hashtextextended(${key}, 0)) as locked
      `;
      if (row?.locked !== true) throw creationInProgress();
      try {
        return await run();
      } finally {
        await reserved`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
      }
    } finally {
      reserved.release();
    }
  }
}
