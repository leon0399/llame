import { z } from 'zod';
import { loadPackagedToolDescription } from '../prompts/tool-descriptions';

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
  fileMediaIds,
  filePlaceholder,
  loadMediaDescriptors,
  type MediaDescriptor,
} from '../media/media-descriptors';
import {
  conversationSourceChatIdSchema,
  conversationSourceLimitSchema,
  conversationSourceMessageSeqSchema,
  conversationSourceOffsetSchema,
} from './conversation-source-coordinates';
import { type Tool, type ToolContext, type ToolResult } from './types';

export const CONVERSATION_READ_MAX_LINES = 2000;
export const CONVERSATION_READ_RESULT_MAX_CODE_UNITS = 15_000;

export { CONVERSATION_HISTORY_NOTICE };
export { scanConversationLogicalLines };

export const conversationReadInputSchema = z.strictObject({
  chatId: conversationSourceChatIdSchema,
  messageSeq: conversationSourceMessageSeqSchema,
  offset: conversationSourceOffsetSchema.optional().default(0),
  limit: conversationSourceLimitSchema.optional(),
});

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
 * identity from model arguments and performs one repository lookup, plus one
 * owner-scoped media lookup when the message carries `file` parts.
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

  return renderConversationRead(
    source,
    parsed.data,
    await loadMediaDescriptors(db, ownerUserId, fileMediaIds(source.parts)),
  );
}

/**
 * Render a validated source lookup without rereading or altering its bytes.
 * `descriptors` holds the owner-resolved media of the message's `file` parts;
 * a part whose id is absent renders as unavailable.
 */
export function renderConversationRead(
  source: ConversationMessageLookup,
  input: ConversationReadArguments,
  descriptors: ReadonlyMap<string, MediaDescriptor> = new Map(),
): ConversationReadResult {
  const visibleText = visibleMessageText(source.parts);
  const lines = scanConversationLogicalLines(visibleText);
  // One LF-terminated placeholder line per `file` part, in stored order. These
  // lines sit outside the visible text: they are never line-numbered and count
  // toward no line coordinate or line bound, only the structured-result bound.
  const placeholders = fileMediaIds(source.parts)
    .map((id) => `${filePlaceholder(id, descriptors)}\n`)
    .join('');
  const { offset } = input;

  if (offset > 0 && lines.length === 0) return rangeInvalidResult();
  if (lines.length > 0 && offset >= lines.length) return rangeInvalidResult();

  const availableLines = lines.length - offset;
  if (availableLines === 0) {
    return buildResult({ source, offset }, lines, 0, { placeholders });
  }

  return findFittingConversationRead({
    source,
    lines,
    offset,
    availableLines,
    requestedLineCount: Math.min(
      availableLines,
      input.limit ?? CONVERSATION_READ_MAX_LINES,
      CONVERSATION_READ_MAX_LINES,
    ),
    requestedLimit: input.limit,
    placeholders,
  });
}

/** Fixed facts of one `renderConversationRead` call: what to render, from
 * where, and how much was asked for vs. is actually available. */
interface ConversationReadWindow {
  readonly source: ConversationMessageLookup;
  readonly lines: ReadonlyArray<ConversationLogicalLine>;
  readonly offset: number;
  readonly availableLines: number;
  readonly requestedLineCount: number;
  readonly requestedLimit: number | undefined;
  /** The message's LF-terminated placeholder lines; empty when it has none. */
  readonly placeholders: string;
}

/** Finds the largest line count (up to `window.requestedLineCount`) whose
 * rendered result fits the serialized-size bound, binary-searching down from
 * the full request when it doesn't fit outright. Every candidate is measured
 * with the placeholder lines appended, so their size is reserved before text
 * lines are fitted and the complete result that carries them always fits. */
