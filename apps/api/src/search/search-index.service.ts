import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, gte, ne, sql } from 'drizzle-orm';

import { type Db, TenantDbService } from '../db/tenant-db.service';
import { chats, messages } from '../db/schema/chats';
import { searchDocuments } from '../db/schema/search';
import {
  CHUNKER_VERSION,
  chunkConversation,
} from './chat/conversation-chunker';

/**
 * SearchIndexService (#195) — rebuilds ONE chat's lexical projection from the
 * canonical `messages`, always inside the chat owner's tenant transaction so RLS
 * governs every read and write (the worker passes the owner id; the projection
 * tables' owner policy + the message read are both scoped by it). Rebuild-per-
 * chat with a content-hash diff: unchanged chunks are left untouched (no-op
 * upsert), so a redundant reindex is cheap and a message edit rebuilds only what
 * changed. Deterministic — the chunker output is a pure function of the messages.
 */
@Injectable()
export class SearchIndexService {
  private readonly logger = new Logger(SearchIndexService.name);

  constructor(private readonly tenantDb: TenantDbService) {}

  async reindexChat(chatId: string, ownerUserId: string): Promise<void> {
    await this.tenantDb.runAs(ownerUserId, (tx) =>
      this.rebuildInTx(tx, chatId, ownerUserId),
    );
  }

  private async rebuildInTx(
    tx: Db,
    chatId: string,
    ownerUserId: string,
  ): Promise<void> {
    // RLS scopes this to the owner's own chat; a missing row means the chat was
    // deleted or is not owned — nothing to index (its rows cascade-delete anyway).
    const [chat] = await tx
      .select({ id: chats.id })
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);
    if (!chat) return;

    const rows = await tx
      .select({
        id: messages.id,
        role: messages.role,
        parts: messages.parts,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.seq));

    const chunks = chunkConversation(rows);

    const existing = await tx
      .select({
        ordinal: searchDocuments.chunkOrdinal,
        version: searchDocuments.chunkerVersion,
        hash: searchDocuments.contentHash,
      })
      .from(searchDocuments)
      .where(eq(searchDocuments.chatId, chatId));

    const currentHashByOrdinal = new Map(
      existing
        .filter((e) => e.version === CHUNKER_VERSION)
        .map((e) => [e.ordinal, e.hash]),
    );

    for (const chunk of chunks) {
      // Hash-diff: an unchanged chunk is left exactly as-is (no write).
      if (currentHashByOrdinal.get(chunk.chunkOrdinal) === chunk.contentHash) {
        continue;
      }
      await tx
        .insert(searchDocuments)
        .values({
          ownerUserId,
          chatId,
          chunkOrdinal: chunk.chunkOrdinal,
          chunkerVersion: CHUNKER_VERSION,
          firstMessageId: chunk.firstMessageId,
          lastMessageId: chunk.lastMessageId,
          firstMessageAt: chunk.firstMessageAt,
          lastMessageAt: chunk.lastMessageAt,
          content: chunk.content,
          normalizedContent: chunk.normalizedContent,
          contentHash: chunk.contentHash,
        })
        .onConflictDoUpdate({
          target: [
            searchDocuments.chatId,
            searchDocuments.chunkOrdinal,
            searchDocuments.chunkerVersion,
          ],
          set: {
            firstMessageId: chunk.firstMessageId,
            lastMessageId: chunk.lastMessageId,
            firstMessageAt: chunk.firstMessageAt,
            lastMessageAt: chunk.lastMessageAt,
            content: chunk.content,
            normalizedContent: chunk.normalizedContent,
            contentHash: chunk.contentHash,
            updatedAt: new Date(),
          },
        });
    }

    // Drop obsolete current-version chunks (the chat shrank) and any rows from a
    // previous chunker version (a version bump rebuilds the whole chat).
    await tx
      .delete(searchDocuments)
      .where(
        and(
          eq(searchDocuments.chatId, chatId),
          eq(searchDocuments.chunkerVersion, CHUNKER_VERSION),
          gte(searchDocuments.chunkOrdinal, chunks.length),
        ),
      );
    await tx
      .delete(searchDocuments)
      .where(
        and(
          eq(searchDocuments.chatId, chatId),
          ne(searchDocuments.chunkerVersion, CHUNKER_VERSION),
        ),
      );

    // indexed_at reflects the newest message time so staleness is message-driven
    // (an assistant reply that didn't bump chats.updated_at is still caught). It is
    // computed IN SQL — round-tripping a timestamptz through a JS Date truncates
    // microseconds to milliseconds, which would leave `indexed_at < max(created_at)`
    // permanently true and the chat perpetually stale. Fallback to the chat's own
    // timestamp for a message-less chat (never flagged by the message-time branch).
    await tx.execute(sql`
      INSERT INTO search_chat_state (chat_id, owner_user_id, indexed_at, chunker_version)
      VALUES (
        ${chatId}, ${ownerUserId},
        coalesce(
          (SELECT max(created_at) FROM messages WHERE chat_id = ${chatId}),
          (SELECT created_at FROM chats WHERE id = ${chatId})
        ),
        ${CHUNKER_VERSION}
      )
      ON CONFLICT (chat_id) DO UPDATE SET
        owner_user_id = EXCLUDED.owner_user_id,
        indexed_at = EXCLUDED.indexed_at,
        chunker_version = EXCLUDED.chunker_version,
        updated_at = now()
    `);
  }
}
