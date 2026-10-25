import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// Bound on an executor id: `tools.nativeExecutorId` or `machine:<name>`, both
// operator-authored and short. Shared by every field that takes one — the
// project default executor and the start-location triple.
export const EXECUTOR_ID_MAX = 200;

// Only absence skips validation: `IsOptional` would also wave an explicit
// null through, which a resolver then reads as a present value.
const unlessAbsent = () => ValidateIf((_object, value) => value !== undefined);

/**
 * An optional uuid field: documented as one, and validated unless absent.
 *
 * A composed decorator rather than a base class, because both DTOs that take
 * the start-location triple declare it among their own fields
 * (`CreateChatRequest` after `projectId`, `StartLocationQueryDto` alone) and
 * OpenAPI lists inherited properties before the subclass's own, which would
 * reorder the generated document.
 */
export function OptionalUuid(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({ format: 'uuid' }),
    unlessAbsent(),
    IsUUID(),
  );
}

/**
 * An optional executor id: bounded like the column it lands in, and refused
 * when blank, which `IsString` alone waves through to a resolution miss.
 */
export function OptionalExecutorId(): PropertyDecorator {
  return applyDecorators(
    ApiPropertyOptional({ maxLength: EXECUTOR_ID_MAX, pattern: '\\S' }),
    unlessAbsent(),
    IsString(),
    Matches(/\S/, { message: 'executorId must not be blank' }),
    MaxLength(EXECUTOR_ID_MAX),
  );
}
