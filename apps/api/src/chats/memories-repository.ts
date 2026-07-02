import { and, desc, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { memories, type Memory } from '../db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Upper bound on memories per user — a soft abuse/growth cap so an agent loop
 * or adversarial user can't grow the (unindexed-scan) table without bound.
 * Generous; a real user won't hit it, `remember` fails-structured at the cap.
 */
export const MEMORY_MAX_PER_USER = 1000;

/** Owner-scoped access to durable agent memory (RLS is the primary guard). */
export class MemoriesRepository {
  constructor(private readonly db: Db) {}

  async countByUser(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(memories)
      .where(eq(memories.userId, userId));
    return row?.n ?? 0;
  }

  async create(userId: string, content: string): Promise<Memory> {
    const [created] = await this.db
      .insert(memories)
      .values({ userId, content })
      .returning();
    return created;
  }

  /**
   * Keyword-search the owner's memories (the recall tool). Same value-safe,
   * wildcard-escaped ILIKE + statement_timeout as MessagesRepository.search —
   * this is an unindexed scan on the process's single connection.
   */
  async search(
    query: string,
    userId: string,
    limit: number,
  ): Promise<Memory[]> {
    await this.db.execute(sql`SET LOCAL statement_timeout = 3000`);
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    return this.db
      .select()
      .from(memories)
      .where(and(eq(memories.userId, userId), sql`content ILIKE ${pattern}`))
      .orderBy(desc(memories.createdAt))
      .limit(limit);
  }
}
