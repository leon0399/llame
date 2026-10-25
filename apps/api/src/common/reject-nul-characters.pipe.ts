import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { isRecord, isString } from '@workspace/runtime-safety';

function containsNul(value: unknown): boolean {
  if (isString(value)) return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(containsNul);
  if (isRecord(value)) {
    return Object.entries(value).some(
      ([key, entry]) => key.includes('\u0000') || containsNul(entry),
    );
  }
  return false;
}

/**
 * Rejects a body, query, or path value holding a NUL character anywhere,
 * keys included. Postgres text and jsonb cannot store U+0000, so such a value
 * would otherwise reach the database and fail there as a 500.
 */
export class RejectNulCharactersPipe implements PipeTransform {
  transform<T>(value: T): T {
    if (containsNul(value)) {
      throw new BadRequestException(
        'Request values must not contain NUL characters.',
      );
    }
    return value;
  }
}
