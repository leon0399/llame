import {
  applySelectorSuffix,
  MAX_READ_LINES,
  MAX_RESULT_CODE_UNITS,
  resolveEndRelativeSelector,
  type ReadTarget,
} from '@workspace/native-file-tools';
import {
  CONVERSATION_HISTORY_NOTICE,
  visibleMessageText,
} from '../chats/conversation-evidence';
import {
  ChatReadRepository,
  type ChatReadMessage,
} from '../chats/chat-read-repository';
import {
  scanConversationLogicalLines,
  type ConversationLogicalLine,
} from '../chats/conversation-logical-lines';
import { fileAttachmentLines } from '../media/media-descriptors';
import { measureToolResultForModel } from './model-text';
import { error, nativeError } from './chat-read-utils';
import { type ToolResult } from './types';

const RESULT_LIMIT = MAX_RESULT_CODE_UNITS;
const LINE_LIMIT = MAX_READ_LINES;
const INVALID_SELECTOR = 'The Chat selector is invalid.';

const TOO_LARGE =
  'The first selected Chat message line exceeds the result limit.';

const fits = measureToolResultForModel('read');

type MessageInput = {
  repository: ChatReadRepository;
  owner: string;
  chatId: string;
  seq: number;
  path: string;
  selector?: string;
};

type MessageSelection = {
  resolved: ReadTarget;
  requestedRanges: Array<{ startLine: number; endLine: number }> | undefined;
  segments: Array<Array<ConversationLogicalLine>>;
  requestedLineCount: number;
};

export async function readChatMessage(
  input: MessageInput,
): Promise<ToolResult> {
  let target: ReadTarget;

  try {
    target = applySelectorSuffix(input.path, input.selector);
  } catch (error) {
    return nativeError(error, 'invalid_selector');
  }

  if (target.outline) return error('invalid_selector', INVALID_SELECTOR);

  const source = await input.repository.readMessage(
    input.chatId,
    input.owner,
    input.seq,
  );

  if (source === undefined)
    return error('not_found', 'The Chat resource was not found.');

  const status = await input.repository.currentRunStatus(
    input.chatId,
    input.owner,
  );

  const lines = scanConversationLogicalLines(visibleMessageText(source.parts));

  const placeholders = fileAttachmentLines(source.parts)
    .map((line) => `${line}\n`)
    .join('');

  const selection = selectMessageLines(target, input.selector, lines);

  if (!selection) return error('invalid_selector', INVALID_SELECTOR);

  return fitMessageResult({
    input,
    source,
    runStatus: status,
    lines,
    placeholders,
    selection,
  });
}

function selectMessageLines(
  target: ReadTarget,
  selector: string | undefined,
  lines: Array<ConversationLogicalLine>,
): MessageSelection | undefined {
  let resolved: ReadTarget;

  try {
    resolved = resolveEndRelativeSelector(target, lines.length);
  } catch {
    return undefined;
  }

  if (resolved.pending !== undefined) return undefined;

  const requestedRanges = requestedMessageRanges(
    resolved,
    selector,
    lines.length,
  );

  const windows = selectedMessageWindows(resolved, lines.length);

  if (!windows.valid) return undefined;

  const segments = windows.values.map(({ start, end }) =>
    lines.slice(start, Math.min(end + 1, lines.length)),
  );

  return {
    resolved,
    requestedRanges,
    segments,
    requestedLineCount: segments.reduce(
      (count, segment) => count + segment.length,
      0,
    ),
  };
}

function requestedMessageRanges(
  resolved: ReadTarget,
  selector: string | undefined,
  lineCount: number,
) {
  return (
    resolved.ranges?.map(({ offset, limit }) => ({
      startLine: offset + 1,
      endLine: offset + limit,
    })) ??
    (selector === undefined || (resolved.raw && resolved.limit === undefined)
      ? undefined
      : [
          {
            startLine: resolved.offset + 1,
            endLine:
              resolved.limit === undefined
                ? lineCount
                : resolved.offset + resolved.limit,
          },
        ])
  );
}

function selectedMessageWindows(resolved: ReadTarget, lineCount: number) {
  const values = resolved.ranges?.map(({ offset, limit }) => ({
    start: offset,
    end: offset + limit - 1,
  })) ?? [
    {
      start: resolved.offset,
      end:
        resolved.limit === undefined
          ? Math.max(0, lineCount - 1)
          : resolved.offset + resolved.limit - 1,
    },
  ];

  const valid = values.every(
    ({ start, end }) =>
      start >= 0 &&
      end >= start &&
      !(start >= lineCount && lineCount > 0) &&
      !(lineCount === 0 && start > 0),
  );

  return { valid, values };
}

type FitMessageInput = Omit<FitInput, 'allSelected'>;

