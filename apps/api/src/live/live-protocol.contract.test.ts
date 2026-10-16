/**
 * The hub against the published live protocol (`apps/api/asyncapi.yaml`):
 * every message type, built from the API's own response DTOs, must survive
 * the hub's serialization and validate against the generated wire schema,
 * and the generated record types must stay assignable from those DTOs once
 * serialized. This is the compatibility between `openapi.json` records and
 * the socket made checkable.
 */

import type { ChatListItemResponse as ChatDto } from '../chats/dto/chats.dto';
import type { RunResponse as RunDto } from '../runs/dto/runs.dto';
import {
  LIVE_CHAT_ID,
  LIVE_OWNER,
  LIVE_PROJECT_ID,
  LIVE_RUN_ID,
  liveChatRecord,
  livePinRecords,
  liveProjectRecord,
  liveRunRecord,
} from '../testing/live-records';
import { toWireMessage } from './change-hub.service';
import type {
  ChatListItemResponse as ChatWire,
  RunResponse as RunWire,
} from './generated/live-protocol';
import { RunProgressTracker, type ServerLiveMessage } from './live-messages';

/** `T` with its `Date` fields as the ISO strings JSON produces. */
type Serialized<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K];
};

describe('live protocol contract', () => {
  it('describes every message the hub can send', () => {
    const tracker = new RunProgressTracker();
    const progress = tracker.apply({
      k: 'run_event',
      op: 'insert',
      owner: LIVE_OWNER,
      chat: LIVE_CHAT_ID,
      run: LIVE_RUN_ID,
      seq: 1,
      type: 'tool.started',
    });
    if (!progress) throw new Error('expected run progress');
    const messages: Array<ServerLiveMessage> = [
      { type: 'chat.upserted', chat: liveChatRecord() },
      {
        type: 'chat.upserted',
        chat: liveChatRecord({
          title: null,
          archivedAt: new Date(),
          projectId: LIVE_PROJECT_ID,
          workspaceRoot: '/srv/work',
          lastMessage: null,
        }),
      },
      { type: 'chat.deleted', chatId: LIVE_CHAT_ID },
      { type: 'project.upserted', project: liveProjectRecord() },
      { type: 'project.deleted', projectId: LIVE_PROJECT_ID },
      { type: 'pins.replaced', items: livePinRecords() },
      { type: 'pins.replaced', items: [] },
      { type: 'run.updated', run: liveRunRecord() },
      {
        type: 'run.updated',
        run: liveRunRecord({
          status: 'failed',
          effort: 'high',
          error: { code: 'model_stream_idle' },
          finishedAt: new Date(),
        }),
      },
      progress,
      { type: 'resync' },
    ];

    const rejected = messages.flatMap((message) =>
      toWireMessage(message) === undefined ? [message.type] : [],
    );
    expect(rejected).toEqual([]);
  });

  it('keeps the generated record types compatible with the serialized DTOs', () => {
    // A DTO serialized to JSON must be assignable to the generated wire type;
    // the run error is `unknown` server-side and an object or null on the wire.
    const chatCompatible: Serialized<ChatDto> extends ChatWire ? true : false =
      true;
    const runCompatible: Omit<Serialized<RunDto>, 'error'> extends Omit<
      RunWire,
      'error'
    >
      ? true
      : false = true;
    expect([chatCompatible, runCompatible]).toEqual([true, true]);
  });
});
