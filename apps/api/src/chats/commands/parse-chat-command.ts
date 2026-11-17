import type { ChatDelivery } from '../../db/schema';

import { BadRequestException } from '@nestjs/common';
import { isRecord, isString } from '@workspace/runtime-safety';

export type ChatCommand =
  | { name: 'rename'; argument: string }
  | { name: 'compact'; argument: string };

export function parseChatCommand(
  parts: ReadonlyArray<unknown>,
): ChatCommand | null {
  const textParts = parts.flatMap((part) =>
    isRecord(part) && part['type'] === 'text' && isString(part['text'])
      ? [part['text']]
      : [],
  );

  if (textParts.length !== 1) return null;

  const text = textParts[0];

  if (!text.startsWith('/')) return null;

  const separator = text.search(/\s/);
  const name = text.slice(1, separator === -1 ? undefined : separator);

  if (name !== 'rename' && name !== 'compact') return null;

  return {
    name,
    argument: (separator === -1 ? '' : text.slice(separator)).trim(),
  };
}

export function compactCommandOf(
  item: Pick<ChatDelivery, 'producer' | 'parts'>,
): Extract<ChatCommand, { name: 'compact' }> | undefined {
  const command =
    item.producer === 'owner' ? parseChatCommand(item.parts) : null;

  return command?.name === 'compact' ? command : undefined;
}

export function isCompactCommand(
  item: Pick<ChatDelivery, 'producer' | 'parts'>,
): boolean {
  return compactCommandOf(item) !== undefined;
}

export function validateCompactCommand(
  parts: ReadonlyArray<unknown>,
  argument: string,
): string | null {
  if (parts.some((part) => isRecord(part) && part['type'] === 'file')) {
    throw new BadRequestException('A command cannot include an attachment.');
  }

  if (Array.from(argument).length > 1000) {
    throw new BadRequestException(
      'Compact focus must be 1,000 characters or fewer.',
    );
  }

  return argument.length === 0 ? null : argument;
}
