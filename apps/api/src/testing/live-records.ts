/**
 * Typed record fixtures for live-update tests: the API's response DTOs as
 * the record loader returns them (`Date` fields), so tests exercise the same
 * serialization the hub applies before validating against asyncapi.websocket.yaml.
 */

import type { ChatListItemResponse } from '../chats/dto/chats.dto';
import type { MachineResponse } from '../machines/dto/machines.dto';
import type {
  ChatPinnedItemResponse,
  ProjectPinnedItemResponse,
} from '../pins/dto/pins.dto';
import type { ProjectResponse } from '../projects/dto/projects.dto';
import type { RunResponse } from '../runs/dto/runs.dto';

export const LIVE_OWNER = 'user-a';
export const LIVE_CHAT_ID = '11111111-1111-4111-8111-111111111111';
export const LIVE_RUN_ID = '22222222-2222-4222-8222-222222222222';
export const LIVE_PROJECT_ID = '33333333-3333-4333-8333-333333333333';
export const LIVE_MACHINE_NAME = 'devl';

const at = new Date('2026-10-16T12:00:00.000Z');

export function liveChatRecord(
  overrides: Partial<ChatListItemResponse> = {},
): ChatListItemResponse {
  return {
    id: LIVE_CHAT_ID,
    ownerUserId: LIVE_OWNER,
    title: 'Live chat',
    visibility: 'private',
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    projectId: null,
    workspaceRoot: null,
    lastMessage: 'hello',
    ...overrides,
  };
}

export function liveProjectRecord(
  overrides: Partial<ProjectResponse> = {},
): ProjectResponse {
  return {
    id: LIVE_PROJECT_ID,
    ownerUserId: LIVE_OWNER,
    name: 'Live project',
    description: null,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    ...overrides,
  };
}

export function liveRunRecord(
  overrides: Partial<RunResponse> = {},
): RunResponse {
  return {
    id: LIVE_RUN_ID,
    chatId: LIVE_CHAT_ID,
    messageId: null,
    modelId: 'system:openai:gpt-5.4-mini',
    permissionMode: 'default',
    status: 'running_model',
    error: null,
    createdAt: at,
    startedAt: at,
    finishedAt: null,
    ...overrides,
  };
}

/** The Machine as `GET /api/v1/machines` lists it, serialized-ready. */
export function liveMachineRecord(
  overrides: Partial<MachineResponse> = {},
): MachineResponse {
  return {
    name: LIVE_MACHINE_NAME,
    status: 'online',
    lastSeenAt: '2026-10-16T12:00:00.000Z',
    failureReason: null,
    hubProtocolVersion: 1,
    daemonProtocolVersion: 1,
    daemonVersion: '0.4.0',
    roots: ['/srv/projects'],
    ...overrides,
  };
}

export function livePinRecords(): Array<
  ChatPinnedItemResponse | ProjectPinnedItemResponse
> {
  return [
    {
      itemType: 'chat',
      itemId: LIVE_CHAT_ID,
      pinnedAt: at,
      item: { id: LIVE_CHAT_ID, title: 'Live chat', archivedAt: null },
    },
    {
      itemType: 'project',
      itemId: LIVE_PROJECT_ID,
      pinnedAt: at,
      item: { id: LIVE_PROJECT_ID, name: 'Live project', archivedAt: null },
    },
  ];
}
