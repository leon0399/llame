/**
 * Per-chat `seq` assignment for single-message inserts. Each attempt reads the
 * chat's current max `seq` and inserts at the next value in one transaction;
 * a concurrent writer that took the same value surfaces as a unique violation
 * on the chat/seq index, and the insert is retried with a fresh read.
 */
import { eq, max } from 'drizzle-orm';
import { isString, type UnknownRecord } from '@workspace/runtime-safety';
import { type Message, messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

// Fixed application budget, not operator configuration. Current writers are
// bounded to assistant finalization/salvage after accepted-turn admission has
// rejected or expired an active Run; eight attempts leaves a defensive retry
// wave without permitting an unbounded transaction loop.
const MESSAGE_SEQUENCE_INSERT_ATTEMPTS = 8;
const MESSAGE_SEQUENCE_UNIQUE_INDEX = 'messages_chat_seq_unique_idx';

export type MessageInsert = typeof messages.$inferInsert;
export type MessageInsertWithoutSequence = Omit<MessageInsert, 'seq'>;

function isCauseChainLink(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isMessageSequenceUniqueViolation(error: unknown): boolean {
  for (
    let current = error;
    isCauseChainLink(current);
    current = current['cause']
  ) {
    const namesSequenceIndex =
      (isString(current['constraint_name']) &&
        current['constraint_name'] === MESSAGE_SEQUENCE_UNIQUE_INDEX) ||
      (isString(current['message']) &&
        current['message'].includes(MESSAGE_SEQUENCE_UNIQUE_INDEX));
    if (current['code'] === '23505' && namesSequenceIndex) {
      return true;
    }
  }
  return false;
}

/**
 * Run `insert` with `values` at the chat's next `seq`, retrying a bounded
 * number of times when a concurrent insert took that `seq` first.
 */
export async function insertWithChatSequence(
  db: Db,
  values: MessageInsertWithoutSequence,
  insert: (tx: Db, row: MessageInsert) => Promise<Message | undefined>,
): Promise<Message | undefined> {
  let sequenceConflict: unknown;
  for (let attempt = 0; attempt < MESSAGE_SEQUENCE_INSERT_ATTEMPTS; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [current] = await tx
          .select({ value: max(messages.seq) })
          .from(messages)
          .where(eq(messages.chatId, values.chatId));
        const seq = (current?.value ?? 0) + 1;
        if (!Number.isSafeInteger(seq) || seq <= 0) {
          throw new Error(
            `Chat ${values.chatId} exhausted safe message sequence values`,
          );
        }
        return insert(tx, { ...values, seq });
      });
    } catch (error) {
      if (!isMessageSequenceUniqueViolation(error)) {
        throw error;
      }
      sequenceConflict = error;
    }
  }
  throw sequenceConflict;
}
