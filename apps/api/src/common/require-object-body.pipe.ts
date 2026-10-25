import {
  type ArgumentMetadata,
  BadRequestException,
  type PipeTransform,
} from '@nestjs/common';
import { isRecord } from '@workspace/runtime-safety';

const NON_DTO_TYPES = new Set<unknown>([
  Object,
  Array,
  String,
  Number,
  Boolean,
]);

/**
 * Rejects a JSON body that is not an object where the handler declares a DTO
 * class. `ValidationPipe` runs with `forbidUnknownValues: false`, so an array
 * body would otherwise validate as an empty DTO and reach the handler as one.
 * A missing body stays allowed: it validates as `{}`, which is what makes a
 * body with no required field optional.
 */
export class RequireObjectBodyPipe implements PipeTransform {
  transform<T>(value: T, metadata: ArgumentMetadata): T {
    const dto = metadata.metatype;
    if (
      metadata.type === 'body' &&
      dto !== undefined &&
      !NON_DTO_TYPES.has(dto) &&
      value !== undefined &&
      !isRecord(value)
    ) {
      throw new BadRequestException('The request body must be a JSON object.');
    }
    return value;
  }
}
