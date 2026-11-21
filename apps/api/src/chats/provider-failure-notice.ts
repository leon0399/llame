/**
 * The `provider-failure` context-item producer (continue-after-broken-send D5):
 * the notice that follows the last settled tool part of a send that failed
 * after it had started tool calls. It tells the model why its previous
 * response stopped, that every call above has its result, and that the output
 * it sent after the last result is not kept.
 *
 * The notice is an in-Run item stored directly after the last settled tool
 * part, so every later request that carries that tool part carries the notice
 * too. Its payload names only the closed failure class; the label the model
 * reads is derived here, because prose is never persisted as state and a
 * provider's own message, header, or body never reaches the notice.
 */

import {
  FAILURE_CLASSES,
  type FailureClass,
} from '../models/provider-failure/provider-failure';
import { loadPackagedTemplate } from '../prompts/template-engine';
import { type AuthoredContextItemPart } from './context-item';
import {
  createRenderedContextItem,
  isExactRecord,
} from './context-item-shared';

export interface ProviderFailurePayload extends Record<string, unknown> {
  readonly failureClass: FailureClass;
}

/**
 * Plain-language names the model reads. Fixed text rather than the class code,
 * and a total `Record` so a failure class added to the closed union fails the
 * typecheck here instead of rendering a notice that names nothing.
 */
const FAILURE_CLASS_LABELS: Record<FailureClass, string> = {
  quota_exhausted: 'a usage limit',
  billing: 'a billing limit',
  rate_limited: 'a rate limit',
  overloaded: 'provider overload',
  server_error: 'a provider error',
  unreachable: 'a connection failure',
  first_token_timeout: 'a first-token timeout',
  stream_broken: 'a broken stream',
  model_not_found: 'a missing model',
  auth: 'an authentication failure',
  context_overflow: 'a context overflow',
  invalid_request: 'an invalid request',
  content_policy: 'a content policy refusal',
  unknown: 'an unknown failure',
};

function isFailureClass(value: unknown): value is FailureClass {
  return FAILURE_CLASSES.some((known) => known === value);
}

export function isProviderFailurePayload(
  value: unknown,
): value is ProviderFailurePayload {
  return (
    isExactRecord(value, ['failureClass']) &&
    isFailureClass(value['failureClass'])
  );
}

const renderProviderFailureNotice = loadPackagedTemplate<{
  readonly label: string;
}>(__dirname, 'provider-failure-notice');

export function createProviderFailureItem(input: {
  readonly runId: string;
  readonly failureClass: FailureClass;
}): AuthoredContextItemPart {
  const payload: ProviderFailurePayload = {
    failureClass: input.failureClass,
  };

  return createRenderedContextItem({
    producer: 'provider-failure',
    form: 'notice',
    runId: input.runId,
    payload,
    body: renderProviderFailureNotice({
      label: FAILURE_CLASS_LABELS[input.failureClass],
    }),
  });
}
