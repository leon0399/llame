import { isRecord } from '@workspace/runtime-safety';

import { type Message } from '../db/schema';
import { parseMediaLocator } from '../media/media-locator';
import { type MediaDescriber } from '../media/media.service';
import { BadRequestException } from '@nestjs/common';
import { type ClientMessagePart } from './context-item';
import { type MessagePart } from './context-builder';
import { type RunUserMessage } from '../runs/run-execution.service';

/*
 * The message-part boundary of an accepted turn: the caller's parts are
 * untrusted until sanitized, and a stored message's `unknown[]` JSONB parts
 * are narrowed back to the model's own shape. Both directions live here so the
 * chat loop, which owns the turn, does not also own the projection.
 */

/**
 * Narrows a read-back message's `unknown[]` JSONB `parts` to `MessagePart[]`:
 * each part must be an object (the union's `Record<string, unknown>` fallback
 * arm), matching every other JSON-record boundary in this codebase. Malformed
 * (non-object) parts fail closed.
 */
export function toMessageParts(
  parts: ReadonlyArray<unknown>,
): Array<MessagePart> {
  return parts.map((part) => {
    if (!isRecord(part)) {
      throw new Error('Malformed message part: expected an object');
    }
    return part;
  });
}

/** Project a persisted user Message into the wire `RunUserMessage` shape. */
export function toRunUserMessage(message: Message): RunUserMessage {
  return {
    id: message.id,
    seq: message.seq,
    parts: toMessageParts(message.parts),
  };
}

/**
 * The sanitized parts with every file part resolved under the sender's own
 * identity and relabelled from the stored media (vision-media D5):
 * `mediaType` is the original's, `filename` its stored name, whatever the
 * client sent. Order is kept. Any file part whose url names no media the
 * sender owns rejects the whole message.
 */
export async function resolveOwnerFileParts(
  media: MediaDescriber,
  userId: string,
  parts: ReadonlyArray<ClientMessagePart>,
): Promise<Array<MessagePart>> {
  const ids = parts.flatMap((part) => {
    const id = part.type === 'file' ? parseMediaLocator(part.url) : undefined;
    return id === undefined ? [] : [id];
  });
  // Reads nothing when the message carries no file part.
  const owned = await media.describeOwned(userId, ids);
  return parts.map((part): MessagePart => {
    if (part.type === 'text') return part;
    const id = parseMediaLocator(part.url);
    const stored = id === undefined ? undefined : owned.get(id);
    if (stored === undefined) {
      // Unknown and foreign ids share this answer: a send never reveals an id.
      throw new BadRequestException('Message references unavailable media');
    }
    return {
      type: 'file',
      mediaType: stored.mediaType,
      url: part.url,
      filename: stored.name,
    };
  });
}
