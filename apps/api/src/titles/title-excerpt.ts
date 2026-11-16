import { isRecord, isString } from '@workspace/runtime-safety';
import { type Message } from '../db/schema';
import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { fileAttachmentLines } from '../media/media-descriptors';

const EXCERPT_MAX = 1000;

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

  return sanitizeAuthoredText(`${role}: ${lines.join('\n')}`);
}

/** Renders the newest-first rows returned by MessagesRepository for the title prompt. */
export function buildTitleExcerpt(newestFirst: ReadonlyArray<Message>): string {
  const groups: Array<string> = [];
  let length = 0;

  for (const row of newestFirst) {
    if (
      row.role !== 'assistant' &&
      (row.role !== 'user' || row.senderUserId === null)
    ) {
      continue;
    }

    const group = rowText(row);
    const separatorLength = groups.length === 0 ? 0 : 1;
    const remaining = EXCERPT_MAX - length - separatorLength;

    if (remaining <= 0) break;
    groups.push(group.slice(0, remaining));
    length += separatorLength + Math.min(group.length, remaining);

    if (group.length > remaining) break;
  }

  return groups.reverse().join('\n');
}
