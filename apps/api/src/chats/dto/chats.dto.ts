import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { type Chat, type Message, type MessageRole } from '../../db/schema';
import { type ChatModelSelection } from '../../models/model-selection';
import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';
import { checkpointPayload } from '../context-item-producers';
import {
  CheckpointStatsResponse,
  toCheckpointStatsResponse,
} from './checkpoint-stats.dto';
import { isTextPart } from '../context-builder';
import {
  PERMISSION_MODES,
  type PermissionMode,
} from '../../tools/permissions/permission-mode';
import { ChatLatestRunResponse } from './latest-run.dto';
import { CreateMessageBodyDto } from './message-parts.dto';
import {
  SENDABLE_DELIVERY_MODES,
  type SendableDeliveryMode,
} from './chat-deliveries.dto';
import { withoutRetainedMedia } from '../retained-media-egress';
import { withoutProviderMetadata } from '../provider-metadata-egress';

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

  // File the chat into a project (uuid) or unfile it (explicit null).
  // Absent = leave unchanged. IsOptional (not ValidateIf, unlike the fields
  // above): here null IS a legitimate value (unfile), not a rejected one —
  // IsOptional skips further validation for both undefined AND null, and
  // IsUUID still runs for any other supplied value, so a non-uuid/foreign
  // type still 400s.
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'File the chat into this project. Pass null to unfile; omit to leave unchanged.',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string | null;

  // Archive (true) or unarchive (false) the chat. Omit to leave archive state
  // unchanged. Idempotent; honored by the repository's archive guard.
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Archive (true) or unarchive (false) the chat. Omit or send null to leave unchanged.',
  })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

/**
 * `POST /chats/:id/forks` body — copy this chat up to `fromMessageId` into a
 * new chat. `fromMessageId` is optional: omit it to fork the WHOLE
 * conversation (clone), the anchor for the sidebar's "Fork" menu item as
 * opposed to the per-message "fork from here" action.
 *
 * ValidateIf (not IsOptional): same reasoning as `UpdateChatDto.title` —
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

export class CreateMessageDto {
  // Optional: an omitted selector resolves through the Chat's stored selection,
  // then the configured default. `@role` or one exact model id.
  @ApiPropertyOptional({
    description:
      "`@role` or a model id; omit to use the Chat's stored selection",
    pattern: '\\S',
  })
  @ValidateIf((o: CreateMessageDto) => o.selector !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'selector must not be blank' })
  selector?: string;

  // ValidateIf (not IsOptional): IsOptional also waves an explicit `null`
  // through unvalidated, and `null` is not "omitted" — only absence means "use
  // the model's default". No enum or pattern here on purpose: the legal values
  // are the selected model's operator-declared provider tokens, checked by
  // exact membership after the model resolves, so the DTO's only job is to
  // reject a blank or non-string one.
  @ApiPropertyOptional({
    pattern: '\\S',
    description:
      "Reasoning effort for this turn. Must be one of the resolved model's " +
      '`reasoning.effortLevels[].value`; omit to use the stored effort or the ' +
      "model's `defaultEffort`. Matched byte-exactly — not case-folded.",
  })
  @ValidateIf((o: CreateMessageDto) => o.effort !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'effort must not be blank' })
  effort?: string;

  // ValidateIf (not IsOptional): an explicit null is malformed, while only
  // absence means the accepted mode defaults to `default`.
  @ApiPropertyOptional({
    enum: PERMISSION_MODES,
    description: 'Permission mode for this turn; omit for default.',
  })
  @ValidateIf((o: CreateMessageDto) => o.permissionMode !== undefined)
  @IsIn(PERMISSION_MODES)
  permissionMode?: PermissionMode;

  // ValidateIf (not IsOptional) for the reason `permissionMode` states. Only
  // `queue` and `steer` ship in this layer; a later layer widens the values.
  @ApiPropertyOptional({
    enum: SENDABLE_DELIVERY_MODES,
    description:
      'How a message that arrives during a live Run reaches the Chat. A ' +
      'send with `delivery` to a Chat with a live Run answers 202 with a ' +
      'pending item; to an idle Chat it starts a Run like any send.',
  })
  @ValidateIf((o: CreateMessageDto) => o.delivery !== undefined)
  @IsIn(SENDABLE_DELIVERY_MODES)
  delivery?: SendableDeliveryMode;

  // @IsDefined is required: without it, an omitted `message` is `undefined` and
  // @ValidateNested silently passes, so the handler would deref `input.message.id`.
  @ApiProperty({ type: () => CreateMessageBodyDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CreateMessageBodyDto)
  message!: CreateMessageBodyDto;
}

/**
 * The fallback hold a stored selection may carry: the Chat stays on `modelId`
 * for `selector` until `revertAt`. Absent when the Chat holds no fallback.
 */
