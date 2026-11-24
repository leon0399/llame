import { formatChatLocator } from '../chats/chat-locator';
import {
  scanConversationLogicalLines,
  type ConversationLogicalLine,
} from '../chats/conversation-logical-lines';
import {
  buildCanonicalSearchExcerpt,
  type CanonicalSearchPreviewPassage,
} from '../search/chat/canonical-search-excerpt';
import type { CanonicalSearchMessage } from '../search/chat/canonical-search-matcher';
import type { HybridSearchResult } from '../search/core';
import {
  conversationSourceCoordinatesSchema,
  type ConversationSourceCoordinates,
} from './conversation-source-coordinates';

export type SearchConversationsContentResult = {
  kind: 'content';
  chatId: string;
  locator: string;
  title: string | null;
  updatedAt: string;
  role: 'user' | 'assistant';
  timestamp: string;
  messageSeq: number;
  excerpt: string;
};

type SearchContentSource =
  | CanonicalSearchPreviewPassage
  | CanonicalSearchMessage;

const EXCERPT_MAX_CODE_POINTS = 500;

export function buildSearchConversationsContentResult(
  row: HybridSearchResult,
  source: SearchContentSource,
): SearchConversationsContentResult | null {
  const message = 'message' in source ? source.message : source;

  if ('message' in source) {
    const coordinates = parseCoordinates(
      row.id,
      message.messageSeq,
      source.offset,
      source.limit,
    );

    return coordinates
      ? renderContentResult(
          row,
          message,
          coordinates,
          buildCanonicalSearchExcerpt(source),
        )
      : null;
  }

  return buildVectorContentResult(row, source);
}

function buildVectorContentResult(
  row: HybridSearchResult,
  source: CanonicalSearchMessage,
): SearchConversationsContentResult | null {
  const lines = scanConversationLogicalLines(source.visibleText);
  const offset = lineIndexAtOffset(lines, source.sourceStart);

  const lastLine = lineIndexAtOffset(
    lines,
    Math.max(source.sourceEndExclusive - 1, source.sourceStart),
  );

  const limit = Math.max(1, Math.min(lastLine - offset + 1, 2000));

  const coordinates = parseCoordinates(
    row.id,
    source.messageSeq,
    offset,
    limit,
  );

  return coordinates
    ? renderContentResult(
        row,
        source,
        coordinates,
        truncatedExcerpt(
          source.visibleText.slice(
            source.sourceStart,
            source.sourceEndExclusive,
          ),
        ),
      )
    : null;
}

function parseCoordinates(
  chatId: string,
  messageSeq: number,
  offset: number,
  limit: number,
): ConversationSourceCoordinates | null {
  const parsed = conversationSourceCoordinatesSchema.safeParse({
    chatId,
    messageSeq,
    offset,
    limit,
  });

  return parsed.success ? parsed.data : null;
}

function renderContentResult(
  row: HybridSearchResult,
  message: Pick<CanonicalSearchMessage, 'messageSeq' | 'role' | 'timestamp'>,
  coordinates: ConversationSourceCoordinates,
  excerpt: string,
): SearchConversationsContentResult {
  return {
    kind: 'content',
    chatId: coordinates.chatId,
    locator: `${formatChatLocator(
      coordinates.chatId,
      coordinates.messageSeq,
    )}:L${coordinates.offset + 1}-${coordinates.offset + coordinates.limit}`,
    title: row.title,
    updatedAt: new Date(row.updatedAt).toISOString(),
    role: message.role,
    timestamp: message.timestamp.toISOString(),
    messageSeq: message.messageSeq,
    excerpt,
  };
}

function lineIndexAtOffset(
  lines: ReadonlyArray<ConversationLogicalLine>,
  charOffset: number,
): number {
  for (const line of lines) {
    if (charOffset < line.endOffsetExclusive + line.delimiter.length)
      return line.line;
  }

  return Math.max(lines.length - 1, 0);
}

function truncatedExcerpt(text: string): string {
  const codePoints = Array.from(text);

  return codePoints.length <= EXCERPT_MAX_CODE_POINTS
    ? text
    : `${codePoints.slice(0, EXCERPT_MAX_CODE_POINTS).join('')}…`;
}