function fitMessageResult({
  input,
  source,
  runStatus,
  lines,
  placeholders,
  selection,
}: FitMessageInput): ToolResult {
  const allSelected = selection.segments.flat();

  if (selection.requestedLineCount <= LINE_LIMIT) {
    const complete = renderMessageResult({
      input,
      source,
      runStatus,
      lines,
      placeholders,
      selection,
      selected: allSelected,
      isCut: false,
    });

    if (fits(complete) <= RESULT_LIMIT) return complete;
  }

  const fitting = findFittingMessage({
    input,
    source,
    runStatus,
    lines,
    placeholders,
    selection,
    allSelected,
  });

  return fitting ?? error('representation_too_large', TOO_LARGE);
}

type FitInput = {
  input: MessageInput;
  source: ChatReadMessage;
  runStatus: string;
  lines: Array<ConversationLogicalLine>;
  placeholders: string;
  selection: MessageSelection;
  allSelected: Array<ConversationLogicalLine>;
};

function findFittingMessage(data: FitInput): ToolResult | undefined {
  const lineLimit = Math.min(data.selection.requestedLineCount, LINE_LIMIT);
  let best: ToolResult | undefined;
  let low = data.selection.requestedLineCount > 0 ? 1 : 0;
  let high = lineLimit;

  while (low <= high) {
    const count = Math.floor((low + high) / 2);

    const candidate = renderMessageResult({
      ...data,
      selected: data.allSelected.slice(0, count),
      isCut: count < data.selection.requestedLineCount,
    });

    if (fits(candidate) <= RESULT_LIMIT) {
      best = candidate;
      low = count + 1;
    } else high = count - 1;
  }

  return best;
}

type RenderInput = {
  input: MessageInput;
  source: ChatReadMessage;
  runStatus: string;
  lines: Array<ConversationLogicalLine>;
  placeholders: string;
  selection: MessageSelection;
  selected: Array<ConversationLogicalLine>;
  isCut: boolean;
};

function renderMessageResult(data: RenderInput): ToolResult {
  const { input, source, runStatus, lines, selection, selected, isCut } = data;
  const shownRanges = getShownRanges(selected, selection.segments);
  const content = renderMessageContent(data);

  const result: ToolResult = {
    status: 'success',
    kind: 'file',
    path: input.path,
    representation: selection.resolved.raw ? 'raw' : 'text',
    content,
    lineCount: lines.length,
    shownRange:
      shownRanges.length === 1
        ? shownRanges[0]
        : lines.length === 0
          ? null
          : undefined,
    shownRanges: shownRanges.length > 1 ? shownRanges : undefined,
    requestedRange:
      selection.requestedRanges?.length === 1
        ? selection.requestedRanges[0]
        : undefined,
    requestedRanges:
      selection.requestedRanges && selection.requestedRanges.length > 1
        ? selection.requestedRanges
        : undefined,
    truncated: isCut,
    nextOffset: isCut ? (selected.at(-1)?.line ?? -1) + 1 : undefined,
    chatId: input.chatId,
    messageSeq: input.seq,
    role: source.role,
    timestamp: source.createdAt.toISOString(),
    runStatus,
    previousMessageSeq: source.previousMessageSeq,
    nextMessageSeq: source.nextMessageSeq,
    notice: CONVERSATION_HISTORY_NOTICE,
  };

  return result;
}

function renderMessageContent(data: RenderInput): string {
  const rendered = renderMessageLines(
    data.selected,
    data.selection.resolved.raw,
  );

  const reachesEnd =
    !data.isCut &&
    (data.selected.at(-1)?.line === data.lines.length - 1 ||
      (data.lines.length === 0 && data.selected.length === 0));

  const attachmentText =
    reachesEnd && data.placeholders.length
      ? `${rendered.endsWith('\n') || rendered.length === 0 ? '' : '\n'}${data.placeholders}`
      : '';

  return `${rendered}${attachmentText}`;
}

function renderMessageLines(
  selected: Array<ConversationLogicalLine>,
  raw: boolean,
): string {
  return selected
    .map((line) =>
      raw
        ? `${line.text}${line.delimiter}`
        : `${line.line + 1}: ${line.text}${line.delimiter}`,
    )
    .join('');
}

function getShownRanges(
  selected: Array<ConversationLogicalLine>,
  segments: Array<Array<ConversationLogicalLine>>,
): Array<{ startLine: number; endLine: number }> {
  const shownRanges: Array<{ startLine: number; endLine: number }> = [];

  for (const segment of segments) {
    const segmentStart = segment[0]?.line;
    const segmentEnd = segment.at(-1)?.line;

    if (segmentStart === undefined || segmentEnd === undefined) continue;

    const chosen = selected.filter(
      ({ line }) => line >= segmentStart && line <= segmentEnd,
    );

    const first = chosen[0];
    const last = chosen.at(-1);

    if (first && last)
      shownRanges.push({ startLine: first.line + 1, endLine: last.line + 1 });
  }

  return shownRanges;
}
