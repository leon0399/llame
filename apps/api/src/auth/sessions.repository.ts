import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ne } from 'drizzle-orm';
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

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    return rows[0];
  }

  async updateLastSeenAt(sessionId: string, lastSeenAt: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ lastSeenAt })
      .where(eq(sessions.id, sessionId));
  }

  async listForUser(userId: string): Promise<SessionRecord[]> {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt));
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
}
