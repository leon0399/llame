import { isTextPart } from '../../chats/context-builder';
import {
  chunkByCharBudget,
  chunkContentHash,
  normalizeForSearch,
} from '../core';

/**
 * Conversation chunker (search/chat) — the chat-corpus adapter over the generic
 * search/core toolkit. Turns an ordered chat transcript into contextual multi-
 * message chunks for the lexical projection (#195).
 *
 * Corpus-boundary policy (episodic memory = "what was said"): only the TEXT parts
 * of `user`/`assistant` turns are serialized. System prompts, tool-role messages,
 * tool call/result parts, reasoning parts, and attachments are excluded entirely —
 * they never enter the search index (attachments belong to the future knowledge/RAG
 * corpus, not episodic search). `isTextPart` is reused from the context builder so
 * the text-part shape check can't drift between the two.
 */
export const CHUNKER_VERSION = 1;

// Tunable v1 constants (grill-locked). All chunk shape lives behind CHUNKER_VERSION;
// a change here is a version bump, and the discovery sweep rebuilds every chat.
export const CHUNK_MAX_CHARS = 3000; // ≈750 tokens — inside phase-2 embedding budgets
export const CHUNK_OVERLAP_MESSAGES = 1;

export interface ChunkerMessage {
  id: string;
  role: string;
  parts: unknown[];
  createdAt: Date;
}

export interface ConversationChunk {
  chunkOrdinal: number;
  firstMessageId: string;
  lastMessageId: string;
  firstMessageAt: Date;
  lastMessageAt: Date;
  content: string;
  normalizedContent: string;
  contentHash: string;
}

interface MessageBlock {
  messageId: string;
  createdAt: Date;
  text: string;
}

function toBlock(message: ChunkerMessage): MessageBlock | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  const text = message.parts
    .filter(isTextPart)
    .map((p) => p.text)
    .join('\n')
    .trim();
  if (text.length === 0) return null;
  return {
    messageId: message.id,
    createdAt: message.createdAt,
    // Role marker so a query term is anchored to who said it and boundaries stay
    // legible after chunk-join.
    text: `[${message.role}] ${text}`,
  };
}

/**
 * Deterministic: identical input yields byte-identical chunks (the content-hash
 * no-op-upsert path depends on it). Messages ordered by `seq` upstream.
 */
export function chunkConversation(
  messages: readonly ChunkerMessage[],
): ConversationChunk[] {
  const blocks = messages
    .map(toBlock)
    .filter((b): b is MessageBlock => b !== null);

  const groups = chunkByCharBudget(blocks, (b) => b.text.length, {
    maxChars: CHUNK_MAX_CHARS,
    overlapItems: CHUNK_OVERLAP_MESSAGES,
  });

  return groups.map((group, chunkOrdinal) => {
    const content = group.map((b) => b.text).join('\n\n');
    const normalizedContent = normalizeForSearch(content);
    const first = group[0];
    const last = group[group.length - 1];
    return {
      chunkOrdinal,
      firstMessageId: first.messageId,
      lastMessageId: last.messageId,
      firstMessageAt: first.createdAt,
      lastMessageAt: last.createdAt,
      content,
      normalizedContent,
      contentHash: chunkContentHash({
        chunkerVersion: CHUNKER_VERSION,
        normalizedContent,
        firstMessageId: first.messageId,
        lastMessageId: last.messageId,
      }),
    };
  });
}
