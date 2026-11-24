/**
 * The collection query DTOs of the chats API: list filters, chat search, and
 * the message-history cursors. Split out of `chats.dto.ts` so the entity and
 * message shapes stay under the size trip-wire on their own.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { isNumber, isString } from '@workspace/runtime-safety';

export const CHAT_MESSAGES_DEFAULT_LIMIT = 100;
export const CHAT_MESSAGES_MAX_LIMIT = 200;
export const CHAT_MESSAGES_MAX_SAFE_SEQ = Number.MAX_SAFE_INTEGER;

const SAFE_INTEGER_QUERY_PATTERN = /^(0|[1-9]\d*)$/;

// eslint-disable-next-line anti-slop/no-unknown-parameters -- parses a raw HTTP query-string value (string | undefined at the framework boundary, `unknown` because query values are untyped) into a safe integer or a `NaN` sentinel; the whole function body IS the validation, branching sequentially through undefined/null, a numeric type-guard, then a string-pattern regex -- no single first-use check to point at.
function parseSafeIntegerQueryValue(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (isNumber(value)) {
    return Number.isSafeInteger(value) ? value : Number.NaN;
  }

  if (!isString(value) || !SAFE_INTEGER_QUERY_PATTERN.test(value)) {
    return Number.NaN;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

type HistoryCursorValue = number | null | undefined;

@ValidatorConstraint({ name: 'historyCursorsExclusive', async: false })
class HistoryCursorsExclusiveConstraint implements ValidatorConstraintInterface {
  validate(_value: HistoryCursorValue, args: ValidationArguments): boolean {
    const query = args.object;

    return (
      !('beforeSeq' in query) ||
      !('targetSeq' in query) ||
      query.beforeSeq === undefined ||
      query.targetSeq === undefined
    );
  }

  defaultMessage(): string {
    return 'beforeSeq and targetSeq cannot be used together';
  }
}

// GET /api/v1/chats — optional collection filters. `projectId` narrows the
// list to chats filed into that project (server-side WHERE, not a client
// filter over the full list); RLS still scopes everything to the owner.
export class ListChatsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  // Archive filter. Absent ⇒ exclude archived (the overview default). `only` ⇒
  // archived only. `with` ⇒ both archived and non-archived.
  @ApiPropertyOptional({ enum: ['only', 'with'] })
  @IsOptional()
  @IsIn(['only', 'with'])
  archived?: 'only' | 'with';

  // Pin filter. Absent ⇒ `with` (both pinned and non-pinned). `only` ⇒ pinned
  // only. `exclude` ⇒ non-pinned only. Enforced via an EXISTS/NOT EXISTS check
  // on the caller's pins (chat-project-archive).
  @ApiPropertyOptional({ enum: ['only', 'with', 'exclude'] })
  @IsOptional()
  @IsIn(['only', 'with', 'exclude'])
  pinned?: 'only' | 'with' | 'exclude';
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
  results!: Array<ChatSearchResultResponse>;
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
  @ValidateIf((o: ChatMessagesQueryDto) => o.beforeSeq !== undefined)
  @Transform(({ value }) => parseSafeIntegerQueryValue(value))
  @IsInt()
  @Min(1)
  @Max(CHAT_MESSAGES_MAX_SAFE_SEQ)
  beforeSeq?: number;
}

export class OwnerChatMessagesQueryDto extends ChatMessagesQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: CHAT_MESSAGES_MAX_SAFE_SEQ,
    format: 'int64',
    description:
      'Return a fixed-size history window ending at this sequence number; ' +
      'mutually exclusive with beforeSeq.',
  })
  @ValidateIf((o: OwnerChatMessagesQueryDto) => o.targetSeq !== undefined)
  @Validate(HistoryCursorsExclusiveConstraint)
  @Transform(({ value }) => parseSafeIntegerQueryValue(value))
  @IsInt()
  @Min(1)
  @Max(CHAT_MESSAGES_MAX_SAFE_SEQ)
  targetSeq?: number;
}
