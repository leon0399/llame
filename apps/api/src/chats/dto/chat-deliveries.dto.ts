import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import {
  chatDeliveryModes,
  chatDeliveryStates,
  chatJobStates,
  type ChatDeliveryProducer,
  type ChatJobState,
  type ChatDeliveryMode,
  type ChatDeliveryState,
} from '../../db/schema';
import { formatJobLocator } from '../../jobs/job-locator';
import { type ChatDeliveryView } from '../chat-deliveries.repository';
import {
  PERMISSION_MODES,
  type PermissionMode,
} from '../../tools/permissions/permission-mode';
import { withoutProviderMetadata } from '../provider-metadata-egress';
import { withoutRetainedMedia } from '../retained-media-egress';

/**
 * The delivery modes a send may name.
 */
export const SENDABLE_DELIVERY_MODES = ['queue', 'steer', 'interrupt'] as const;

export type SendableDeliveryMode = (typeof SENDABLE_DELIVERY_MODES)[number];

/** The modes a `PATCH` may set: a change to `queue` is never allowed. */
export const CHANGEABLE_DELIVERY_MODES = ['steer', 'interrupt'] as const;

export type ChangeableDeliveryMode = (typeof CHANGEABLE_DELIVERY_MODES)[number];

export class ChangeChatDeliveryDto {
  @ApiProperty({
    enum: CHANGEABLE_DELIVERY_MODES,
    description:
      'The new mode of a pending item. `steer` delivers it at the next step ' +
      'boundary of the live Run; `interrupt` stops the step in flight and ' +
      'delivers it. Either starts a Run for it when the Chat has none.',
  })
  @IsIn(CHANGEABLE_DELIVERY_MODES)
  mode!: ChangeableDeliveryMode;
}

export class ChatDeliveryResponse {
  @ApiProperty({
    format: 'uuid',
    description: 'The delivery id; also the client message id for owner items.',
  })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  chatId!: string;

  @ApiProperty({ enum: ['owner', 'job'] })
  producer!: ChatDeliveryProducer;

  @ApiPropertyOptional({ description: 'The job locator of a notice.' })
  job?: string;

  @ApiPropertyOptional({ enum: chatJobStates })
  jobState?: ChatJobState;

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

export function toChatDeliveryResponse({
  item,
  job,
}: ChatDeliveryView): ChatDeliveryResponse {
  return {
    id: item.id,
    chatId: item.chatId,
    producer: item.producer,
    ...(job && {
      job: formatJobLocator(job.executor, job.seq),
      jobState: job.state,
    }),
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
