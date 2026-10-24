import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { type CheckoutKind, type CheckoutOrigin } from '../../db/schema';
import { type CheckoutSummary } from '../checkouts.service';

const PATH_MAX = 4096;

// POST /api/v1/checkouts — one path, plus at most one selector. The path names
// an absolute local path in this layer; a `machine://` locator answers 503
// `executor_unavailable` from the service until the daemon answers git.
export class CreateCheckoutDto {
  @ApiProperty({
    maxLength: PATH_MAX,
    description: 'One absolute local path.',
  })
  @IsString()
  @Matches(/\S/, { message: 'path must not be blank' })
  @MaxLength(PATH_MAX)
  path!: string;

  @ApiPropertyOptional({
    // The selector is nullable in the request, which makes the generated
    // schema an anyOf of string and null; naming the type keeps the client's
    // `repositoryId` a string it can pass without widening.
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Selects an existing repository of this owner.',
  })
  @IsOptional()
  @IsUUID()
  repositoryId?: string | null;

  @ApiPropertyOptional({
    type: String,
    maxLength: PATH_MAX,
    nullable: true,
    description:
      'A remote that selects an existing repository of this owner. The inspected origin decides.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PATH_MAX)
  remote?: string | null;
}

export class ListCheckoutsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  repositoryId?: string;
}

// PATCH /api/v1/checkouts/:id — only a `main` row accepts a worktree base.
export class UpdateCheckoutDto {
  @ApiProperty({
    maxLength: PATH_MAX,
    description:
      'The placement base of new worktrees: an absolute host path, or a machine:// locator of this checkout’s own Machine.',
  })
  @IsString()
  @Matches(/\S/, { message: 'worktreeBase must not be blank' })
  @MaxLength(PATH_MAX)
  worktreeBase!: string;
}

export class CheckoutResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  repositoryId!: string;

  @ApiProperty({ description: 'The local executor id, or machine:<name>.' })
  executorId!: string;

  @ApiProperty()
  path!: string;

  @ApiProperty({ enum: ['main', 'worktree'] })
  kind!: CheckoutKind;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  parentCheckoutId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null for a detached HEAD registration or adoption.',
  })
  branch!: string | null;

  @ApiProperty({ enum: ['registered', 'adopted', 'created'] })
  origin!: CheckoutOrigin;

  @ApiProperty({ type: String, nullable: true })
  worktreeBase!: string | null;

  @ApiProperty({
    type: [String],
    description:
      "The ids of this owner's chats whose Workspace root equals path.",
  })
  chatIds!: Array<string>;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The chat whose lease records this worktree, when one does.',
  })
  leaseChatId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export function toCheckoutResponse(
  checkout: CheckoutSummary,
): CheckoutResponse {
  return {
    id: checkout.id,
    repositoryId: checkout.repositoryId,
    executorId: checkout.executorId,
    path: checkout.path,
    kind: checkout.kind,
    parentCheckoutId: checkout.parentCheckoutId,
    branch: checkout.branch,
    origin: checkout.origin,
    worktreeBase: checkout.worktreeBase,
    chatIds: [...checkout.chatIds],
    leaseChatId: checkout.leaseChatId,
    createdAt: checkout.createdAt,
    updatedAt: checkout.updatedAt,
  };
}
