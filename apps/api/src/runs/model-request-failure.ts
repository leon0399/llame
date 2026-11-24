import { ProviderFailure } from '../models/provider-failure/provider-failure';
import { ModelContextExecutionError } from './model-context-errors';

type ModelRequestFailure = {
  code: string;
  /** Millisecond instant of the provider's reset, when it named one. */
  resetsAt?: number;
  /** The provider's retry hint in milliseconds, when it sent one. */
  hintMs?: number;
};

export function modelRequestFailure(error: unknown): ModelRequestFailure {
  if (error instanceof ProviderFailure) {
    return {
      code: error.code,
      ...(error.resetsAt !== undefined && { resetsAt: error.resetsAt }),
      // The owner reads this number from `runs.error` for the next-candidate
      // switch hold (design D4); it is owner-visible in the Run DTO.
      ...(error.hintMs !== undefined && { hintMs: error.hintMs }),
    };
  }

  if (error instanceof ModelContextExecutionError) {
    return { code: error.code };
  }

  return { code: 'unknown' };
}
