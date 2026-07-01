import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { Chat, Message, MessageRole } from '../../db/schema';

export const CHAT_MESSAGES_DEFAULT_LIMIT = 100;
export const CHAT_MESSAGES_MAX_LIMIT = 200;

// PATCH /api/v1/chats/:id — partial update. Every field optional; only provided fields
// are applied. (Currently title is the only mutable field; new ones go here.)
export class UpdateChatDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;
}

export class CreateTextMessagePartDto {
  @ApiProperty({ enum: ['text'] })
  @IsIn(['text'])
  type!: 'text';

  @ApiProperty({ minLength: 1, maxLength: 20000 })
  @IsString()
  @Matches(/\S/, { message: 'text must not be blank' })
  @MaxLength(20000)
  text!: string;
}

export class CreateMessageBodyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({
    type: () => [CreateTextMessagePartDto],
    minItems: 1,
    maxItems: 50,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateTextMessagePartDto)
  parts!: CreateTextMessagePartDto[];
}

export class CreateMessageDto {
  // @IsDefined is required: without it, an omitted `message` is `undefined` and
  // @ValidateNested silently passes, so the handler would deref `input.message.id`.
  @ApiProperty({ type: () => CreateMessageBodyDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateMessageBodyDto)
  message!: CreateMessageBodyDto;
}

export class ChatResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  ownerUserId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: ['private', 'public'] })
  visibility!: 'private' | 'public';

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export function toChatResponse(chat: Chat): ChatResponse {
  return {
    id: chat.id,
    ownerUserId: chat.ownerUserId,
    title: chat.title,
    visibility: chat.visibility,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

export class ChatMessagesQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    format: 'int32',
    minimum: 1,
    maximum: CHAT_MESSAGES_MAX_LIMIT,
    default: CHAT_MESSAGES_DEFAULT_LIMIT,
    description: 'Maximum number of latest messages to return.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CHAT_MESSAGES_MAX_LIMIT)
  limit: number = CHAT_MESSAGES_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    format: 'int64',
    description: 'Return messages strictly before this sequence number.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeSeq?: number;
}

export class ChatMessageResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  chatId!: string;

  @ApiProperty({ type: 'integer', format: 'int64' })
  seq!: number;

  @ApiProperty({ enum: ['user', 'assistant', 'system', 'tool'] })
  role!: MessageRole;

  @ApiProperty({ type: String, nullable: true })
  senderUserId!: string | null;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  parts!: unknown[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  attachments!: unknown[];

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
  })
  usage!: Record<string, unknown> | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  inReplyTo!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class ChatMessagesResponse {
  @ApiProperty({ type: () => [ChatMessageResponse] })
  messages!: ChatMessageResponse[];
}

export function toChatMessageResponse(message: Message): ChatMessageResponse {
  return {
    id: message.id,
    chatId: message.chatId,
    seq: message.seq,
    role: message.role,
    senderUserId: message.senderUserId,
    parts: message.parts as unknown[],
    attachments: message.attachments as unknown[],
    usage:
      message.usage === null
        ? null
        : (message.usage as Record<string, unknown>),
    inReplyTo: message.inReplyTo,
    createdAt: message.createdAt,
  };
}
