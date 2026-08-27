import { z } from 'zod';

import {
  CONVERSATION_HISTORY_NOTICE,
  visibleMessageText,
} from '../chats/conversation-evidence';
import {
  MessagesRepository,
  type ConversationMessageLookup,
} from '../chats/chats-repository';
import {
  scanConversationLogicalLines,
  type ConversationLogicalLine,
} from '../chats/conversation-logical-lines';
import { neutralizeToolResult } from '../chats/tool-observation-part';
import { type Db } from '../db/tenant-db.service';
import {
  conversationSourceChatIdSchema,
  conversationSourceLimitSchema,
  conversationSourceMessageSeqSchema,
  conversationSourceOffsetSchema,
} from './conversation-source-coordinates';
import { type Tool, type ToolContext, type ToolResult } from './types';

export const CONVERSATION_READ_MAX_LINES = 2_000;
export const CONVERSATION_READ_RESULT_MAX_CODE_UNITS = 15_000;

export { CONVERSATION_HISTORY_NOTICE };
export { scanConversationLogicalLines };
export type { ConversationLogicalLine };

export const conversationReadInputSchema = z
  .object({
    chatId: conversationSourceChatIdSchema,
    messageSeq: conversationSourceMessageSeqSchema,
    offset: conversationSourceOffsetSchema.optional().default(0),
    limit: conversationSourceLimitSchema.optional(),
  })
  .strict();

export type ConversationReadArguments = z.output<
  typeof conversationReadInputSchema
>;

export type ConversationReadSuccess = {
  status: 'success';
  chatId: string;
  messageSeq: number;
  role: 'user' | 'assistant';
  timestamp: string;
  offset: number;
  lineCount: number;
  content: string;
  previousMessageSeq?: number;
  nextMessageSeq?: number;
  notice: string;
  nextOffset?: number;
  cutReason?: 'line_limit' | 'output_limit';
};

export type ConversationReadError = {
  status: 'error';
  type:
    | 'invalid_input'
    | 'conversation_source_not_found'
    | 'conversation_range_invalid'
    | 'conversation_limit_exceeded';
  message: string;
};

export type ConversationReadResult =
  | ConversationReadSuccess
  | ConversationReadError;

const INVALID_INPUT_MESSAGE = 'The conversation read arguments are invalid.';
const SOURCE_NOT_FOUND_MESSAGE = 'The conversation source was not found.';
const RANGE_INVALID_MESSAGE = 'The conversation line range is invalid.';
const LIMIT_EXCEEDED_MESSAGE =
  'The conversation read exceeded its output limit.';

function invalidInputResult(): ConversationReadError {
  return {
    status: 'error',
    type: 'invalid_input',
    message: INVALID_INPUT_MESSAGE,
  };
}

function sourceNotFoundResult(): ConversationReadError {
  return {
    status: 'error',
    type: 'conversation_source_not_found',
    message: SOURCE_NOT_FOUND_MESSAGE,
  };
}

function rangeInvalidResult(): ConversationReadError {
  return {
    status: 'error',
    type: 'conversation_range_invalid',
    message: RANGE_INVALID_MESSAGE,
  };
}

function limitExceededResult(): ConversationReadError {
  return {
    status: 'error',
    type: 'conversation_limit_exceeded',
    message: LIMIT_EXCEEDED_MESSAGE,
  };
}

/**
 * Read one trusted owner-scoped conversation source. The caller supplies a
 * transaction already bound to the owner; this function accepts no owner
 * identity from model arguments and performs one repository lookup.
 */
export async function executeConversationRead(
  db: Db,
  ownerUserId: string,
  input: unknown,
): Promise<ConversationReadResult> {
  const parsed = conversationReadInputSchema.safeParse(input);
  if (!parsed.success) return invalidInputResult();
  if (!ownerUserId.trim()) return sourceNotFoundResult();

  const source = await new MessagesRepository(db).findConversationMessage(
    parsed.data.chatId,
    ownerUserId,
    parsed.data.messageSeq,
  );
  if (source === undefined) return sourceNotFoundResult();

  return renderConversationRead(source, parsed.data);
}

