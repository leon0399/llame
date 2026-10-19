/**
 * The hub against the published live protocol (`apps/api/asyncapi.websocket.yaml`):
 * every message type, built from the API's own response DTOs, must survive
 * the hub's serialization and validate against the generated wire schema,
 * and the generated record types must stay assignable from those DTOs once
 * serialized. This is the compatibility between `openapi.json` records and
 * the socket made checkable.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { ChatListItemResponse as ChatDto } from '../chats/dto/chats.dto';
import type { MachineResponse as MachineDto } from '../machines/dto/machines.dto';
import type { ProjectResponse as ProjectDto } from '../projects/dto/projects.dto';
import type { RunResponse as RunDto } from '../runs/dto/runs.dto';
import {
  LIVE_CHAT_ID,
  LIVE_OWNER,
  LIVE_PROJECT_ID,
  LIVE_RUN_ID,
  liveChatRecord,
  liveMachineRecord,
  livePinRecords,
  liveProjectRecord,
  liveRunRecord,
} from '../testing/live-records';
import { toWireMessage } from './change-hub.service';
import {
  type ChatListItemResponse as ChatWire,
  liveMessageSchema,
  type MachineResponse as MachineWire,
  type ProjectUpsertedMessage,
  type RunResponse as RunWire,
} from './generated/live-protocol';
import { RunProgressTracker, type ServerLiveMessage } from './live-messages';

const asyncApiMessagesSchema = z.object({
  components: z.object({
    messages: z.record(
      z.string(),
      z.object({
        name: z.string(),
        summary: z.string(),
        examples: z.array(z.object({ payload: z.unknown() })).min(1),
      }),
    ),
  }),
});

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
      owner: LIVE_OWNER,
      chat: LIVE_CHAT_ID,
      run: LIVE_RUN_ID,
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
      { type: 'machine.upserted', machine: liveMachineRecord() },
      { type: 'machine.deleted', name: 'devl' },
      {
        type: 'machine.upserted',
        machine: liveMachineRecord({
          status: 'offline',
          lastSeenAt: null,
          failureReason: 'unreachable',
          daemonProtocolVersion: null,
          daemonVersion: null,
          roots: [],
        }),
      },
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

  it('documents every message with a summary and examples that validate', () => {
    const document = asyncApiMessagesSchema.parse(
      parseYaml(
        readFileSync(
          path.resolve(__dirname, '../../asyncapi.websocket.yaml'),
          'utf8',
        ),
      ),
    );
    const invalid = Object.values(document.components.messages).flatMap(
      (message) =>
        message.examples.flatMap(({ payload }) => {
          const parsed = liveMessageSchema.safeParse(payload);
          return parsed.success && parsed.data.type === message.name
            ? []
            : [message.name];
        }),
    );
    expect(invalid).toEqual([]);
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
    // The project record is the pair a field change moves on both sides, so it
    // is pinned here too — the two cases above build their messages from the
    // `live-records` fixture, which would not notice a DTO/schema drift. Both
    // directions, because `extends` alone is one-way: the first catches a wire
    // field the DTO cannot supply, the second a DTO field the wire would drop.
    const projectCompatible: Serialized<ProjectDto> extends ProjectUpsertedMessage['project']
      ? true
      : false = true;
    const projectComplete: ProjectUpsertedMessage['project'] extends Serialized<ProjectDto>
      ? true
      : false = true;
    // A Machine is the only record the socket shares with every user; its
    // shape must match `GET /api/v1/machines` in both directions too.
    const machineCompatible: Serialized<MachineDto> extends MachineWire
      ? true
      : false = true;
    const machineComplete: MachineWire extends Serialized<MachineDto>
      ? true
      : false = true;
    expect([
      chatCompatible,
      runCompatible,
      projectCompatible,
      projectComplete,
      machineCompatible,
      machineComplete,
    ]).toEqual([true, true, true, true, true, true]);
  });
});
