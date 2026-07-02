import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, lte, ne, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { type Session, sessions } from '../db/schema';

export type SessionRecord = Session;

export type CreateSessionInput = {
  userId: string;
  tokenHash: string;
  expires: Date;
  userAgent?: string | null;
  ip?: string | null;
};

@Injectable()
export class SessionsRepository {
  constructor(
    @Inject('DB_DEV')
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const [created] = await this.db
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: input.tokenHash,
        expires: input.expires,
        userAgent: input.userAgent ?? null,
        ip: input.ip ?? null,
      })
      .returning();

    return created;
  }

  /**
   * Atomic validate-and-touch (#68). Two tiers:
   *
   * 1. Read-only fast path: a session touched within the debounce window is
   *    returned without any write — the per-request last_seen_at UPDATE is off
   *    the hot path.
   * 2. Single atomic UPDATE … RETURNING: validity (not expired, not idle) is
   *    re-checked inside the same statement that stamps last_seen_at, closing
   *    the SELECT→check→UPDATE TOCTOU window of the previous implementation.
   *
   * Returns undefined for missing, expired, or idle sessions.
   */
  async findActiveAndTouch(
    tokenHash: string,
    options: { idleTtlMs: number; touchDebounceMs: number },
  ): Promise<SessionRecord | undefined> {
    const now = Date.now();

    const fresh = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expires, new Date(now)),
          gt(sessions.lastSeenAt, new Date(now - options.touchDebounceMs)),
        ),
      )
      .limit(1);
    if (fresh[0]) {
      return fresh[0];
    }

    const [touched] = await this.db
      .update(sessions)
      .set({ lastSeenAt: new Date(now) })
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expires, new Date(now)),
          gt(sessions.lastSeenAt, new Date(now - options.idleTtlMs)),
        ),
      )
      .returning();

    return touched;
  }

  /** Housekeeping: drop a session that is expired or idle. Best-effort. */
  async deleteStaleByTokenHash(
    tokenHash: string,
    idleTtlMs: number,
  ): Promise<void> {
    const now = Date.now();
    await this.db
      .delete(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          or(
            lte(sessions.expires, new Date(now)),
            lte(sessions.lastSeenAt, new Date(now - idleTtlMs)),
          ),
        ),
      );
  }

  /** Active (unexpired) sessions only — revoked/expired rows are not "sessions". */
  async listForUser(userId: string): Promise<SessionRecord[]> {
    return this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), gt(sessions.expires, new Date())))
      .orderBy(desc(sessions.createdAt));
  }

  /** One owned session by id — replaces list-then-find on the current-session path. */
  async findByIdForUser(
    userId: string,
    sessionId: string,
  ): Promise<SessionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)))
      .limit(1);

    return rows[0];
  }

  async deleteByIdForUser(userId: string, sessionId: string): Promise<number> {
    const deleted = await this.db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)))
      .returning({ id: sessions.id });

    return deleted.length;
  }

  async deleteCurrentForUser(
    userId: string,
    sessionId: string,
  ): Promise<number> {
    return this.deleteByIdForUser(userId, sessionId);
  }

  async deleteOthersForUser(
    userId: string,
    currentSessionId: string,
  ): Promise<number> {
    const deleted = await this.db
      .delete(sessions)
      .where(
        and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)),
      )
      .returning({ id: sessions.id });

    return deleted.length;
  }

  async deleteAllForUser(userId: string): Promise<number> {
    const deleted = await this.db
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .returning({ id: sessions.id });

    return deleted.length;
  }

  /**
   * Periodic housekeeping (#68): purge sessions that are expired or idle.
   * Cross-user by design — the sessions table carries no RLS (it is consulted
   * pre-authentication); expiry is a global fact, not tenant data.
   */
  async deleteExpired(idleTtlMs: number): Promise<number> {
    const now = Date.now();
    const deleted = await this.db
      .delete(sessions)
      .where(
        or(
          lte(sessions.expires, new Date(now)),
          lte(sessions.lastSeenAt, new Date(now - idleTtlMs)),
        ),
      )
      .returning({ id: sessions.id });

    return deleted.length;
  }
}
