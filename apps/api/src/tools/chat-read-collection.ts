import {
  applySelectorSuffix,
  MAX_RESULT_CODE_UNITS,
} from '@workspace/native-file-tools';
import { placeListingSelector } from './listing-window';
import { loadPackagedTemplate } from '../prompts/template-engine';
import { CONVERSATION_HISTORY_NOTICE } from '../chats/conversation-evidence';
import {
  ChatReadRepository,
  type ChatReadRow,
} from '../chats/chat-read-repository';
import { renderChatRow } from '../chats/chat-row';
import { measureToolResultForModel } from './model-text';
import { error } from './chat-read-utils';
import { type ToolResult } from './types';

const COLLECTION_PAGE = 20;
const RESULT_LIMIT = MAX_RESULT_CODE_UNITS;
const INVALID_SELECTOR = 'The Chat selector is invalid.';
const fits = measureToolResultForModel('read');

const renderCollectionRow = loadPackagedTemplate<{
  row: string;
  runStatus: string;
}>(__dirname, 'chat-collection-row');

type CollectionPage = {
  offset: number;
  requestedEnd: number;
  total: number;
  selector: string | undefined;
  rows: Array<ChatReadRow>;
};

export async function readChatCollection(
  repository: ChatReadRepository,
  owner: string,
  selector?: string,
): Promise<ToolResult> {
  if (!validSelector(selector))
    return error('invalid_selector', INVALID_SELECTOR);
  const page = await readCollectionPage(repository, owner, selector);

  if (!page) return error('invalid_selector', INVALID_SELECTOR);
  const entries = renderCollectionEntries(page.rows);

  return fitCollectionPage(page, entries);
}

function validSelector(selector: string | undefined): boolean {
  if (selector === undefined) return true;

  try {
    const target = applySelectorSuffix('chat://', selector);

    return (
      !target.outline &&
      !target.raw &&
      target.ranges === undefined &&
      target.pending?.includes(',') !== true
    );
  } catch {
    return false;
  }
}

function getRequestedEnd(
  selector: string | undefined,
  window: { offset: number; limit?: number },
  knownTotal: number | undefined,
): number {
  if (selector === undefined) return knownTotal ?? Number.MAX_SAFE_INTEGER;
  const total = knownTotal ?? 0;

  return Math.min(
    total,
    window.offset + (window.limit ?? total - window.offset),
  );
}

async function readCollectionPage(
  repository: ChatReadRepository,
  owner: string,
  selector: string | undefined,
): Promise<CollectionPage | undefined> {
  const knownTotal =
    selector === undefined
      ? undefined
      : await repository.countOwnedChats(owner);

  const placed = placeListingSelector('chat://', selector, knownTotal ?? 0);

  if ('refusal' in placed) return undefined;
  const { offset } = placed.window;
  const requestedEnd = getRequestedEnd(selector, placed.window, knownTotal);

  const pageLimit = Math.min(
    placed.window.limit ?? COLLECTION_PAGE,
    COLLECTION_PAGE,
  );

  const data = await repository.readChatRows(owner, offset, pageLimit);

  return {
    offset,
    requestedEnd,
    total: knownTotal ?? data.total,
    selector,
    rows: data.rows.slice(0, pageLimit),
  };
}

function renderCollectionEntries(rows: Array<ChatReadRow>): Array<string> {
  return rows.map((row) =>
    renderCollectionRow({
      row: renderChatRow(row),
      runStatus: row.runStatus,
    }),
  );
}

function fitCollectionPage(
  page: CollectionPage,
  entries: Array<string>,
): ToolResult {
  for (
    let included = entries.length;
    included >= (page.rows.length ? 1 : 0);
    included -= 1
  ) {
    const result = collectionResult(page, entries, included);

    if (fits(result) <= RESULT_LIMIT) return result;

    if (included === 1)
      return error(
        'representation_too_large',
        'A Chat collection row exceeds the result limit.',
      );
  }

  return error(
    'representation_too_large',
    'The Chat collection exceeds the result limit.',
  );
}

function collectionResult(
  page: CollectionPage,
  entries: Array<string>,
  included: number,
): ToolResult {
  const shownEnd = page.offset + included;
  const moreRequested = shownEnd < Math.min(page.total, page.requestedEnd);

  return {
    status: 'success',
    kind: 'directory',
    path: 'chat://',
    content: entries.slice(0, included).join('\n'),
    entryCount: page.total,
    shownRange: included
      ? { startLine: page.offset + 1, endLine: shownEnd }
      : null,
    nextOffset: moreRequested ? shownEnd : undefined,
    requestedRange:
      page.selector === undefined
        ? undefined
        : { startLine: page.offset + 1, endLine: page.requestedEnd },
    notice: CONVERSATION_HISTORY_NOTICE,
    truncated: moreRequested,
  };
}
