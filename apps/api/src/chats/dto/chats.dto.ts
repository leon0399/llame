import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Chat, Compaction, Message, MessageRole } from '../../db/schema';
import { isTextPart } from '../context-builder';

export const CHAT_MESSAGES_DEFAULT_LIMIT = 100;
export const CHAT_MESSAGES_MAX_LIMIT = 200;
export const CHAT_MESSAGES_MAX_SAFE_SEQ = Number.MAX_SAFE_INTEGER;

const SAFE_INTEGER_QUERY_PATTERN = /^(0|[1-9]\d*)$/;

function parseSafeIntegerQueryValue(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value : Number.NaN;
  }

  if (typeof value !== 'string' || !SAFE_INTEGER_QUERY_PATTERN.test(value)) {
    return Number.NaN;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

// PATCH /api/v1/chats/:id — partial update. Every field optional; only provided fields
// are applied. (Currently title is the only mutable field; new ones go here.)
export class UpdateChatDto {
  // ValidateIf (not IsOptional): IsOptional also waves `null` through, and a
  // null title would un-title the chat (NULL = regenerate, #78). Only absence
  // skips validation; an explicit null must fail IsString.
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @ValidateIf((o: UpdateChatDto) => o.title !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    enum: ['private', 'public'],
    description:
      "Sharing: 'public' exposes a read-only link at /shared/:id; 'private' revokes it.",
  })
  @IsOptional()
  @IsIn(['private', 'public'])
  visibility?: 'private' | 'public';

  @ApiPropertyOptional({
    description:
      'Pin the chat to the top of the sidebar (true) or unpin (false).',
  })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
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

  /**
   * Selected model id (#76). Optional — omit to use the caller's default
   * (first provider account, else the instance model). Validated against the
   * caller's available set before provider invocation; an unavailable id is
   * rejected (422), never silently downgraded.
   */
  @ApiProperty({
    required: false,
    maxLength: 200,
    example: 'openai/gpt-5.4-mini',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;
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

/**
 * `POST /chats/:id/runs` body — regenerate the chat's last assistant turn.
 * Only the selected model rides along (like a send); the server targets the
 * last user turn (no client-named message id — "last turn only" is the scope).
 */
export class RegenerateRunDto {
  @ApiProperty({
    required: false,
    maxLength: 200,
    example: 'openai/gpt-5.4-mini',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;

  /**
   * Edit & resubmit (#edit): overwrite the last USER message with this text
   * BEFORE rewinding + re-running. Omit for a plain regenerate. Same 20k cap as
   * a sent text part; `MinLength(1)` rejects an empty edit (whitespace-only is
   * trimmed + rejected server-side too).
   */
  @ApiProperty({ required: false, minLength: 1, maxLength: 20000 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  @Matches(/\S/, { message: 'editUserMessage must not be blank' })
  editUserMessage?: string;

  /**
   * Pins an edit to the message the client rendered it on: the server 409s if
   * this is no longer the LAST user turn (a two-tab race must not silently
   * rewrite a different message). Only meaningful alongside `editUserMessage`.
   */
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  editMessageId?: string;
}

export class ChatResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  ownerUserId!: string;

  // NULL = untitled (#78): generation hasn't run yet (or produced nothing usable).
  // Clients render their own localized placeholder — the API never invents one.
  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ enum: ['private', 'public'] })
  visibility!: 'private' | 'public';

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pinnedAt!: Date | null;
}

export function toChatResponse(chat: Chat): ChatResponse {
  return {
    id: chat.id,
    ownerUserId: chat.ownerUserId,
    title: chat.title,
    visibility: chat.visibility,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    pinnedAt: chat.pinnedAt,
  };
}

export const LAST_MESSAGE_EXCERPT_MAX_LENGTH = 160;

// GET /api/v1/chats list items carry the latest-message preview; single-chat
// reads return the plain ChatResponse (fetch messages for content).
export class ChatListItemResponse extends ChatResponse {
  // Text-only excerpt of the latest message's parts, whitespace-collapsed and
  // truncated server-side — a list preview, never the full content. Empty
  // when the message has no text parts (e.g. tool-only turns). Null only for
  // a chat with no messages — unreachable today (chats are created by their
  // first message) but modeled explicitly.
  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: LAST_MESSAGE_EXCERPT_MAX_LENGTH,
  })
  lastMessage!: string | null;
}

/** Text parts only — non-text parts (tool calls, files, reasoning) are omitted. */
function partsToExcerpt(parts: unknown[]): string {
  const text = parts
    .map((part) => (isTextPart(part) ? part.text : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > LAST_MESSAGE_EXCERPT_MAX_LENGTH
    ? `${text.slice(0, LAST_MESSAGE_EXCERPT_MAX_LENGTH - 1)}…`
    : text;
}

export function toChatListItemResponse(
  chat: Chat,
  lastMessage: Message | undefined,
): ChatListItemResponse {
  return Object.assign(toChatResponse(chat), {
    lastMessage: lastMessage ? partsToExcerpt(lastMessage.parts) : null,
  });
}

/**
 * The chat's LATEST compaction (#57) — surfaced so the UI can mark where older
 * turns were folded into a summary for the model's context. `uptoSeq` is the
 * boundary: messages with `seq <= uptoSeq` are represented by the `summary`.
 * Exposes only display fields (no internal id/parentId/usage).
 */
/** `POST /chats/:id/fork` body — copy this chat up to `fromMessageId` into a new chat. */
export class ForkChatDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fromMessageId!: string;
}

export class CompactionResponse {
  @ApiProperty({
    type: 'integer',
    format: 'int64',
    description: 'Messages with seq <= this were summarized for model context.',
  })
  uptoSeq!: number;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export function toCompactionResponse(
  compaction: Compaction,
): CompactionResponse {
  return {
    uptoSeq: compaction.uptoSeq,
    summary: compaction.summary,
    createdAt: compaction.createdAt,
  };
}

/**
 * PUBLIC share view of a message. Deliberately MINIMAL: no `senderUserId`/
 * `seq`/`attachments`/telemetry (no identity leak), and `parts` is filtered to
 * TEXT only — reasoning is stripped (it can contain injected private context:
 * memories, custom instructions the model reasoned over).
 */
export class SharedChatMessageResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  parts!: unknown[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class SharedChatResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: () => [SharedChatMessageResponse] })
  messages!: SharedChatMessageResponse[];
}

export function toSharedChatResponse(
  chat: Chat,
  messages: Message[],
): SharedChatResponse {
  return {
    id: chat.id,
    // Untitled chats (title generation pending, #78) can still be shared —
    // fall back to a placeholder rather than leak `null` into a `string` field.
    title: chat.title ?? 'Untitled chat',
    messages: messages
      // Only the conversation (user + assistant) is public — never system/tool.
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        // TEXT-only allowlist: strips reasoning (privacy) + any non-display part.
        parts: (Array.isArray(m.parts) ? m.parts : []).filter(
          (p): p is { type: 'text'; text: string } =>
            typeof p === 'object' &&
            p !== null &&
            (p as { type?: unknown }).type === 'text',
        ),
        createdAt: m.createdAt,
      })),
  };
}

export class ChatSearchQueryDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 200,
    description: 'Keyword to match against chat titles and message content.',
  })
  @IsString()
  @MaxLength(200)
  q!: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: 50,
    default: 20,
    description: 'Maximum number of matching chats to return.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;
}

export class ChatSearchResultResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Excerpt from the first matching user/assistant message; null for a ' +
      'title-only match.',
  })
  snippet!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class ChatSearchResponse {
  @ApiProperty({ type: () => [ChatSearchResultResponse] })
  results!: ChatSearchResultResponse[];
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
    maximum: CHAT_MESSAGES_MAX_SAFE_SEQ,
    format: 'int64',
    description: 'Return messages strictly before this sequence number.',
  })
  @IsOptional()
  @Transform(({ value }) => parseSafeIntegerQueryValue(value))
  @IsInt()
  @Min(1)
  @Max(CHAT_MESSAGES_MAX_SAFE_SEQ)
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
    parts: message.parts,
    attachments: message.attachments,
    usage:
      message.usage === null
        ? null
        : (message.usage as Record<string, unknown>),
    inReplyTo: message.inReplyTo,
    createdAt: message.createdAt,
  };
}
