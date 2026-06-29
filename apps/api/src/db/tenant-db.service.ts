/**
 * TenantDbService — per-request RLS-scoped transaction helper.
 *
 * Wraps every unit of work in a single transaction that sets
 * `app.current_user_id` transaction-locally (via set_config with is_local=true),
 * engaging PostgreSQL Row-Level Security for the duration.
 *
 * Usage:
 *   const result = await this.tenantDb.runAs(userId, (tx) =>
 *     new ChatsRepository(tx).findByOwner(userId),
 *   );
 *
 * NOTE: repos must be constructed inside the callback with the scoped `tx`,
 * NOT stored on the service — the set_config is only live inside that transaction.
 *
 * TODO: wire userId from a request-scoped auth guard/interceptor once authentication
 * is added to apps/api. For now, callers supply it explicitly from handler inputs.
 */

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;

@Injectable()
export class TenantDbService {
  constructor(@Inject('DB_DEV') private readonly db: Db) {}

  /**
   * Run `fn` inside a transaction scoped to `userId`.
   *
   * set_config(..., true) is the parameterizable equivalent of `SET LOCAL` —
   * plain `SET LOCAL x = $1` cannot accept a bind parameter in PostgreSQL.
   * Passing `true` as the third argument makes the setting local to the current
   * transaction, so it is automatically reverted on commit/rollback.
   */
  runAs<T>(userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.current_user_id', ${userId}, true)`,
      );
      return fn(tx as unknown as Db);
    });
  }
}
