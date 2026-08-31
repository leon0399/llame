import {
  isImmutableEvidenceMessage,
  visibleMessageText,
} from '../../chats/conversation-evidence';
import {
  chunkByCharBudget,
  chunkContentHash,
  cutTextAtBoundary,
  normalizeForSearch,
} from '../core';

/**
 * Conversation chunker (search/chat) — the chat-corpus adapter over the generic
 * search/core toolkit. Turns an ordered chat transcript into contextual multi-
 * message chunks for the lexical projection (#195).
 *
 * Corpus-boundary policy (episodic memory = "what was said"): only the TEXT parts
 * of `user`/`assistant` turns are serialized. System prompts, tool-role messages,
 * tool call/result parts, reasoning parts, model/availability semantic controls,
 * and attachments are excluded entirely —
 * they never enter the search index (attachments belong to the future knowledge/RAG
 * corpus, not episodic search). Visible source text is shared with the
 * conversation-read path so search and reads cannot drift on part selection or
 * inserted separators.
 */
export const CHUNKER_VERSION = 4;

// Tunable v1 constants (grill-locked). All chunk shape lives behind CHUNKER_VERSION;
// a change here is a version bump, and the discovery sweep rebuilds every chat.
export const CHUNK_MAX_CHARS = 3000; // ≈750 tokens — inside phase-2 embedding budgets
export const CHUNK_OVERLAP_MESSAGES = 1;

// v3 (#517): a single message's TEXT can exceed CHUNK_MAX_CHARS on its own — the
// packer's "always take at least one item" rule then emits it whole, unsplit, so
// one document can be several times the embedding budget. Continuation slices of
// such a message are prefixed with a bounded excerpt of the preceding user
// message, so a mid-answer slice still carries what question it was answering.
export const CHUNK_ANCHOR_MAX_CHARS = 400;

export interface ChunkerMessage {
  id: string;
  role: string;
  parts: Array<unknown>;
  usage?: unknown;
  createdAt: Date;
}

export interface ConversationChunk {
  chunkOrdinal: number;
  firstMessageId: string;
  lastMessageId: string;
  firstMessageAt: Date;
  lastMessageAt: Date;
  firstMessageTextOffset: number;
  lastMessageTextOffsetExclusive: number;
  content: string;
  normalizedContent: string;
  contentHash: string;
}

interface MessageBlock {
  messageId: string;
  createdAt: Date;
  startOffset: number;
  endOffsetExclusive: number;
  content: string;
  lexicalContent: string;
}

function extractMessageText(message: ChunkerMessage): string {
  return visibleMessageText(message.parts);
}

/** Bounded, word-boundary-truncated excerpt with an elision marker when cut. */
function truncateAnchorExcerpt(text: string): string {
  if (text.length <= CHUNK_ANCHOR_MAX_CHARS) return text;
  const cut = cutTextAtBoundary(text, 0, CHUNK_ANCHOR_MAX_CHARS);
  // trimEnd: cutTextAtBoundary includes the boundary whitespace in the head
  // (the splitter needs that to reconstruct losslessly; a presentation-only
  // excerpt doesn't), so drop it before the elision marker.
  return `${text.slice(0, cut).trimEnd()}…`;
}

/**
 * `content`-only synthetic prefix for a continuation slice — same category of
 * presentation-only text as the `[role]` marker, so it never reaches
 * `lexicalContent` (see `messageToBlocks`).
 */
function formatAnchor(precedingUserText: string): string {
  return `[context: ${truncateAnchorExcerpt(precedingUserText)}] `;
}

/**
 * One message → one or more blocks. A message whose full `[role] text` fits
 * the budget produces exactly the same single block as before (byte-identical
 * for every already-fitting input). An oversized message is split into
 * budget-sized, boundary-cut slices covering `text` exactly once each; every
 * continuation slice (not the first) carries an anchor in `content` only —
 * `lexicalContent` never contains it, matching the `[role]` marker rule.
 */
function messageToBlocks(
  message: ChunkerMessage,
  text: string,
  anchorSource: string | null,
): Array<MessageBlock> {
  const prefix = `[${message.role}] `;
  return prefix.length + text.length <= CHUNK_MAX_CHARS
    ? [
        {
          messageId: message.id,
          createdAt: message.createdAt,
          startOffset: 0,
          endOffsetExclusive: text.length,
          content: `${prefix}${text}`,
          lexicalContent: text,
        },
      ]
    : sliceOversizedMessage(message, text, prefix, anchorSource);
}

