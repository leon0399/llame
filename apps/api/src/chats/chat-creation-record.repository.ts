import { and, eq, sql } from 'drizzle-orm';

import {
  type ChatCreationAttempt,
  type ChatCreationPathDecision,
  chatCreationRecords,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';

/*
 * The owner-only creation record of one Chat (openspec `chat-start-location`,
 * design D9; `tool-call-permissions` "Chat-creation path decisions are recorded
 * with the chat"). One row per Chat holds an array of attempts; chat creation
 * appends, and nothing else writes the table.
 */

export class ChatCreationRecordRepository {
  constructor(private readonly db: Db) {}

  /**
   * Append one attempt with its own `created_at`. The insert-or-append is one
   * statement, so two appends on one Chat cannot lose an entry.
   */
  async appendAttempt(input: {
    readonly ownerUserId: string;
    readonly chatId: string;
    readonly decisions: ReadonlyArray<ChatCreationPathDecision>;
  }): Promise<void> {
    const attempt: ChatCreationAttempt = {
      createdAt: new Date().toISOString(),
      decisions: [...input.decisions],
    };
    await this.db
      .insert(chatCreationRecords)
      .values({
        ownerUserId: input.ownerUserId,
        chatId: input.chatId,
        attempts: [attempt],
      })
      .onConflictDoUpdate({
        target: [chatCreationRecords.ownerUserId, chatCreationRecords.chatId],
        set: {
          attempts: sql`${chatCreationRecords.attempts} || ${JSON.stringify([attempt])}::jsonb`,
        },
      });
  }

  /** The Chat's attempts, or an empty list for a Chat creation never touched. */
  async findAttempts(
    ownerUserId: string,
    chatId: string,
  ): Promise<ReadonlyArray<ChatCreationAttempt>> {
    const [row] = await this.db
      .select({ attempts: chatCreationRecords.attempts })
      .from(chatCreationRecords)
      .where(
        and(
          eq(chatCreationRecords.ownerUserId, ownerUserId),
          eq(chatCreationRecords.chatId, chatId),
        ),
      )
      .limit(1);
    return row?.attempts ?? [];
  }
}
