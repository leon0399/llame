import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { loadPackagedTemplate } from '../prompts/template-engine';

export type ChatRow = {
  chatId: string;
  locator: string;
  title: string | null;
  activityAt: string;
  messageCount: number;
  workspace: string;
  openingExcerpt?: string;
  latestExcerpt?: string;
};

const renderTemplate = loadPackagedTemplate<ChatRow>(__dirname, 'chat-row');

export function renderChatRow(row: ChatRow): string {
  return renderTemplate({
    ...row,
    title: sanitizeAuthoredText(
      (row.title ?? '(untitled)').replaceAll(SINGLE_LINE_BREAKERS, ' '),
    ),
    workspace: sanitizeAuthoredText(
      row.workspace.replaceAll(SINGLE_LINE_BREAKERS, ' '),
    ),
    openingExcerpt:
      row.openingExcerpt === undefined
        ? undefined
        : sanitizeAuthoredText(
            row.openingExcerpt.replaceAll(SINGLE_LINE_BREAKERS, ' '),
          ),
    latestExcerpt:
      row.latestExcerpt === undefined
        ? undefined
        : sanitizeAuthoredText(
            row.latestExcerpt.replaceAll(SINGLE_LINE_BREAKERS, ' '),
          ),
  });
}

export function formatChatExcerpt(
  value: string | null,
  maxCodePoints: number,
): string | undefined {
  if (value === null) return undefined;
  const collapsed = value.replaceAll(/\s+/gu, ' ').trim();
  let end = 0;

  for (
    let count = 0;
    count < maxCodePoints && end < collapsed.length;
    count += 1
  ) {
    const codePoint = collapsed.codePointAt(end);
    end += codePoint !== undefined && codePoint > 0xff_ff ? 2 : 1;
  }

  return end === 0 ? undefined : collapsed.slice(0, end);
}

const SINGLE_LINE_BREAKERS = /[\p{Cc}\u2028\u2029]/gu;
