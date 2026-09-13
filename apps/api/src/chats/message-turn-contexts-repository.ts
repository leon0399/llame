/**
 * MessageTurnContextsRepository — owner-scoped access to the
 * `message_turn_contexts` table. Writes immutable per-turn acceptance
 * evidence and fences one-time execution-item recording.
 */

import { and, eq, isNull } from 'drizzle-orm';

import {
  type Chat,
  type Message,
  type MessageTurnContext,
  type RecencyDigestBaseline,
  type RecencyDigestToldEntry,
  type Run,
  type RunContextItem,
  messageTurnContexts,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  type ChatsRepository,
  CompactionsRepository,
} from './chats-repository';
import { type RecencyDigestDelta } from './recency-digest.service';

export type CreateTurnEvidenceInput = {
  chatId: string;
  originRunId: string;
  messageId: string;
  ownerUserId: string;
  modelId: string;
  effort: string | null;
  acceptedAt: Date;
  snapshotId: string | null;
  contextRevision: number;
  sourceMaxSeq: number;
  activeCompactionId: string | null;
  digestBaseline: RecencyDigestBaseline | null;
  digestTold: Array<RecencyDigestToldEntry> | null;
  digestRebakedFrom: string | null;
};

export class MessageTurnContextsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Record immutable acceptance evidence for a single Run. Called atomically
   * inside the accepted-turn transaction; a rollback creates no evidence.
   * The `contextItems` column stays NULL until `recordContextItems` fills
   * it during execution.
   */
  async create(input: CreateTurnEvidenceInput): Promise<void> {
    await this.db.insert(messageTurnContexts).values({
      chatId: input.chatId,
      originRunId: input.originRunId,
      messageId: input.messageId,
      ownerUserId: input.ownerUserId,
      modelId: input.modelId,
      effort: input.effort,
      acceptedAt: input.acceptedAt,
      snapshotId: input.snapshotId,
      contextRevision: input.contextRevision,
      sourceMaxSeq: input.sourceMaxSeq,
      activeCompactionId: input.activeCompactionId,
      digestBaseline: input.digestBaseline,
      digestTold: input.digestTold,
      digestRebakedFrom: input.digestRebakedFrom,
    });
  }

  /**
   * One-time execution-item recording, fenced: writes context items only
   * when the evidence row exists and its `contextItems` column is still
   * NULL. A redelivered worker cannot overwrite already-recorded items.
   * Returns the updated row, or undefined if the fence rejected the write.
   */
  async recordContextItems(
    chatId: string,
    originRunId: string,
    ownerUserId: string,
    items: Array<RunContextItem>,
  ): Promise<MessageTurnContext | undefined> {
    const [updated] = await this.db
      .update(messageTurnContexts)
      .set({ contextItems: items })
      .where(
        and(
          eq(messageTurnContexts.chatId, chatId),
          eq(messageTurnContexts.originRunId, originRunId),
          eq(messageTurnContexts.ownerUserId, ownerUserId),
          isNull(messageTurnContexts.contextItems),
        ),
      )
      .returning();
    return updated;
  }
}

type AcceptanceEvidenceInput = {
  tx: Db;
  chatsRepo: ChatsRepository;
  chat: Chat;
  input: { chatId: string; userId: string; modelId: string; effort?: string };
  run: Run;
  userMessage: Message;
  digestDelta: RecencyDigestDelta | null;
};

/**
 * Capture the post-accept digest/compaction continuation state as
 * immutable turn-context evidence. contextItems stay NULL until the
 * worker records them (fenced by the NULL check in the repository).
 */
export async function recordAcceptanceEvidence(
  opts: AcceptanceEvidenceInput,
): Promise<void> {
  const { tx, chatsRepo, chat, input, run, userMessage, digestDelta } = opts;
  const latestCompaction = await new CompactionsRepository(
    tx,
  ).findLatestByChatId(input.chatId, input.userId);
  const nextRevision = chat.contextRevision + 1;
  await chatsRepo.advanceContextRevision(
    input.chatId,
    input.userId,
    nextRevision,
  );
  // Re-read the chat row to capture post-binding digest state: the
  // resolveDigestBindingAndDelta step may have initialized the baseline
  // after the caller's `chat` snapshot was taken.
  const freshChat = await chatsRepo.findById(input.chatId, input.userId);
  const postAcceptTold = digestDelta?.told ?? freshChat?.recencyDigestTold;
  await new MessageTurnContextsRepository(tx).create({
    chatId: input.chatId,
    originRunId: run.id,
    messageId: userMessage.id,
    ownerUserId: input.userId,
    modelId: input.modelId,
    effort: input.effort ?? null,
    acceptedAt: new Date(),
    snapshotId: run.modelContextSnapshotId,
    contextRevision: nextRevision,
    sourceMaxSeq: userMessage.seq,
    activeCompactionId: latestCompaction?.id ?? null,
    digestBaseline: freshChat?.recencyDigestBaseline ?? null,
    digestTold: postAcceptTold ?? null,
    digestRebakedFrom: freshChat?.recencyDigestRebakedFrom ?? null,
  });
}
