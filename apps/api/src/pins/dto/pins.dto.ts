import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import type { PinnedRow } from '../pins-repository';

// The two pinnable item types. The value validated for the `:itemType` path
// param and the discriminator carried on the pin wrapper. Kept as a plain object
// so ParseEnumPipe can validate against it.
export const PIN_ITEM_TYPES = { chat: 'chat', project: 'project' } as const;

// Lean per-type reference cards — presentation-stable fields only (never the
// volatile lastMessage/status that stream), so the pins cache's staleness is
// bounded to explicit edits. A future pinnable type contributes its own card to
// the oneOf without touching the pin contract; custom project icon/color land
// on ProjectRefCard additively (YAGNI: not shipped now).
export class ChatRefCard {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  // NULL = untitled chat (#78); the client renders its own localized placeholder.
  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  // Archive state (chat-project-archive); null = not archived. Lets the rail
  // render an "Archived" indicator without a second fetch.
  @ApiProperty({ type: Date, format: 'date-time', nullable: true })
  archivedAt!: Date | null;
}

export class ProjectRefCard {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  // Archive state (chat-project-archive); null = not archived.
  @ApiProperty({ type: Date, format: 'date-time', nullable: true })
  archivedAt!: Date | null;
}

export class ChatPinnedItemResponse {
  @ApiProperty({ enum: [PIN_ITEM_TYPES.chat] })
  itemType!: 'chat';

  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty({ format: 'date-time' })
  pinnedAt!: Date;

  @ApiProperty({ type: ChatRefCard })
  item!: ChatRefCard;
}

export class ProjectPinnedItemResponse {
  @ApiProperty({ enum: [PIN_ITEM_TYPES.project] })
  itemType!: 'project';

  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty({ format: 'date-time' })
  pinnedAt!: Date;

  @ApiProperty({ type: ProjectRefCard })
  item!: ProjectRefCard;
}

export type PinnedItemResponse =
  | ChatPinnedItemResponse
  | ProjectPinnedItemResponse;

/** One entry in a full-list pin reorder body. */
export class ReorderPinsItemDto {
  @ApiProperty({ enum: Object.values(PIN_ITEM_TYPES) })
  @IsEnum(PIN_ITEM_TYPES)
  itemType!: 'chat' | 'project';

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;
}

/** Full replacement of the caller's pin order (exact set of current pins). */
export class ReorderPinsDto {
  @ApiProperty({ type: [ReorderPinsItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderPinsItemDto)
  @ArrayUnique((item: ReorderPinsItemDto) => `${item.itemType}:${item.itemId}`)
  items!: Array<ReorderPinsItemDto>;
}

export const PINNED_ITEM_RESPONSE_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(ChatPinnedItemResponse) },
    { $ref: getSchemaPath(ProjectPinnedItemResponse) },
  ],
  discriminator: {
    propertyName: 'itemType',
    mapping: {
      chat: getSchemaPath(ChatPinnedItemResponse),
      project: getSchemaPath(ProjectPinnedItemResponse),
    },
  },
};

export function toPinnedItemResponse(row: PinnedRow): PinnedItemResponse {
  if (row.itemType === 'chat') {
    return {
      itemType: row.itemType,
      itemId: row.itemId,
      pinnedAt: row.pinnedAt,
      item: { id: row.itemId, title: row.title, archivedAt: row.archivedAt },
    };
  }

  return {
    itemType: row.itemType,
    itemId: row.itemId,
    pinnedAt: row.pinnedAt,
    item: { id: row.itemId, name: row.name, archivedAt: row.archivedAt },
  };
}
