import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { Chat, Compaction, Message, MessageRole } from '../../db/schema';
import { isTextPart } from '../context-builder';
import type { TurnTelemetry } from '../turn-telemetry';

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
// are applied.
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

  // ValidateIf (not IsOptional): IsOptional also waves `null` through, and
  // visibility is a NOT NULL enum column — an explicit null would otherwise
  // reach the repository and fail as a DB constraint violation (500) instead
  // of a clean 400. Only absence skips validation, same as title above.
  @ApiPropertyOptional({
    enum: ['private', 'public'],
    description:
      "Sharing: 'public' exposes a read-only link at /shared/:id; 'private' revokes it.",
  })
  @ValidateIf((o: UpdateChatDto) => o.visibility !== undefined)
  @IsIn(['private', 'public'])
  visibility?: 'private' | 'public';

  // ValidateIf (not IsOptional): same reasoning as `title` above — IsOptional
  // waves `null` through unvalidated, so `{ pinned: null }` would reach the
  // service as `null` and silently unpin (falsy) instead of 400ing. Only
  // absence skips validation; an explicit null must fail IsBoolean.
  @ApiPropertyOptional({
    description:
      'Pin the chat to the top of the sidebar (true) or unpin (false).',
  })
  @ValidateIf((o: UpdateChatDto) => o.pinned !== undefined)
  @IsBoolean()
  pinned?: boolean;
}

/**
 * `POST /chats/:id/forks` body — copy this chat up to `fromMessageId` into a
 * new chat. `fromMessageId` is optional: omit it to fork the WHOLE
 * conversation (clone), the anchor for the sidebar's "Fork" menu item as
 * opposed to the per-message "fork from here" action.
 *
 * ValidateIf (not IsOptional): same reasoning as `UpdateChatDto.pinned` —
 * IsOptional waves an explicit `null` through unvalidated, and `null` isn't
 * a valid anchor (only "absent" means "whole chat"); an explicit null must
 * still fail IsUUID rather than being silently treated as "whole chat".
 */
export class ForkChatDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Copy up to (and including) this message. Omit to fork the whole conversation.',
  })
  @ValidateIf((o: ForkChatDto) => o.fromMessageId !== undefined)
  @IsUUID()
  fromMessageId?: string;
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
  @ApiProperty({ description: 'Opaque llame model id selected for this turn.' })
  @IsString()
  @Matches(/\S/, { message: 'modelId must not be blank' })
  modelId!: string;

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

  // Set when the owner pins the chat to the top of the sidebar; null = unpinned.
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
 * Display-relevant subset of a compaction's `usage` (TurnTelemetry shape, the
 * SUMMARIZATION call's own token accounting — see turn-telemetry.ts) plus a
 * seq-derived message count. All fields are null-safe: older or seeded
 * compactions may carry no `usage` at all, or a partial shape, and the
 * absorbed-message count is independent of `usage` entirely (pure `uptoSeq`
 * arithmetic) so it can be present even when the rest is null. `beforeTokens`/
 * `afterTokens` are the summarization call's input/output token counts — the
 * size of what got absorbed vs. the size of the summary that replaced it, not
 * a literal "chat context size before/after" figure (that number isn't
 * persisted anywhere today).
 */
export class CompactionStatsResponse {
  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Messages absorbed by this compaction (uptoSeq minus the previous ' +
      "compaction's uptoSeq, or uptoSeq itself for the first one).",
  })
  absorbedMessageCount!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: "The summarization call's input token count.",
  })
  beforeTokens!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: "The summarization call's output (summary) token count.",
  })
  afterTokens!: number | null;

  @ApiProperty({ type: String, nullable: true })
  modelId!: string | null;
}

/**
 * The chat's LATEST compaction (#57) — embedded in `ChatMessagesResponse` (not
 * a separate endpoint, #136 read-side simplification) so the UI can mark where
 * older turns were folded into a summary for the model's context in the SAME
 * round trip as the messages themselves. `uptoSeq` is the boundary: messages
 * with `seq <= uptoSeq` are represented by the `summary`. Exposes only display
 * fields (no internal id/parentId).
 */
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

  @ApiProperty({ type: () => CompactionStatsResponse })
  stats!: CompactionStatsResponse;
}

export function toCompactionResponse(
  compaction: Compaction,
  absorbedMessageCount: number | null,
): CompactionResponse {
  // `usage` is untyped jsonb (no `.$type<>()` on the schema column) — narrow
  // defensively rather than trust the shape; a malformed/foreign value degrades
  // to "no stats" instead of throwing.
  const usage =
    compaction.usage !== null &&
    typeof compaction.usage === 'object' &&
    !Array.isArray(compaction.usage)
      ? (compaction.usage as Partial<TurnTelemetry>)
      : null;

  return {
    uptoSeq: compaction.uptoSeq,
    summary: compaction.summary,
    createdAt: compaction.createdAt,
    stats: {
      absorbedMessageCount,
      beforeTokens:
        typeof usage?.inputTokens === 'number' ? usage.inputTokens : null,
      afterTokens:
        typeof usage?.outputTokens === 'number' ? usage.outputTokens : null,
      modelId: typeof usage?.modelId === 'string' ? usage.modelId : null,
    },
  };
}

export class ChatSearchQueryDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 200,
    description: 'Keyword to match against chat titles and message content.',
  })
  @IsString()
  @MinLength(1)
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

  // NULL = untitled (#78): content-only matches can surface a still-untitled
  // chat. Clients render their own localized placeholder for NULL.
  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

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

  // Embedded (#136): the chat's latest compaction, folded into this same
  // response instead of a separate `GET :id/compaction` round trip. null
  // when the chat has never compacted.
  @ApiProperty({ type: () => CompactionResponse, nullable: true })
  compaction!: CompactionResponse | null;
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

/**
 * PUBLIC share view of a message. Deliberately MINIMAL: no `senderUserId`/
 * `attachments`/telemetry (no identity leak), and `parts` is filtered to TEXT
 * only — reasoning is stripped (it can contain injected private context:
 * memories, custom instructions the model reasoned over). `seq` IS included —
 * it's an opaque, non-identifying ordering integer, not sender/tenant data —
 * so the client can page through a long shared conversation the same
 * `beforeSeq` cursor way the owner history endpoint already works.
 */
export class SharedChatMessageResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: 'integer', format: 'int64' })
  seq!: number;

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

  // NULL = untitled (#78), same as ChatResponse.title — the shared view never
  // invents a display literal; the client renders its own placeholder.
  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ type: () => [SharedChatMessageResponse] })
  messages!: SharedChatMessageResponse[];
}

export function toSharedChatResponse(
  chat: Chat,
  messages: Message[],
): SharedChatResponse {
  return {
    id: chat.id,
    title: chat.title,
    messages: messages
      // Only the conversation (user + assistant) is public — never system/tool.
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        id: m.id,
        seq: m.seq,
        role: m.role as 'user' | 'assistant',
        // TEXT-only allowlist: strips reasoning (privacy) + any non-display part.
        // Reuses the same isTextPart guard as partsToExcerpt (not an ad-hoc
        // shape check) and remaps to a strict {type, text} pair — any OTHER
        // field a text-tagged part might carry is dropped, not passed through.
        parts: (Array.isArray(m.parts) ? m.parts : [])
          .filter(isTextPart)
          .map((p) => ({ type: 'text' as const, text: p.text })),
        createdAt: m.createdAt,
      })),
  };
}
