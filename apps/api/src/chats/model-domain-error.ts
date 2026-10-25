import { HttpException, HttpStatus } from '@nestjs/common';

import {
  ModelConfigurationError,
  EffortNotAvailableError,
  ModelNotAvailableError,
  PermissionModeNotAvailableError,
} from '../models/models.service';

/**
 * Same 422 envelope for `ModelNotAvailableError`, `EffortNotAvailableError`,
 * and `PermissionModeNotAvailableError` — the `code` discriminates. Model
 * resolution already ran first, so an effort failure here always names a
 * model that IS available. Any other error rethrows unchanged.
 */
export function throwModelDomainError(error: unknown): never {
  if (
    error instanceof ModelNotAvailableError ||
    error instanceof EffortNotAvailableError ||
    error instanceof PermissionModeNotAvailableError
  ) {
    throw new HttpException(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        code: error.code,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (error instanceof ModelConfigurationError) {
    throw new HttpException(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        message: error.message,
        code: error.code,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  throw error;
}