export class ChatFallbackHoldResponse {
  @ApiProperty({
    description: 'The `@role` or model id the hold falls back from.',
  })
  selector!: string;

  @ApiProperty({ description: 'The exact model the hold stays on.' })
  modelId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The effort the hold pins; null when it pins none.',
  })
  effort!: string | null;

  @ApiProperty({
    format: 'date-time',
    description: 'When the Chat returns to `selector`.',
  })
  revertAt!: string;
}

/** The selection the Chat stores for its next send; null when it has none. */
export class ChatModelSelectionResponse {
  @ApiProperty({ description: '`@role` or model id the owner selected.' })
  selector!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The effort the owner selected; null when none.',
  })
  effort!: string | null;

  @ApiPropertyOptional({
    type: () => ChatFallbackHoldResponse,
    description: 'The active fallback hold; absent when none.',
  })
  hold?: ChatFallbackHoldResponse;
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

  // Archive state (chat-project-archive): set when the owner archives the chat;
  // null = not archived. Single-item reads return archived chats.
  @ApiProperty({ type: Date, format: 'date-time', nullable: true })
  archivedAt!: Date | null;

  // The project (folder) this chat is filed into; null = unfiled
  // (projects-foundation).
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  projectId!: string | null;

  // The canonical absolute root of the current Workspace binding. This field
  // is owner-only and null when the Chat has no active binding.
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Canonical absolute root of the current Workspace binding. Owner-only; null when this Chat has no binding.',
  })
  workspaceRoot!: string | null;

  // The Chat's stored model selection (openspec `model-roles`): what a send
  // that names no selector continues with. Null when the Chat never stored
  // one; the server never exposes the internal revision.
  @ApiProperty({
    type: () => ChatModelSelectionResponse,
    nullable: true,
    description:
      'The model selection the Chat stores for its next send; null when none.',
  })
  modelSelection!: ChatModelSelectionResponse | null;
}

function toChatModelSelectionResponse(
  selection: ChatModelSelection,
): ChatModelSelectionResponse {
  return {
    selector: selection.selector,
    effort: selection.effort,
    ...(selection.hold !== undefined && {
      hold: {
        selector: selection.hold.selector,
        modelId: selection.hold.modelId,
        effort: selection.hold.effort,
        revertAt: selection.hold.revertAt,
      },
    }),
  };
}

