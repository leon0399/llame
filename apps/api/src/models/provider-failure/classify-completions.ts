import type { FailureInput, ProviderFailure } from './provider-failure';
import { classifyForWire } from './classify-common';

export function classifyCompletions(input: FailureInput): ProviderFailure {
  return classifyForWire(input, 'completions');
}
