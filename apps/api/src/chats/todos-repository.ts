import { asc, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { todos, type Todo } from '../db/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Status values a `write_todos` item may carry. */
export type TodoStatus = (typeof todos.status.enumValues)[number];

/** Upper bound on todos per chat — a plan, not a dumping ground; also bounds
 *  the replace-all payload. */
export const TODOS_MAX_PER_CHAT = 50;

/** Chat-scoped access to the agent's todo list (RLS is the primary guard). */
export class TodosRepository {
  constructor(private readonly db: Db) {}

  /** The chat's todos, in plan order. */
  async list(chatId: string): Promise<Todo[]> {
    return this.db
      .select()
      .from(todos)
      .where(eq(todos.chatId, chatId))
      .orderBy(asc(todos.position));
  }

  /**
   * REPLACE the chat's todo list with `items` (delete-all + reinsert with
   * `position` = array order). Runs inside the caller's `runAs` transaction, so
   * the delete + insert are atomic — a failure rolls back to the prior list,
   * never a partial wipe. Empty `items` clears the list (a completed plan).
   */
  async replace(
    chatId: string,
    items: readonly { content: string; status?: TodoStatus }[],
  ): Promise<Todo[]> {
    // Bound the mid-stream delete+bulk-insert on the process's single
    // connection (same rationale as MessagesRepository.search's timeout).
    await this.db.execute(sql`SET LOCAL statement_timeout = 3000`);
    await this.db.delete(todos).where(eq(todos.chatId, chatId));
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
          position: i,
        })),
      )
      .returning();
  }
}