export function toChatResponse(chat: Chat): ChatResponse {
  return {
    id: chat.id,
    ownerUserId: chat.ownerUserId,
    title: chat.title,
    visibility: chat.visibility,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    archivedAt: chat.archivedAt,
    projectId: chat.projectId,
    workspaceRoot: chat.workspaceRoot,
    modelSelection:
      chat.modelSelection === null
        ? null
        : toChatModelSelectionResponse(chat.modelSelection),
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

  // The jobs of the Chat in state `running` on a worker that is not dead
  // (background-jobs). Counted at read time; the count settles nothing.
  @ApiProperty({ type: Number, minimum: 0 })
  runningJobs!: number;
}

/** Text parts only — non-text parts (tool calls, files, reasoning) are omitted. */
function partsToExcerpt(parts: Array<unknown>): string {
  const text = parts
    .map((part) => (isTextPart(part) ? part.text : ''))
    .join(' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

  return text.length > LAST_MESSAGE_EXCERPT_MAX_LENGTH
    ? `${text.slice(0, LAST_MESSAGE_EXCERPT_MAX_LENGTH - 1)}…`
    : text;
}

export function toChatListItemResponse(
  chat: Chat,
  lastMessage: Message | undefined,
  runningJobs: number,
): ChatListItemResponse {
  return Object.assign(toChatResponse(chat), {
    lastMessage: lastMessage ? partsToExcerpt(lastMessage.parts) : null,
    runningJobs,
  });
}

/** An owner-history row; checkpoint rows carry their API-computed absorbed count. */
export type ChatMessageResponseRow = Message & {
  absorbedMessageCount?: number;
};

export class ChatMessageResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  chatId!: string;

  @ApiProperty({ type: 'integer', format: 'int64' })
  seq!: number;

  @ApiProperty({ enum: ['user', 'assistant', 'system', 'tool', 'checkpoint'] })
  role!: MessageRole;

  @ApiProperty({ type: String, nullable: true })
  senderUserId!: string | null;

  @ApiProperty({
    description: 'A host-authored user row with no owner sender.',
  })
  host!: boolean;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  parts!: Array<unknown>;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  attachments!: Array<unknown>;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
  })
  usage!: UnknownRecord | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  inReplyTo!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({
    type: 'integer',
    format: 'int64',
    description:
      'The last Chat-local message sequence absorbed by this checkpoint.',
  })
  absorbedThroughSeq?: number;

  @ApiPropertyOptional({
    type: 'integer',
    format: 'int64',
    description: 'User and assistant rows absorbed by this checkpoint.',
  })
  absorbedMessageCount?: number;

  @ApiPropertyOptional({
    type: String,
    description: 'The checkpoint summary from its persisted payload.',
  })
  summary?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The focus recorded for this compaction checkpoint, or null.',
  })
  focus?: string | null;

  @ApiPropertyOptional({
    type: () => CheckpointStatsResponse,
    description: 'Token telemetry for this checkpoint.',
  })
  stats?: CheckpointStatsResponse;
}

export class ChatMessagesResponse {
  @ApiProperty({ type: () => [ChatMessageResponse] })
  messages!: Array<ChatMessageResponse>;

  @ApiProperty({
    type: () => ChatLatestRunResponse,
    nullable: true,
    description: "The Chat's newest Run; null when the Chat has no Run.",
  })
  latestRun!: ChatLatestRunResponse | null;
}

export function toChatMessageResponse(
  message: ChatMessageResponseRow,
): ChatMessageResponse {
  const response: ChatMessageResponse = {
    id: message.id,
    chatId: message.chatId,
    seq: message.seq,
    role: message.role,
    senderUserId: message.senderUserId,
    host: message.role === 'user' && message.senderUserId === null,
    // Retained bytes stay on the server (retain-read-media D4), and so does
    // the opaque provider metadata of a text part or a tool call (design A7):
    // replay reads the stored row, never this response.
    parts: withoutProviderMetadata(withoutRetainedMedia(message.parts)),
    attachments: message.attachments,
    usage: isRecord(message.usage) ? message.usage : null,
    inReplyTo: message.inReplyTo,
    createdAt: message.createdAt,
  };

  if (message.role !== 'checkpoint') {
    return response;
  }

  return Object.assign(response, {
    absorbedThroughSeq: message.absorbedThroughSeq ?? undefined,
    absorbedMessageCount: message.absorbedMessageCount ?? 0,
    ...checkpointPayload(message),
    stats: toCheckpointStatsResponse(response.usage),
  });
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
  parts!: Array<unknown>;

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
  messages!: Array<SharedChatMessageResponse>;
}

export function toSharedChatResponse(
  chat: Pick<Chat, 'id' | 'title'>,
  messages: Array<Message>,
): SharedChatResponse {
  return {
    id: chat.id,
    title: chat.title,
    messages: messages.flatMap((m) => {
      // Only the conversation (user + assistant) is public — never system/tool.
      if (m.role !== 'user' && m.role !== 'assistant') return [];

      if (m.role === 'user' && m.senderUserId === null) return [];

      return [
        {
          id: m.id,
          seq: m.seq,
          role: m.role,
          // TEXT-only allowlist: strips reasoning (privacy), model/availability
          // semantic controls, and every other non-display part.
          // Reuses the same isTextPart guard as partsToExcerpt (not an ad-hoc
          // shape check) and remaps to a strict {type, text} pair — any OTHER
          // field a text-tagged part might carry is dropped, not passed through.
          parts: (Array.isArray(m.parts) ? m.parts : [])
            .filter(isTextPart)
            .map((p) => ({ type: 'text' as const, text: p.text })),
          createdAt: m.createdAt,
        },
      ];
    }),
  };
}
