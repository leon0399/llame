import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import {
  chatDeliveryModes,
  chatDeliveryStates,
  type ChatDelivery,
  type ChatDeliveryMode,
  type ChatDeliveryState,
} from '../../db/schema';
import {
  PERMISSION_MODES,
  type PermissionMode,
} from '../../tools/permissions/permission-mode';
import { withoutProviderMetadata } from '../provider-metadata-egress';
import { withoutRetainedMedia } from '../retained-media-egress';

/**
 * The delivery modes a send may name. A layer that ships another mode adds it
 * here; the table and `ChatDeliveryResponse` already hold all three.
 */
export const SENDABLE_DELIVERY_MODES = ['queue'] as const;
export type SendableDeliveryMode = (typeof SENDABLE_DELIVERY_MODES)[number];

export class ChatDeliveryResponse {
  @ApiProperty({
    format: 'uuid',
    description: 'The client message id the item was sent with.',
  })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  chatId!: string;

  @ApiProperty({ enum: chatDeliveryModes })
  mode!: ChatDeliveryMode;

  @ApiProperty({ enum: chatDeliveryStates })
  state!: ChatDeliveryState;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  parts!: Array<unknown>;

  @ApiProperty()
  modelId!: string;

  @ApiPropertyOptional()
  effort?: string;

  @ApiProperty({ enum: PERMISSION_MODES })
  permissionMode!: PermissionMode;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class ChatDeliveriesResponse {
  @ApiProperty({
    type: () => [ChatDeliveryResponse],
    description: 'The pending items, first to deliver first.',
  })
  items!: Array<ChatDeliveryResponse>;
}

export function toChatDeliveryResponse(
  item: ChatDelivery,
): ChatDeliveryResponse {
  return {
    id: item.id,
    chatId: item.chatId,
    mode: item.mode,
    state: item.state,
    // The same egress as the history response: retained bytes and provider
    // metadata stay on the server.
    parts: withoutProviderMetadata(withoutRetainedMedia(item.parts)),
    modelId: item.settings.modelId,
    ...(item.settings.effort !== undefined && { effort: item.settings.effort }),
    permissionMode: item.settings.permissionMode,
    createdAt: item.createdAt,
  };
}
