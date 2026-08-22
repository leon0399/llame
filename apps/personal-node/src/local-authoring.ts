import { randomUUID } from "node:crypto";

import { messageBatch } from "@workspace/federation-experiment";
import { signChangeBatch } from "@workspace/federation-experiment/batch-signature";

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

export interface AppendSignedLocalMessageOptions
  extends AppendLocalMessageOptions {
  readonly privateKeyPem: string;
}

function buildLocalMessageBatch(options: AppendLocalMessageOptions) {
  const frontier = options.store.frontier();
  const sequence = (frontier[options.writerStreamId] ?? 0) + 1;
  const messageId = options.messageId ?? randomUUID();
  return {
    batch: messageBatch({
      realmId: options.store.realmId(),
      writerStreamId: options.writerStreamId,
      writerEpoch: options.writerEpoch,
      sequence,
      dependencies: Object.entries(frontier)
        .filter(([, currentSequence]) => currentSequence > 0)
        .map(
          ([writerStreamId, currentSequence]) =>
            `${writerStreamId}:${currentSequence}`,
        )
        .sort(),
      chatId: options.chatId,
      messageId,
      parentMessageId: options.parentMessageId,
      text: options.text,
    }),
    messageId,
    sequence,
  };
}

function authoringResult(
  options: AppendLocalMessageOptions,
  messageId: string,
  sequence: number,
): AppendLocalMessageResult {
  return {
    messageId,
    batchRef: `${options.writerStreamId}:${sequence}`,
    frontier: options.store.frontier(),
  };
}

export function appendLocalMessage(
  options: AppendLocalMessageOptions,
): AppendLocalMessageResult {
  const { batch, messageId, sequence } = buildLocalMessageBatch(options);
  options.store.receive(batch);
  return authoringResult(options, messageId, sequence);
}

export function appendSignedLocalMessage(
  options: AppendSignedLocalMessageOptions,
): AppendLocalMessageResult {
  const { batch, messageId, sequence } = buildLocalMessageBatch(options);
  options.store.receiveSigned(signChangeBatch(batch, options.privateKeyPem));
  return authoringResult(options, messageId, sequence);
}