/** The oversized branch of `messageToBlocks`: splits `text` into budget-sized,
 *  boundary-cut slices covering it exactly once each. Every continuation
 *  slice (not the first) carries an anchor in `content` only —
 *  `lexicalContent` never contains it, matching the `[role]` marker rule. */
function sliceOversizedMessage(
  message: ChunkerMessage,
  text: string,
  prefix: string,
  anchorSource: string | null,
): Array<MessageBlock> {
  const anchor = anchorSource === null ? '' : formatAnchor(anchorSource);
  const firstMax = CHUNK_MAX_CHARS - prefix.length;
  // The continuation budget is the first-slice budget minus what the anchor
  // itself costs — every continuation slice carries the anchor on top of the
  // same `prefix`, so its content budget is smaller by exactly that much.
  const continuationMax = firstMax - anchor.length;

  const blocks: Array<MessageBlock> = [];
  // A cursor into `text` rather than a shrinking `remaining` string: slicing
  // off the consumed head on every iteration would re-copy the whole
  // unconsumed tail each time (O(text.length) per iteration), which is
  // quadratic in the message length. `cutTextAtBoundary` bounds its own
  // lookahead to `budget`, so advancing the cursor keeps total work linear.
  let cursor = 0;
  let isFirst = true;
  while (cursor < text.length) {
    const budget = isFirst ? firstMax : continuationMax;
    const cut = cutTextAtBoundary(text, cursor, budget);
    const slice = text.slice(cursor, cut);
    blocks.push({
      messageId: message.id,
      createdAt: message.createdAt,
      startOffset: cursor,
      endOffsetExclusive: cut,
      content: `${prefix}${isFirst ? '' : anchor}${slice}`,
      lexicalContent: slice,
    });
    cursor = cut;
    isFirst = false;
  }
  return blocks;
}

/**
 * Builds the flat block list for the whole conversation, tracking the most
 * recent user message's text so an oversized *assistant* message's
 * continuation slices can anchor back to the question they're answering.
 * Rule (spec): no anchor for an oversized user message, no preceding user
 * message, or a message's first slice.
 */
function buildBlocks(
  messages: ReadonlyArray<ChunkerMessage>,
): Array<MessageBlock> {
  const blocks: Array<MessageBlock> = [];
  let precedingUserText: string | null = null;

  for (const message of messages) {
    if (!isImmutableEvidenceMessage(message)) continue;
    const text = extractMessageText(message);
    if (text.length === 0) continue;

    const anchorSource =
      message.role === 'assistant' ? precedingUserText : null;
    blocks.push(...messageToBlocks(message, text, anchorSource));

    if (message.role === 'user') precedingUserText = text;
  }

  return blocks;
}

/**
 * Deterministic: identical input yields byte-identical chunks (the content-hash
 * no-op-upsert path depends on it). Messages ordered by `seq` upstream.
 */
export function chunkConversation(
  messages: ReadonlyArray<ChunkerMessage>,
): Array<ConversationChunk> {
  const blocks = buildBlocks(messages);

  const groups = chunkByCharBudget(blocks, (b) => b.content.length, {
    maxChars: CHUNK_MAX_CHARS,
    overlapItems: CHUNK_OVERLAP_MESSAGES,
  });

  return groups.map((group, chunkOrdinal) => {
    const content = group.map((b) => b.content).join('\n\n');
    const normalizedContent = normalizeForSearch(
      group.map((b) => b.lexicalContent).join('\n\n'),
    );
    const [first] = group;
    const last = group.at(-1);
    if (first === undefined || last === undefined) {
      throw new Error('chunkByCharBudget emitted an empty group');
    }
    return {
      chunkOrdinal,
      firstMessageId: first.messageId,
      lastMessageId: last.messageId,
      firstMessageAt: first.createdAt,
      lastMessageAt: last.createdAt,
      firstMessageTextOffset: first.startOffset,
      lastMessageTextOffsetExclusive: last.endOffsetExclusive,
      content,
      normalizedContent,
      contentHash: chunkContentHash({
        chunkerVersion: CHUNKER_VERSION,
        content,
        normalizedContent,
        firstMessageId: first.messageId,
        lastMessageId: last.messageId,
        firstMessageTextOffset: first.startOffset,
        lastMessageTextOffsetExclusive: last.endOffsetExclusive,
      }),
    };
  });
}
