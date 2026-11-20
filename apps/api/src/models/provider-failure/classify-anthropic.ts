import type { FailureInput, ProviderFailure } from './provider-failure';
import { classifyForWire } from './classify-common';

export function classifyAnthropic(input: FailureInput): ProviderFailure {
  return classifyForWire(input, 'anthropic');
}
