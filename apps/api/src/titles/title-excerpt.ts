import { isRecord, isString } from '@workspace/runtime-safety';
import { type Message } from '../db/schema';
import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { fileAttachmentLines } from '../media/media-descriptors';
import { renderTitleExcerpt, TITLE_INPUT_MAX_CHARS } from './title';

function rowLines(message: Message): Array<string> {
  const parts: Array<string> = [];

  for (const part of message.parts) {
    if (!isRecord(part)) continue;

    if (part.type === 'text' && isString(part.text)) {
      parts.push(part.text);
    } else if (part.type === 'file') {
      parts.push(...fileAttachmentLines([part]));
    }
  }

  return sanitizeAuthoredText(
    parts.join('\n').replaceAll(/<(\/?user)\b/gi, '&lt;$1'),
  ).split('\n');
}

/** Renders the newest-first rows returned by MessagesRepository for the title prompt. */
export function buildTitleExcerpt(newestFirst: ReadonlyArray<Message>): string {
  const rows: Array<{ user: boolean; lines: Array<string> }> = [];

  for (const message of newestFirst) {
    rows.push({
      user: message.role === 'user',
      lines: rowLines(message),
    });
  }

  return renderBoundedTitleExcerpt(rows);
}

function renderBoundedTitleExcerpt(
  newestFirst: Array<{ user: boolean; lines: Array<string> }>,
): string {
  const accepted: Array<{ user: boolean; lines: Array<string> }> = [];

  for (const row of newestFirst) {
    const candidate = [row, ...accepted];

    if (renderTitleExcerpt(candidate).length <= TITLE_INPUT_MAX_CHARS) {
      accepted.unshift(row);
      continue;
    }

    let low = 0;
    let high = row.lines.join('\n').length;

    while (low < high) {
      const middle = Math.ceil((low + high) / 2);

      const partial = {
        ...row,
        lines: safePrefix(row.lines.join('\n'), middle).split('\n'),
      };

      if (
        renderTitleExcerpt([partial, ...accepted]).length <=
        TITLE_INPUT_MAX_CHARS
      ) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    const partial = {
      ...row,
      lines: safePrefix(row.lines.join('\n'), low).split('\n'),
    };

    if (
      renderTitleExcerpt([partial, ...accepted]).length <= TITLE_INPUT_MAX_CHARS
    ) {
      accepted.unshift(partial);
    }

    break;
  }

  return renderTitleExcerpt(accepted);
}

function safePrefix(value: string, maxLength: number): string {
  let end = Math.min(value.length, maxLength);
  const last = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);

  if (
    last >= 0xd8_00 &&
    last <= 0xdb_ff &&
    next >= 0xdc_00 &&
    next <= 0xdf_ff
  ) {
    end -= 1;
  }

  return value.slice(0, end);
}
