import { isRecord, isString } from '@workspace/runtime-safety';
import { type Message } from '../db/schema';
import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { fileAttachmentLines } from '../media/media-descriptors';
import { TITLE_INPUT_MAX_CHARS } from './title';

function rowText(message: Message): string {
  const lines: Array<string> = [];

  for (const part of message.parts) {
    if (!isRecord(part)) continue;

    if (part.type === 'text' && isString(part.text)) {
      lines.push(part.text);
    } else if (part.type === 'file') {
      lines.push(...fileAttachmentLines([part]));
    }
  }

  const role = message.role === 'user' ? 'User' : 'Assistant';

  const authored = `${role}: ${lines.join('\n')}`
    .replaceAll('\n', '\n  ')
    .replaceAll(/<(\/?user)\b/gi, '&lt;$1');

  return sanitizeAuthoredText(authored);
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

/** Renders the newest-first rows returned by MessagesRepository for the title prompt. */
export function buildTitleExcerpt(newestFirst: ReadonlyArray<Message>): string {
  const groups: Array<string> = [];
  let length = 0;

  for (const row of newestFirst) {
    const group = rowText(row);
    const separatorLength = groups.length === 0 ? 0 : 1;
    const remaining = TITLE_INPUT_MAX_CHARS - length - separatorLength;

    if (remaining <= 0) break;
    groups.push(safePrefix(group, remaining));
    length += separatorLength + Math.min(group.length, remaining);

    if (group.length > remaining) break;
  }

  return groups.reverse().join('\n');
}
