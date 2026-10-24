import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  EXECUTOR_ID_MAX,
  OptionalExecutorId,
  OptionalUuid,
} from '../../common/dto/optional-field.decorators';
import { type PermissionClauseReference } from '../../tools/permissions/types';
import {
  PERMISSION_MODES,
  type PermissionMode,
} from '../../tools/permissions/permission-mode';
import { type CreationWorkspaceResult } from '../chat-creation-workspace';
import { ChatResponse } from './chats.dto';
import { MessagePartsDto } from './message-parts.dto';

/*
 * `POST /api/v1/chats` — the create request (openspec `chat-start-location`,
 * design D9). It is its own schema: it shares only the message-parts schema
 * with the message route, because a field typed as `CreateMessageBodyDto`
 * would reject `message.modelId` under the strict whitelist and the message
 * route must never accept a location field.
 */

/** The optional `worktree` object: a supplied name, a base ref, or both. */
export class CreateChatWorktreeDto {
  // Only absence skips validation, as everywhere in this file: a blank or
  // `-`-prefixed name is refused by the create's own step-1 validation with
  // the 422 the request contract names, not silently dropped here.
  @ApiPropertyOptional({
    description:
      'Worktree name; becomes the `llame/<name>` branch unless it carries a `/`.',
  })
  @ValidateIf((o: CreateChatWorktreeDto) => o.name !== undefined)
  @IsString()
  @MaxLength(EXECUTOR_ID_MAX)
  name?: string;

  @ApiPropertyOptional({
    description: 'Commit, branch, or tag the new worktree branches from.',
  })
  @ValidateIf((o: CreateChatWorktreeDto) => o.baseRef !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'baseRef must not be blank' })
  @MaxLength(EXECUTOR_ID_MAX)
  baseRef?: string;
}

/**
 * The optional first message: its own client id, the parts schema, and the
 * model selection the message route validates from its body.
 */
export class CreateChatMessageDto extends MessagePartsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ description: 'Opaque llame model id selected for this turn.' })
  @IsString()
  @Matches(/\S/, { message: 'modelId must not be blank' })
  modelId!: string;

  @ApiPropertyOptional({
    description:
      "Reasoning effort for this turn. Must be one of the selected model's " +
      '`reasoning.effortLevels[].value`; omit to use its `defaultEffort`.',
  })
  @ValidateIf((o: CreateChatMessageDto) => o.effort !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'effort must not be blank' })
  effort?: string;

  @ApiPropertyOptional({
    enum: PERMISSION_MODES,
    description:
      'Permission mode the Workspace step evaluates; omit for `default`.',
  })
  @ValidateIf((o: CreateChatMessageDto) => o.permissionMode !== undefined)
  @IsIn(PERMISSION_MODES)
  permissionMode?: PermissionMode;
}

/** `POST /api/v1/chats` — a client chat id, an optional location, a message. */
export class CreateChatRequest {
  @ApiProperty({ format: 'uuid', description: 'Client-chosen chat id.' })
  @IsUUID()
  id!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @OptionalUuid()
  repositoryId?: string;

  @OptionalExecutorId()
  executorId?: string;

  @OptionalUuid()
  checkoutId?: string;

