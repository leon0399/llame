import { Injectable } from '@nestjs/common';
import { and, eq, gte, ne, or, sql } from 'drizzle-orm';

import { type Db, TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { searchChatDocuments } from '../db/schema/search';
import { isRecord } from '@workspace/runtime-safety';
import {
  CHUNKER_VERSION,
  chunkConversation,
  type ConversationChunk,
} from './chat/conversation-chunker';

/** Postgres serialization failure (SQLSTATE 40001) — a REPEATABLE READ rebuild that
 *  lost a write race against a concurrent rebuild of the same chat; safe to retry
 *  (the retry's fresh snapshot sees the winner's commit and converges). */
function isSerializationFailure(error: unknown): boolean {
  return isRecord(error) && error['code'] === '40001';
}

/** Shape of one previously-indexed chunk, as read back for the hash/locator diff. */
interface ExistingChunkRow {
  ordinal: number;
  version: number;
  ownerUserId: string;
  hash: string;
  firstMessageId: string;
  lastMessageId: string;
  firstMessageTextOffset: number | null;
  lastMessageTextOffsetExclusive: number | null;
}

/**
 * Which of `chunks` need to be (re)written: a chunk is unchanged only when a
 * current-version row exists for its ordinal and every content/locator field —
 * including `ownerUserId`, since a chat transfer must still rewrite every row —
 * matches exactly. Pure and hash/locator-diff-only, so it is safe to call on
 * every rebuild, including a cheap no-op pass.
 */
function diffChangedChunks(
  existing: Array<ExistingChunkRow>,
  chunks: Array<ConversationChunk>,
  ownerUserId: string,
): Array<ConversationChunk> {
  const currentByOrdinal = new Map(
    existing
      .filter((row) => row.version === CHUNKER_VERSION)
      .map((row) => [row.ordinal, row]),
  );
  return chunks.filter((chunk) => {
    const current = currentByOrdinal.get(chunk.chunkOrdinal);
    return (
      current?.ownerUserId !== ownerUserId ||
      current?.hash !== chunk.contentHash ||
      current?.firstMessageId !== chunk.firstMessageId ||
      current?.lastMessageId !== chunk.lastMessageId ||
      current?.firstMessageTextOffset !== chunk.firstMessageTextOffset ||
      current?.lastMessageTextOffsetExclusive !==
        chunk.lastMessageTextOffsetExclusive
    );
  });
}

/** New/changed row, mapped from a search chunk, ready for `.insert().values()`. */
function toChunkRow(
  ownerUserId: string,
  chatId: string,
  chunk: ConversationChunk,
) {
  return {
    ownerUserId,
    chatId,
    chunkOrdinal: chunk.chunkOrdinal,
    chunkerVersion: CHUNKER_VERSION,
    firstMessageId: chunk.firstMessageId,
    lastMessageId: chunk.lastMessageId,
    firstMessageAt: chunk.firstMessageAt,
    lastMessageAt: chunk.lastMessageAt,
    firstMessageTextOffset: chunk.firstMessageTextOffset,
    lastMessageTextOffsetExclusive: chunk.lastMessageTextOffsetExclusive,
    content: chunk.content,
    normalizedContent: chunk.normalizedContent,
    contentHash: chunk.contentHash,
  };
}

// chat-search-embeddings design D7's "upsert trap" (trap 1): this upsert only
// runs for `changed` chunks — those whose content hash or canonical locator
// differs (see `diffChangedChunks`) — so nulling the embedding columns here
// clears a stale vector PRECISELY when its content or source changed, never
// on a no-op rebuild. Omitting these five is the single way this design can
// silently serve a WRONG embedding: the row's content is rewritten while its
// vector still describes the old text, with no error and no symptom until
// ranking degrades.
const CHUNK_UPSERT_CONFLICT_SET = {
  ownerUserId: sql`excluded.owner_user_id`,
  firstMessageId: sql`excluded.first_message_id`,
  lastMessageId: sql`excluded.last_message_id`,
  firstMessageAt: sql`excluded.first_message_at`,
  lastMessageAt: sql`excluded.last_message_at`,
  firstMessageTextOffset: sql`excluded.first_message_text_offset`,
  lastMessageTextOffsetExclusive: sql`excluded.last_message_text_offset_exclusive`,
  content: sql`excluded.content`,
  normalizedContent: sql`excluded.normalized_content`,
  contentHash: sql`excluded.content_hash`,
  updatedAt: sql`now()`,
  embedding: sql`NULL`,
  embeddingModelKey: sql`NULL`,
  embeddedContentHash: sql`NULL`,
  embedInputVersion: sql`NULL`,
  embeddingFailReason: sql`NULL`,
};

/**
 * SearchIndexService (#195) — rebuilds ONE chat's lexical projection from the
 * canonical `messages`, always inside the chat owner's tenant transaction so RLS
 * governs every read and write (the worker passes the owner id; the projection
 * tables' owner policy and the message read are both scoped by it). Rebuild-per-
 * chat with a content-hash diff: unchanged chunks are left untouched (no-op
 * upsert), so a redundant reindex is cheap and a message edit rebuilds only what
 * changed. Deterministic — the chunker output is a pure function of the messages.
 */
@Injectable()
export class SearchIndexService {
  constructor(private readonly tenantDb: TenantDbService) {}

  async reindexChat(chatId: string, ownerUserId: string): Promise<void> {
    // REPEATABLE READ: the whole rebuild (message read → chunk → indexed_at
    // watermark subquery) sees ONE snapshot, so a plain message write that lands
    // mid-rebuild can't be stamped into the watermark without also being chunked
    // (which would hide it from BOTH search and the discovery sweep). If a write
    // lands mid-rebuild it is simply excluded from this pass; chats.updated_at then
    // stays ahead of indexed_at, so the sweep re-flags the chat and it self-heals.
    //
    // Two rebuilds of the SAME chat (a Tier-1 inline finalize racing a queued job)
    // can collide writing the same projection rows and raise a serialization failure
    // (40001) under REPEATABLE READ. An advisory lock CANNOT prevent this here: runAs
    // sets `app.current_user_id` as the transaction's first statement, which is what
    // pins the REPEATABLE READ snapshot (verified — a function-only SELECT freezes it),
    // so any lock taken afterwards is already behind the snapshot. Instead retry with a
    // fresh transaction: the retry's new snapshot sees the winner's commit and converges
    // (usually a hash no-op). The rebuild is idempotent, so a retry is always safe.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.tenantDb.runAs(
          ownerUserId,
          (tx) => this.rebuildInTx(tx, chatId, ownerUserId),
          { isolationLevel: 'repeatable read' },
        );
        return;
      } catch (error) {
        if (attempt < 4 && isSerializationFailure(error)) continue;
        throw error;
      }
    }
  }

  private async rebuildInTx(
    tx: Db,
    chatId: string,
    ownerUserId: string,
  ): Promise<void> {
    // Reuse the repository reads (they carry the owner filter as defense-in-depth
    // on top of RLS). A missing chat means it was deleted or is not owned —
    // nothing to index (its projection rows cascade-delete anyway). findByChatId
    // with no options returns every message oldest-first by seq.
    const chat = await new ChatsRepository(tx).findById(chatId, ownerUserId);
    if (!chat) return;
    const rows = await new MessagesRepository(tx).findByChatId(
      chatId,
      ownerUserId,
    );

    const chunks = chunkConversation(rows);
    const existing = await this.selectExistingChunks(tx, chatId);
    const changed = diffChangedChunks(existing, chunks, ownerUserId);
    if (changed.length > 0) {
      await this.upsertChunks(tx, chatId, ownerUserId, changed);
    }
    await this.pruneObsoleteChunks(tx, chatId, chunks.length);
    await this.updateWatermark(tx, chatId, ownerUserId, chunks.length);
  }

  private async selectExistingChunks(
    tx: Db,
    chatId: string,
  ): Promise<Array<ExistingChunkRow>> {
    return tx
      .select({
        ordinal: searchChatDocuments.chunkOrdinal,
        version: searchChatDocuments.chunkerVersion,
        ownerUserId: searchChatDocuments.ownerUserId,
        hash: searchChatDocuments.contentHash,
        firstMessageId: searchChatDocuments.firstMessageId,
        lastMessageId: searchChatDocuments.lastMessageId,
        firstMessageTextOffset: searchChatDocuments.firstMessageTextOffset,
        lastMessageTextOffsetExclusive:
          searchChatDocuments.lastMessageTextOffsetExclusive,
      })
      .from(searchChatDocuments)
      .where(eq(searchChatDocuments.chatId, chatId));
  }

  // Changed/new chunks upsert in ONE multi-row statement (one round-trip
  // regardless of N — matters for a version-bump rebuild / cold backfill).
  private async upsertChunks(
    tx: Db,
    chatId: string,
    ownerUserId: string,
    changed: Array<ConversationChunk>,
  ): Promise<void> {
    await tx
      .insert(searchChatDocuments)
      .values(changed.map((chunk) => toChunkRow(ownerUserId, chatId, chunk)))
      .onConflictDoUpdate({
        target: [
          searchChatDocuments.chatId,
          searchChatDocuments.chunkOrdinal,
          searchChatDocuments.chunkerVersion,
        ],
        set: CHUNK_UPSERT_CONFLICT_SET,
      });
  }

  // One DELETE for both obsolete-tail (current version, ordinal past the new
  // count) and stale-version rows (a version bump rebuilds the whole chat).
  private async pruneObsoleteChunks(
    tx: Db,
    chatId: string,
    chunkCount: number,
  ): Promise<void> {
    await tx
      .delete(searchChatDocuments)
      .where(
        and(
          eq(searchChatDocuments.chatId, chatId),
          or(
            ne(searchChatDocuments.chunkerVersion, CHUNKER_VERSION),
            gte(searchChatDocuments.chunkOrdinal, chunkCount),
          ),
        ),
      );
  }

  private async updateWatermark(
    tx: Db,
    chatId: string,
    ownerUserId: string,
    chunkCount: number,
  ): Promise<void> {
    // indexed_at is the high-water mark the discovery sweep compares against: the
    // GREATEST of the newest message time AND the chat's own updated_at (bumped on
    // every turn incl. an in-place assistant-reply update — which leaves
    // messages.created_at unchanged). Taking the greatest of BOTH signals here is
    // what keeps the chat from being perpetually re-flagged after indexing. It is
    // computed IN SQL — round-tripping a timestamptz through a JS Date truncates
    // microseconds to milliseconds, which would leave the chat permanently stale.
    // The message-max falls back to the chat's own creation time for a message-less
    // chat (never flagged by the message-time branch).
    await tx.execute(sql`
      INSERT INTO search_chat_state (
        chat_id,
        owner_user_id,
        indexed_at,
        chunker_version,
        expected_document_count
      )
      VALUES (
        ${chatId}, ${ownerUserId},
        greatest(
          coalesce(
            (SELECT max(created_at) FROM messages WHERE chat_id = ${chatId}),
            (SELECT created_at FROM chats WHERE id = ${chatId})
          ),
          (SELECT updated_at FROM chats WHERE id = ${chatId})
        ),
        ${CHUNKER_VERSION},
        ${chunkCount}
      )
      ON CONFLICT (chat_id) DO UPDATE SET
        owner_user_id = EXCLUDED.owner_user_id,
        -- monotonic: a reordered/stale rebuild commit can never walk the watermark backward
        indexed_at = GREATEST(search_chat_state.indexed_at, EXCLUDED.indexed_at),
        chunker_version = EXCLUDED.chunker_version,
        expected_document_count = EXCLUDED.expected_document_count,
        updated_at = now()
    `);
  }
}
