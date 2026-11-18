import { ProviderFailure } from '../models/provider-failure/provider-failure';
import { ModelStreamIdleError } from '../models/stream-idle-watchdog';
import { ModelContextExecutionError } from './model-context-errors';

type ModelRequestFailure = { code: string; resetsAt?: number };

export function modelRequestFailure(error: unknown): ModelRequestFailure {
  if (error instanceof ProviderFailure) {
    return {
      code: error.code,
      ...(error.resetsAt !== undefined && { resetsAt: error.resetsAt }),
    };
  }

  if (
    error instanceof ModelContextExecutionError ||
    error instanceof ModelStreamIdleError
  ) {
    return { code: error.code };
  }

  return { code: 'unknown' };
}
