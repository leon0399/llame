import { MAX_RESULT_CODE_UNITS } from '@workspace/native-file-tools';
import { loadPackagedTemplate } from '../prompts/template-engine';
import {
  CONVERSATION_HISTORY_NOTICE,
  visibleMessageText,
} from '../chats/conversation-evidence';
import {
  ChatReadRepository,
  type ChatIndexRow,
} from '../chats/chat-read-repository';
import { formatChatLocator } from '../chats/chat-locator';
import { formatChatExcerpt } from '../chats/chat-row';
import { measureToolResultForModel } from './model-text';
import {
  error,
  parseMessageRequest,
  type MessageRequest,
} from './chat-read-utils';
import { type ToolResult } from './types';

const INDEX_PAGE = 50;

const INVALID_SELECTOR =
  'The Chat selector is invalid. Message sequence selectors must start with M.';

const RESULT_LIMIT = MAX_RESULT_CODE_UNITS;
const fits = measureToolResultForModel('read');

const renderIndexLine = loadPackagedTemplate<{
  seq: number;
  role: string;
  timestamp: string;
  locator: string;
  preview: string;
}>(__dirname, 'chat-index-row');

type IndexInput = {
  repository: ChatReadRepository;
  owner: string;
  chatId: string;
  path: string;
  selector?: string;
};

type IndexPage = {
  input: IndexInput;
  request: MessageRequest;
  latest: number;
  hasMore: boolean;
  runStatus: string;
  visibleRows: Array<ChatIndexRow>;
  previousRows: Array<{ seq: number }>;
  entries: Array<string>;
};

export async function readChatIndex(input: IndexInput): Promise<ToolResult> {
  let request: MessageRequest;

  try {
    request = parseMessageRequest(input.selector);
  } catch {
    return error('invalid_selector', INVALID_SELECTOR);
  }

  const page = await loadIndexPage(input, request);

  if (!page) return error('not_found', 'The Chat resource was not found.');

  return fitIndexPage(page);
}

async function loadIndexPage(
  input: IndexInput,
  request: MessageRequest,
): Promise<IndexPage | undefined> {
  const { repository, chatId, owner } = input;
  const latest = await repository.maxCommittedSequence(chatId, owner);
  const window = indexWindow(request, latest);
  const rows = await repository.listEligibleIndex(chatId, owner, window);
  const runStatus = await repository.currentRunStatus(chatId, owner);

  if (rows.length === 0 && !(await repository.ownsChat(chatId, owner)))
    return undefined;
  const keepsNewest = request.kind === 'default';
  const hasMore = rows.length > INDEX_PAGE;

  const visibleRows = keepsNewest
    ? rows.slice(-INDEX_PAGE)
    : rows.slice(0, INDEX_PAGE);

  const first = visibleRows[0];

  const previousRows =
    keepsNewest && hasMore && first
      ? await repository.previousEligibleSequences(
          chatId,
          owner,
          first.seq,
          INDEX_PAGE,
        )
      : [];

  return {
    input,
    request,
    latest,
    hasMore,
    runStatus,
    visibleRows,
    previousRows,
    entries: renderIndexRows(chatId, visibleRows),
  };
}

function indexWindow(request: MessageRequest, latest: number) {
  if (request.kind === 'range')
    return { start: request.start, end: request.end, limit: INDEX_PAGE + 1 };

  if (request.kind === 'forward')
    return { start: request.start, end: latest, limit: INDEX_PAGE + 1 };

  if (request.kind === 'tail')
    return {
      start: Math.max(1, latest - request.count + 1),
      end: latest,
      limit: INDEX_PAGE + 1,
    };

  return { beforeSeq: latest + 1, limit: INDEX_PAGE + 1 };
}

function fitIndexPage(page: IndexPage): ToolResult {
  const explicit = page.request.kind !== 'default';
  let start = 0;
  let end = page.visibleRows.length;

  while (start < end) {
    const visibleRows = page.visibleRows.slice(start, end);
    const entries = page.entries.slice(start, end);
    const result = createIndexResult(page, visibleRows, entries, explicit);

    if (fits(result) <= RESULT_LIMIT) return result;

    if (visibleRows.length === 1)
      return error(
        'representation_too_large',
        'A Chat index row exceeds the result limit.',
      );

    if (explicit) end -= 1;
    else start += 1;
  }

  return createIndexResult(page, [], [], explicit);
}

function createIndexResult(
  page: IndexPage,
  visibleRows: Array<ChatIndexRow>,
  entries: Array<string>,
  explicit: boolean,
): ToolResult {
  const { input } = page;
  const first = visibleRows[0];
  const last = visibleRows.at(-1);
  const earlierLocator = getEarlierLocator(page, first);

  return {
    status: 'success',
    kind: 'chat-index',
    path: input.path,
    content: entries.join('\n'),
    shownSeqRange:
      first && last ? { startSeq: first.seq, endSeq: last.seq } : null,
    runStatus: page.runStatus,
    chatId: input.chatId,
    notice: CONVERSATION_HISTORY_NOTICE,
    truncated: page.hasMore || visibleRows.length < page.visibleRows.length,
    earlierLocator,
    continuationLocator: getContinuationLocator(
      page,
      last,
      explicit,
      visibleRows.length,
    ),
  };
}

function renderIndexRows(
  chatId: string,
  rows: Array<ChatIndexRow>,
): Array<string> {
  return rows.map((row) =>
    renderIndexLine({
      seq: row.seq,
      role: row.role,
      timestamp: row.createdAt.toISOString(),
      locator: formatChatLocator(chatId, row.seq),
      preview: formatChatExcerpt(visibleMessageText(row.parts), 200) ?? '',
    }),
  );
}

function getEarlierLocator(
  page: IndexPage,
  first: ChatIndexRow | undefined,
): string | undefined {
  if (!first || page.request.kind !== 'default') return undefined;

  const priorRows = [
    ...page.previousRows.toReversed(),
    ...page.visibleRows.filter((row) => row.seq < first.seq),
  ].slice(-INDEX_PAGE);

  const earliest = priorRows[0]?.seq;

  return earliest === undefined
    ? undefined
    : `${formatChatLocator(page.input.chatId)}:M${earliest}-${first.seq - 1}`;
}

function getContinuationLocator(
  page: IndexPage,
  last: ChatIndexRow | undefined,
  explicit: boolean,
  visibleCount: number,
): string | undefined {
  if (
    !explicit ||
    !last ||
    !(page.hasMore || visibleCount < page.visibleRows.length)
  )
    return undefined;
  const end = page.request.kind === 'range' ? page.request.end : page.latest;

  return `${formatChatLocator(page.input.chatId)}:M${last.seq + 1}-${end}`;
}
