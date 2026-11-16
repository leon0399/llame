import { isRecord, isString } from '@workspace/runtime-safety';

type MessagePart = { type: 'text'; text: string } | { type: 'file' };

export type ChatCommand =
  | { name: 'rename'; argument: string }
  | { name: 'compact'; argument: string };

export function parseChatCommand(
  parts: ReadonlyArray<unknown>,
): ChatCommand | null {
  const normalized = parts.flatMap((part): Array<MessagePart> => {
    if (!isRecord(part)) return [];

    if (part['type'] === 'text' && isString(part['text'])) {
      return [{ type: 'text', text: part['text'] }];
    }

    return part['type'] === 'file' ? [{ type: 'file' }] : [];
  });

  const textParts = normalized.filter(
    (part): part is { type: 'text'; text: string } => part.type === 'text',
  );

  if (textParts.length !== 1) return null;

  const text = textParts[0].text;

  if (!text.startsWith('/')) return null;

  const separator = text.search(/\s/);
  const name = text.slice(1, separator === -1 ? undefined : separator);

  if (name !== 'rename' && name !== 'compact') return null;

  return {
    name,
    argument: (separator === -1 ? '' : text.slice(separator)).trim(),
  };
}
