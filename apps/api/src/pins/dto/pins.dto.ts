import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import type { PinItemType } from '../../db/schema';
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
}

export class ProjectRefCard {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;
}

// A pinned item: pin metadata + the item's per-type card. `itemType` is the
// discriminator (on the wrapper, so the cards stay free of a `kind` field);
// `pinnedAt` is the type-agnostic ordering key. `item` is a oneOf of the cards.
@ApiExtraModels(ChatRefCard, ProjectRefCard)
export class PinnedItemResponse {
  @ApiProperty({ enum: Object.values(PIN_ITEM_TYPES) })
  itemType!: PinItemType;

  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty({ format: 'date-time' })
  pinnedAt!: Date;

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(ChatRefCard) },
      { $ref: getSchemaPath(ProjectRefCard) },
    ],
    description:
      'The item, shaped per itemType: a ChatRefCard for chat, a ProjectRefCard for project.',
  })
  item!: ChatRefCard | ProjectRefCard;
}

export function toPinnedItemResponse(row: PinnedRow): PinnedItemResponse {
  const item: ChatRefCard | ProjectRefCard =
    row.itemType === 'chat'
      ? { id: row.itemId, title: row.title }
      : { id: row.itemId, name: row.name };

  return {
    itemType: row.itemType,
    itemId: row.itemId,
    pinnedAt: row.pinnedAt,
    item,
  };
}
