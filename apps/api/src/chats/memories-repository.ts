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

export type MemorySource = (typeof memories.source.enumValues)[number];

/**
 * Total char budget for memories auto-injected into the system prompt each turn
 * (a bounded, cache-prefix-friendly full-dump; relevance retrieval is v0.6).
 */
export const MEMORY_INJECT_CHAR_BUDGET = 2000;

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

  async create(
    userId: string,
    content: string,
    source: MemorySource = 'agent',
  ): Promise<Memory> {
    const [created] = await this.db
      .insert(memories)
      .values({ userId, content, source })
      .returning();
    return created;
  }

  /** True if the user already has a memory with exactly this content (dedupe). */
  async existsByContent(userId: string, content: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: memories.id })
      .from(memories)
      .where(and(eq(memories.userId, userId), eq(memories.content, content)))
      .limit(1);
    return row !== undefined;
  }

  /**
   * Newest `source='user'` memories whose CUMULATIVE content length fits
   * `charBudget` — the always-on system-prompt injection set. Agent memories are
   * excluded on purpose (they may carry untrusted content; system-slot laundering
   * risk) — they stay reachable only via the on-demand `recall` tool.
   */
  async listForInjection(
    userId: string,
    charBudget: number,
  ): Promise<Memory[]> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(and(eq(memories.userId, userId), eq(memories.source, 'user')))
      .orderBy(desc(memories.createdAt))
      .limit(50);
    const picked: Memory[] = [];
    let used = 0;
    for (const row of rows) {
      const next = used + row.content.length + 1;
      if (next > charBudget) {
        break;
      }
      used = next;
      picked.push(row);
    }
    return picked;
  }

  /** The owner's memories, newest first (user-facing management list). */
  async list(userId: string, limit: number): Promise<Memory[]> {
    return this.db
      .select()
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(desc(memories.createdAt))
      .limit(limit);
  }

  /**
   * Delete one of the owner's memories. RLS already scopes the row to the
   * caller (a cross-tenant id simply matches nothing); the `userId` predicate
   * is belt-and-suspenders. Returns true iff a row was removed (→ 404 mapping).
   */
  async delete(id: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(memories)
      .where(and(eq(memories.id, id), eq(memories.userId, userId)))
      .returning({ id: memories.id });
    return deleted.length > 0;
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
