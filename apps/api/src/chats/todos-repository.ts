import { and, asc, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { todos, type Todo } from '../db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Status values a `write_todos` item may carry. */
export type TodoStatus = (typeof todos.status.enumValues)[number];

/** Upper bound on todos per chat — a plan, not a dumping ground; also bounds
 *  the replace-all payload. */
export const TODOS_MAX_PER_CHAT = 50;

/**
 * A Postgres unique_violation (23505). Walks the cause chain — drizzle wraps
 * the postgres.js error. Used ONLY to retry a spurious same-tick position race
 * on `todos_chat_source_position_idx` (not gated to a specific index name, so
 * keep it internal to the position-retry path).
 */
function isTodoPositionConflict(error: unknown): boolean {
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

/** Chat-scoped access to the agent's todo list (RLS is the primary guard). */
export class TodosRepository {
  constructor(private readonly db: Db) {}

  /**
   * The chat's todos: the agent's plan first (in its `position` order), then
   * the user's own todos (in theirs) — a stable, collision-free order across
   * the two `source` position spaces.
   */
  async list(chatId: string): Promise<Todo[]> {
    return this.db
      .select()
      .from(todos)
      .where(eq(todos.chatId, chatId))
      .orderBy(
        sql`case ${todos.source} when 'agent' then 0 else 1 end`,
        asc(todos.position),
      );
  }

  /** The chat's USER todos (the cap governs the user's own list). */
  async countUserTodos(chatId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(todos)
      .where(and(eq(todos.chatId, chatId), eq(todos.source, 'user')));
    return row?.n ?? 0;
  }

  /**
   * Append one USER todo after the user's existing ones (`position` = MAX+1
   * within `source='user'`, so it never collides with the agent's 0..n space).
   * A rare concurrent double-add races on the same MAX+1 → unique violation;
   * a single retry recomputes MAX+1 and succeeds (the losing slot is spurious,
   * not a real conflict). RLS (`todos_owner` = chat ownership) is the guard.
   *
   * `this.db` here is already the `runAs` transaction — a bare `insert` that
   * throws would poison it (Postgres: "current transaction is aborted") and
   * fail the retry too. Each attempt runs in its own nested `transaction`,
   * which drizzle-orm's postgres-js driver compiles to a SAVEPOINT, so a
   * unique-violation attempt rolls back to the savepoint (not the whole
   * transaction) and the outer transaction — and RLS's `app.current_user_id`
   * — stays intact for the retry.
   */
  async add(chatId: string, content: string): Promise<Todo> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(todos)
            .values({
              chatId,
              content,
              status: 'pending',
              source: 'user',
              position: sql`(SELECT COALESCE(MAX(position), -1) + 1 FROM ${todos} WHERE ${todos.chatId} = ${chatId} AND ${todos.source} = 'user')`,
            })
            .returning();
          return created;
        });
      } catch (error) {
        if (attempt === 0 && isTodoPositionConflict(error)) {
          continue;
        }
        throw error;
      }
    }
    // Unreachable: the loop either returns or throws.
    throw new Error('todo add failed after retry');
  }

  /**
   * Set a USER todo's status within a chat (RLS-scoped + chatId seatbelt).
   * Scoped to `source='user'` — the agent's plan is read-only through this
   * surface (the panel never mutates it; only `write_todos` replace-all does).
   */
  async updateStatus(
    chatId: string,
    id: string,
    status: TodoStatus,
  ): Promise<Todo | undefined> {
    const [updated] = await this.db
      .update(todos)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(todos.id, id),
          eq(todos.chatId, chatId),
          eq(todos.source, 'user'),
        ),
      )
      .returning();
    return updated;
  }

  /**
   * Delete a USER todo within a chat (RLS-scoped + chatId seatbelt). Scoped to
   * `source='user'`, same reasoning as `updateStatus`.
   */
  async deleteById(chatId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(todos)
      .where(
        and(
          eq(todos.id, id),
          eq(todos.chatId, chatId),
          eq(todos.source, 'user'),
        ),
      )
      .returning({ id: todos.id });
    return deleted.length > 0;
  }

  /**
   * REPLACE the chat's AGENT todo list with `items` (delete-all + reinsert
   * with `position` = array order). Runs inside the caller's `runAs`
   * transaction, so the delete + insert are atomic — a failure rolls back to
   * the prior list, never a partial wipe. Empty `items` clears the agent's
   * plan (a completed plan). ONLY the agent's own todos are touched — the
   * user's `source='user'` list is never wiped by a plan-write.
   */
  async replace(
    chatId: string,
    items: readonly { content: string; status?: TodoStatus }[],
  ): Promise<Todo[]> {
    // Bound the mid-stream delete+bulk-insert on the process's single
    // connection (same rationale as MessagesRepository.search's timeout).
    await this.db.execute(sql`SET LOCAL statement_timeout = 3000`);
    await this.db
      .delete(todos)
      .where(and(eq(todos.chatId, chatId), eq(todos.source, 'agent')));
    if (items.length === 0) {
      return [];
    }
    return this.db
      .insert(todos)
      .values(
        items.map((item, i) => ({
          chatId,
          content: item.content,
          status: item.status ?? ('pending' as const),
          source: 'agent' as const,
          position: i,
        })),
      )
      .returning();
  }
}
