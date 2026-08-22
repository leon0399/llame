import { randomUUID } from "node:crypto";

import { messageBatch } from "@workspace/federation-experiment";

import type { SqlitePersonalRealmStore } from "./sqlite-replica.js";

export interface AppendLocalMessageOptions {
  readonly store: SqlitePersonalRealmStore;
  readonly writerStreamId: string;
  readonly writerEpoch: number;
  readonly chatId: string;
  readonly messageId?: string;
  readonly parentMessageId: string | null;
  readonly text: string;
}

export interface AppendLocalMessageResult {
  readonly messageId: string;
  readonly batchRef: string;
  readonly frontier: Readonly<Record<string, number>>;
}

export function appendLocalMessage(
  options: AppendLocalMessageOptions,
): AppendLocalMessageResult {
  const frontier = options.store.frontier();
  const sequence = (frontier[options.writerStreamId] ?? 0) + 1;
  const messageId = options.messageId ?? randomUUID();
  const dependencies = Object.entries(frontier)
    .filter(([, currentSequence]) => currentSequence > 0)
    .map(
      ([writerStreamId, currentSequence]) =>
        `${writerStreamId}:${currentSequence}`,
    )
    .sort();
  options.store.receive(
    messageBatch({
      realmId: options.store.realmId(),
      writerStreamId: options.writerStreamId,
      writerEpoch: options.writerEpoch,
      sequence,
      dependencies,
      chatId: options.chatId,
      messageId,
      parentMessageId: options.parentMessageId,
      text: options.text,
    }),
  );
  return {
    messageId,
    batchRef: `${options.writerStreamId}:${sequence}`,
    frontier: options.store.frontier(),
  };
}