function findFittingConversationRead(
  window: ConversationReadWindow,
): ConversationReadResult {
  const { source, offset, availableLines, requestedLineCount, placeholders } =
    window;
  const selected = window.lines.slice(offset, offset + requestedLineCount);

  const buildCandidate = (lineCount: number) => {
    const hasRemaining = availableLines > lineCount;
    const cutReason = resolveCutReason(window, lineCount, hasRemaining);
    const outcome = { hasRemaining, cutReason, placeholders };
    const result = buildResult(
      { source, offset },
      selected,
      lineCount,
      outcome,
    );
    const measured = hasRemaining
      ? {
          ...result,
          content: renderContent(selected.slice(0, lineCount), placeholders),
        }
      : result;
    return { result, fits: fitsSerializedBounds(measured) };
  };

  const fullCandidate = buildCandidate(requestedLineCount);
  if (fullCandidate.fits) return fullCandidate.result;

  const selectedCandidate = selectLargestConversationReadPrefix(
    requestedLineCount,
    buildCandidate,
  );
  if (selectedCandidate !== undefined) {
    return selectedCandidate;
  }

  return limitExceededResult();
}

/**
 * Select the largest fitting whole-line prefix after the complete request
 * failed the raw and neutralized result bounds. Candidate fit is monotonic:
 * every smaller candidate has the same metadata and less source content.
 */
export function selectLargestConversationReadPrefix(
  requestedLineCount: number,
  buildCandidate: (lineCount: number) => {
    result: ConversationReadSuccess;
    fits: boolean;
  },
): ConversationReadSuccess | undefined {
  let lower = 1;
  let upper = requestedLineCount - 1;
  let selected: ConversationReadSuccess | undefined;

  while (lower <= upper) {
    const lineCount = Math.floor((lower + upper) / 2);
    const candidate = buildCandidate(lineCount);
    if (candidate.fits) {
      selected = candidate.result;
      lower = lineCount + 1;
    } else {
      upper = lineCount - 1;
    }
  }

  return selected;
}

function resolveCutReason(
  window: Pick<
    ConversationReadWindow,
    'availableLines' | 'requestedLineCount' | 'requestedLimit'
  >,
  lineCount: number,
  hasRemaining: boolean,
): ConversationReadSuccess['cutReason'] {
  if (!hasRemaining || lineCount === window.requestedLineCount) {
    if (
      window.requestedLimit === undefined &&
      lineCount === window.requestedLineCount &&
      window.availableLines > CONVERSATION_READ_MAX_LINES
    ) {
      return 'line_limit';
    }
    return undefined;
  }
  return 'output_limit';
}

/**
 * The numbered source lines, then `placeholders` (when given) after one LF if
 * the last returned line has no delimiter.
 */
function renderContent(
  returned: ReadonlyArray<ConversationLogicalLine>,
  placeholders: string,
): string {
  const numbered = returned
    .map((line) => `${line.line + 1}: ${line.text}${line.delimiter}`)
    .join('');
  if (placeholders.length === 0) return numbered;
  const separator = returned.at(-1)?.delimiter === '' ? '\n' : '';
  return `${numbered}${separator}${placeholders}`;
}

/** `placeholders` end the content only of a result that omits `nextOffset`. */
function buildResult(
  position: { source: ConversationMessageLookup; offset: number },
  lines: ReadonlyArray<ConversationLogicalLine>,
  lineCount: number,
  outcome: {
    hasRemaining?: boolean;
    cutReason?: ConversationReadSuccess['cutReason'];
    placeholders: string;
  },
): ConversationReadSuccess {
  const { source, offset } = position;
  const { hasRemaining = false, cutReason, placeholders } = outcome;
  const carried = hasRemaining ? '' : placeholders;
  const result: ConversationReadSuccess = {
    status: 'success',
    chatId: source.chatId,
    messageSeq: source.seq,
    role: source.role,
    timestamp: source.createdAt.toISOString(),
    offset,
    lineCount,
    content: renderContent(lines.slice(0, lineCount), carried),
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
  description: loadPackagedToolDescription('conversation_read'),
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