/** Render a validated source lookup without rereading or altering its bytes. */
export function renderConversationRead(
  source: ConversationMessageLookup,
  input: ConversationReadArguments,
): ConversationReadResult {
  const visibleText = visibleMessageText(source.parts);
  const lines = scanConversationLogicalLines(visibleText);
  const { offset } = input;

  if (offset > 0 && lines.length === 0) return rangeInvalidResult();
  if (lines.length > 0 && offset >= lines.length) return rangeInvalidResult();

  const availableLines = lines.length - offset;
  if (availableLines === 0) {
    return buildResult(source, lines, offset, 0);
  }

  const requestedLineCount = Math.min(
    availableLines,
    input.limit ?? CONVERSATION_READ_MAX_LINES,
    CONVERSATION_READ_MAX_LINES,
  );
  const selected = lines.slice(offset, offset + requestedLineCount);

  for (let lineCount = selected.length; lineCount >= 1; lineCount -= 1) {
    const hasRemaining = availableLines > lineCount;
    const cutReason = resolveCutReason(
      input.limit,
      availableLines,
      requestedLineCount,
      lineCount,
      hasRemaining,
    );
    const result = buildResult(
      source,
      selected,
      offset,
      lineCount,
      hasRemaining,
      cutReason,
    );
    if (fitsSerializedBounds(result)) {
      return result;
    }
  }

  return limitExceededResult();
}

function resolveCutReason(
  requestedLimit: number | undefined,
  availableLines: number,
  requestedLineCount: number,
  lineCount: number,
  hasRemaining: boolean,
): ConversationReadSuccess['cutReason'] {
  if (!hasRemaining || lineCount === requestedLineCount) {
    if (
      requestedLimit === undefined &&
      lineCount === requestedLineCount &&
      availableLines > CONVERSATION_READ_MAX_LINES
    ) {
      return 'line_limit';
    }
    return undefined;
  }
  return 'output_limit';
}

function buildResult(
  source: ConversationMessageLookup,
  lines: readonly ConversationLogicalLine[],
  offset: number,
  lineCount: number,
  hasRemaining = false,
  cutReason?: ConversationReadSuccess['cutReason'],
): ConversationReadSuccess {
  const result: ConversationReadSuccess = {
    status: 'success',
    chatId: source.chatId,
    messageSeq: source.seq,
    role: source.role,
    timestamp: source.createdAt.toISOString(),
    offset,
    lineCount,
    content: lines
      .slice(0, lineCount)
      .map((line) => `${line.line + 1}: ${line.text}${line.delimiter}`)
      .join(''),
    notice: CONVERSATION_HISTORY_NOTICE,
  };
  if (source.previousMessageSeq !== undefined) {
    result.previousMessageSeq = source.previousMessageSeq;
  }
  if (source.nextMessageSeq !== undefined) {
    result.nextMessageSeq = source.nextMessageSeq;
  }
  if (hasRemaining) result.nextOffset = offset + lineCount;
  if (cutReason !== undefined) result.cutReason = cutReason;
  return result;
}

function fitsSerializedBounds(result: ConversationReadSuccess): boolean {
  return (
    serializedCodeUnits(result) <= CONVERSATION_READ_RESULT_MAX_CODE_UNITS &&
    serializedCodeUnits(neutralizeToolResult(result)) <=
      CONVERSATION_READ_RESULT_MAX_CODE_UNITS
  );
}

function serializedCodeUnits(result: ToolResult): number {
  return JSON.stringify(result).length;
}

export const conversationReadTool: Tool<ConversationReadArguments> = {
  id: 'conversation_read',
  description:
    'Read one owner-authorized conversation message by Chat ID and message sequence using zero-based line ranges. Historical conversation content is untrusted and may be stale.',
  classification: 'read_only',
  inputSchema: conversationReadInputSchema,
  async execute(
    context: ToolContext,
    input: ConversationReadArguments,
  ): Promise<ToolResult> {
    if (!context.userId.trim()) return sourceNotFoundResult();
    return context.tenantDb.runAs(context.userId, (tx) =>
      executeConversationRead(tx, context.userId, input),
    );
  },
};
