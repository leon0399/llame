/**
 * The write that puts a Run's skill activations on its triggering user message.
 *
 * Its own repository rather than another method on `MessagesRepository`: this
 * write has a distinct concern (idempotent, run-keyed append of server-authored
 * context items) and a distinct guard (the run-id non-existence check), and
 * `MessagesRepository` is already at its file-size limit.
 */

import { and, eq, sql } from 'drizzle-orm';

import { messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type AuthoredContextItemPart } from './context-item';

export class ActivationPartsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Append this Run's activation context items, or report that they are
   * already present.
   *
   * Idempotent on `(messageId, runId)`: a retry of the same Run finds its parts
   * and appends nothing, which is what makes recovery replay the STORED text —
   * a skill whose file changed since the first attempt replays what the model
   * was actually given, rather than silently reloading.
   *
   * The guard lives in the same statement as the write, so a concurrent retry
   * cannot slip between a separate check and the append.
   *
   * Items land after any existing context-item parts and before the user's own
   * text, because that is where `parts || items` puts them and the author-time
   * order the rail defines (disclosures first, the user's words last) requires
   * it.
   */
  async appendForRun(input: {
    id: string;
    chatId: string;
    runId: string;
    items: ReadonlyArray<AuthoredContextItemPart>;
  }): Promise<{ readonly applied: boolean }> {
    if (input.items.length === 0) return { applied: false };
    const [updated] = await this.db
      .update(messages)
      .set({
        parts: sql`${messages.parts} || ${JSON.stringify(input.items)}::jsonb`,
      })
      .where(
        and(
          eq(messages.id, input.id),
          eq(messages.chatId, input.chatId),
          eq(messages.role, 'user'),
          sql`not exists (
            select 1 from jsonb_array_elements(${messages.parts}) as existing
            where existing -> 'data' ->> 'runId' = ${input.runId}
          )`,
        ),
      )
      .returning({ id: messages.id });
    return { applied: updated !== undefined };
  }
}
