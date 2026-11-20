import type { FailureInput, ProviderFailure } from './provider-failure';
import { classifyForWire } from './classify-common';

export function classifyResponses(input: FailureInput): ProviderFailure {
  return classifyForWire(input, 'responses');
}
