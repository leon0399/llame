import { and, asc, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { prompts, type Prompt } from '../db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Upper bound on saved prompts per user — a library, not a dumping ground. */
export const PROMPT_MAX_PER_USER = 100;

// Arbitrary namespace id for the prompt-cap advisory lock (2-int-arg form, so
// this lock's keyspace can never collide with an unrelated single-arg
// pg_advisory_xact_lock call elsewhere in the codebase).
const PROMPT_CAP_LOCK_CLASSID = 411_001;

/**
 * A Postgres unique_violation (23505) — the `prompts_user_name_idx` collision
 * (a duplicate `/name` for the same user). Walks the cause chain (drizzle wraps
 * the postgres.js error). Mapped to 409 by the controller.
 */
export function isPromptNameConflict(error: unknown): boolean {
  let cursor: unknown = error;
  while (cursor instanceof Error || (cursor && typeof cursor === 'object')) {
    if ((cursor as { code?: unknown }).code === '23505') {
      return true;
    }
    cursor = (cursor as { cause?: unknown }).cause;
    if (cursor === undefined || cursor === null) {
      break;
    }
  }
  return false;
}

/** Owner-scoped access to a user's saved prompts (RLS is the primary guard). */
export class PromptsRepository {
  constructor(private readonly db: Db) {}

  /** The user's prompts, name-ordered. */
  async list(userId: string): Promise<Prompt[]> {
    return this.db
      .select()
      .from(prompts)
      .where(eq(prompts.userId, userId))
      .orderBy(asc(prompts.name));
  }

  /**
   * Serializes concurrent create() calls for the SAME user for the rest of
   * this transaction (released automatically on commit/rollback), so the
   * cap check in countByUser() + the following create() can't race under
   * concurrent requests from the same user and overshoot PROMPT_MAX_PER_USER.
   * Different users never block each other (namespaced by userId).
   */
  async lockUserForCreate(userId: string): Promise<void> {
    await this.db.execute(
      sql`select pg_advisory_xact_lock(${PROMPT_CAP_LOCK_CLASSID}, hashtext(${userId}))`,
    );
  }

  async countByUser(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(prompts)
      .where(eq(prompts.userId, userId));
    return row?.n ?? 0;
  }

  async create(userId: string, name: string, content: string): Promise<Prompt> {
    const [created] = await this.db
      .insert(prompts)
      .values({ userId, name, content })
      .returning();
    return created;
  }

  /** Patch name/content, owner-scoped. Undefined when not found / not owned. */
  async update(
    id: string,
    userId: string,
    patch: { name?: string; content?: string },
  ): Promise<Prompt | undefined> {
    const fields = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
    };
    if (Object.keys(fields).length === 0) {
      const [row] = await this.db
        .select()
        .from(prompts)
        .where(and(eq(prompts.id, id), eq(prompts.userId, userId)))
        .limit(1);
      return row;
    }
    const [updated] = await this.db
      .update(prompts)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(prompts.id, id), eq(prompts.userId, userId)))
      .returning();
    return updated;
  }

  /** Delete by id, owner-scoped. True iff a row was removed (→ 404). */
  async delete(id: string, userId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, userId)))
      .returning({ id: prompts.id });
    return deleted.length > 0;
  }
}