  @ApiPropertyOptional({ type: () => CreateChatWorktreeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateChatWorktreeDto)
  worktree?: CreateChatWorktreeDto;

  // @IsDefined would make the message required; absence is the empty-chat
  // create, so only a present message is nested-validated.
  @ApiPropertyOptional({ type: () => CreateChatMessageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateChatMessageDto)
  message?: CreateChatMessageDto;
}

// The closed status set of the create response's `workspace` object.
export const CREATION_WORKSPACE_STATUSES = [
  'bound',
  'unbound',
  'bind_failed',
  'worktree_failed',
  'machine_unavailable',
  'machine_update_required',
  'outcome_unknown',
] as const;
export type CreationWorkspaceStatus =
  (typeof CREATION_WORKSPACE_STATUSES)[number];

// The codes each status that carries one can name.
export const BIND_FAILURE_CODES = [
  'permission_denied',
  'tool_not_allowed',
  'executor_unavailable',
  'not_found',
] as const;
export type BindFailureCode = (typeof BIND_FAILURE_CODES)[number];

export const WORKTREE_FAILURE_CODES = ['path_not_registered'] as const;
export type WorktreeFailureCode = (typeof WORKTREE_FAILURE_CODES)[number];

export class CreationWorktreeResponse {
  @ApiProperty()
  path!: string;

  @ApiProperty()
  branch!: string;

  @ApiProperty()
  baseCommit!: string;
}

export class CreationWorkspaceResponse {
  @ApiProperty({ enum: CREATION_WORKSPACE_STATUSES })
  status!: CreationWorkspaceStatus;

  @ApiPropertyOptional({ type: String })
  root?: string;

  @ApiPropertyOptional({ type: String })
  executorId?: string;

  @ApiPropertyOptional({ type: () => CreationWorktreeResponse })
  worktree?: CreationWorktreeResponse;

  @ApiPropertyOptional({
    enum: [...BIND_FAILURE_CODES, ...WORKTREE_FAILURE_CODES],
  })
  code?: BindFailureCode | WorktreeFailureCode;

  @ApiPropertyOptional({
    type: String,
    description: 'The bounded, redacted git standard error, when there is one.',
  })
  message?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'The directory an `outcome_unknown` can leave behind.',
  })
  leftDirectory?: string;
}

export class CreateChatResponse {
  @ApiProperty({ type: () => ChatResponse })
  chat!: ChatResponse;

  @ApiProperty({ type: () => CreationWorkspaceResponse })
  workspace!: CreationWorkspaceResponse;
}

/** One recorded path decision, as the owner reads it back. */
export class ChatCreationDecisionResponse {
  @ApiProperty()
  path!: string;

  @ApiProperty({ description: 'Opaque random policy-instance id.' })
  policyId!: string;

  @ApiProperty({ enum: ['allow', 'reject'] })
  decision!: 'allow' | 'reject';

  @ApiProperty({
    enum: [
      'explicit_reject',
      'no_allow',
      'invalid_field',
      'input_limit',
      'matched_allow',
      'permission_mode_bypass',
    ],
  })
  reason!: string;

  @ApiProperty({
    nullable: true,
    description: 'The bounded clause reference, when one matched.',
  })
  reference!: PermissionClauseReference | null;
}

export class ChatCreationAttemptResponse {
  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: () => [ChatCreationDecisionResponse] })
  decisions!: Array<ChatCreationDecisionResponse>;
}

export class ChatCreationRecordResponse {
  @ApiProperty({ format: 'uuid' })
  chatId!: string;

  @ApiProperty({ type: () => [ChatCreationAttemptResponse] })
  attempts!: Array<ChatCreationAttemptResponse>;
}

/** The response projection of one Workspace outcome. */
export function toWorkspaceResponse(
  result: Exclude<CreationWorkspaceResult, { status: 'conflict' }>,
): CreationWorkspaceResponse {
  switch (result.status) {
    case 'bound':
      return {
        status: 'bound',
        root: result.root,
        ...(result.executorId !== undefined && {
          executorId: result.executorId,
        }),
        ...(result.worktree !== undefined && { worktree: result.worktree }),
      };
    case 'bind_failed':
    case 'worktree_failed':
    case 'machine_unavailable':
    case 'machine_update_required':
    case 'outcome_unknown':
      return {
        status: result.status,
        ...('code' in result &&
          result.code !== undefined && { code: result.code }),
        message: result.message,
        ...('leftDirectory' in result &&
          result.leftDirectory !== undefined && {
            leftDirectory: result.leftDirectory,
          }),
      };
    case 'unbound':
      return { status: 'unbound' };
  }
}
