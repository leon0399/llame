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
  async runAs<T>(userId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
    // A missing identity here is a programming error, not an auth failure: the guard
    // already authenticated the request, so an empty userId reaching runAs means a
    // caller passed client input instead of the verified id. Throw a plain Error (→ 500)
    // and keep this DB-layer service decoupled from HTTP exceptions. RLS denies anyway
    // (current_setting NULL → no rows), so this is a fail-fast backstop, not the gate.
    if (!userId.trim()) {
      throw new Error('TenantDbService.runAs requires a non-empty userId');
    }

    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.current_user_id', ${userId}, true)`,
      );
      return fn(tx);
    });
  }

  /**
   * Run `fn` with NO tenant identity — the ONLY non-owner read path, for public
   * chat sharing. Sets `app.current_user_id` to the empty string (transaction-
   * local), so every owner policy (`owner_user_id = ''`) matches nothing and
   * ONLY the SELECT-only `*_public_read` policies (gated on `visibility='public'`)
   * apply. A private chat is invisible here. This context can only READ public
   * rows — the public-read policies grant no write.
   */
  async runAsPublic<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_user_id', '', true)`);
      return fn(tx as unknown as Db);
    });
  }
}
