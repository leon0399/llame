/**
 * The `provider-failure` producer (continue-after-broken-send D5): its fixed
 * text, the plain-language label of every failure class, and its precedence
 * in a step.
 */

import { placeAcceptedTurnItems } from './accepted-turn-parts.repository';
import { CONTEXT_ITEM_PRODUCERS, isContextItemPart } from './context-item';
import { createToolAvailabilityItem } from './context-item-producers';
import { createProviderFailureItem } from './provider-failure-notice';
import { type FailureClass } from '../models/provider-failure/provider-failure';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

const SECOND_PARAGRAPH =
  'Each tool call above has its result. Your output after the last result is not kept.';

const LABELS: ReadonlyArray<readonly [FailureClass, string]> = [
  ['quota_exhausted', 'a usage limit'],
  ['billing', 'a billing limit'],
  ['rate_limited', 'a rate limit'],
  ['overloaded', 'provider overload'],
  ['server_error', 'a provider error'],
  ['unreachable', 'a connection failure'],
  ['first_token_timeout', 'a first-token timeout'],
  ['stream_broken', 'a broken stream'],
  ['model_not_found', 'a missing model'],
  ['auth', 'an authentication failure'],
  ['context_overflow', 'a context overflow'],
  ['invalid_request', 'an invalid request'],
  ['content_policy', 'a content policy refusal'],
  ['unknown', 'an unknown failure'],
];

describe('createProviderFailureItem', () => {
  it('A broken stream has a label', () => {
    const item = createProviderFailureItem({
      runId: RUN_ID,
      failureClass: 'stream_broken',
    });

    expect(item.data).toMatchObject({
      producer: 'provider-failure',
      form: 'notice',
      payload: { failureClass: 'stream_broken' },
    });
    expect(item.data.text).toContain(
      'Your previous response stopped because the provider failed: a broken stream.',
    );
    expect(item.data.text).toContain(SECOND_PARAGRAPH);
    // The model reads the plain-language name, never the class code.
    expect(item.data.text).not.toContain('stream_broken');
  });

  it.each(LABELS)(
    'names the failure class %s with its fixed label',
    (failureClass, label) => {
      const item = createProviderFailureItem({ runId: RUN_ID, failureClass });

      expect(item.data.text).toContain(
        `Your previous response stopped because the provider failed: ${label}.`,
      );
      expect(item.data.text).toContain(SECOND_PARAGRAPH);
    },
  );
});

describe('the provider-failure notice in a step', () => {
  it('A provider-failure notice comes first in its step', () => {
    const toolAvailability = createToolAvailabilityItem({
      runId: RUN_ID,
      payload: {
        kind: 'initial',
        added: [],
        removed: [],
        unavailable: [{ id: 'read', reason: 'source_disconnected' }],
        becameUnavailable: [],
        nowAvailable: [],
      },
    });

    const notice = createProviderFailureItem({
      runId: RUN_ID,
      failureClass: 'stream_broken',
    });

    // The step yielded the availability item before the notice; the rail's
    // precedence puts the notice first regardless of emission order.
    const placed = placeAcceptedTurnItems(
      [],
      [toolAvailability, notice],
      'rank',
    );

    expect(
      placed.map((part) =>
        isContextItemPart(part) ? part.data.producer : 'owner',
      ),
    ).toEqual(['provider-failure', 'tool-availability']);
  });

  it('ranks the notice directly after the interruption marker and before the settlement notice', () => {
    const providerFailure = CONTEXT_ITEM_PRODUCERS.indexOf('provider-failure');

    expect(providerFailure).toBe(
      CONTEXT_ITEM_PRODUCERS.indexOf('interrupted') + 1,
    );
    expect(providerFailure).toBeLessThan(CONTEXT_ITEM_PRODUCERS.indexOf('job'));
  });
});
