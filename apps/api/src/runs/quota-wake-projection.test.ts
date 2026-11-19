import { type RunEvent } from '../db/schema';
import {
  quotaRequestFromEvents,
  quotaResumeAttemptId,
  quotaWakeStateFromEvents,
} from './quota-wake-projection';

const runId = '11111111-1111-4111-8111-111111111111';
const createdAt = new Date('2026-10-10T00:00:00.000Z');

function event(
  sequence: number,
  eventType: string,
  payload: RunEvent['payload'],
): RunEvent {
  return { sequence, runId, eventType, payload, createdAt };
}

function quotaPayload(generation = 3, waitCount = 1, resumeAt = 'request') {
  return {
    kind: 'quota',
    attemptId: 'suspended-attempt',
    generation,
    failureClass: 'quota_exhausted',
    resetsAt: '2026-10-12T00:00:00.000Z',
    wakeAt: '2026-10-12T00:01:00.000Z',
    resumeAt,
    waitCount,
    parts: [{ type: 'text', text: 'before wait', step: 4 }],
    steps: { 'tool-a': 4 },
  };
}

function quotaSuspension(generation = 3, waitCount = 1, resumeAt = 'request') {
  return event(
    1,
    'run.suspended',
    quotaPayload(generation, waitCount, resumeAt),
  );
}

describe('quota wake projection', () => {
  it('restores checkpoint parts and step state without adding a synthetic tool part', () => {
    const events = [
      quotaSuspension(),
      event(2, 'run.resumed', {
        kind: 'quota',
        attemptId: 'wake-attempt',
        generation: 3,
        cause: 'timeout',
      }),
      event(3, 'run.started', { attemptId: 'wake-attempt' }),
      event(4, 'model.requested', { attemptId: 'wake-attempt' }),
    ];

    expect(quotaWakeStateFromEvents(events, 'wake-attempt')).toEqual({
      parts: [{ type: 'text', text: 'before wait', step: 4 }],
    });
    expect(
      quotaWakeStateFromEvents(events, 'wake-attempt')?.parts,
    ).toHaveLength(1);
  });

  it('uses only a matching first quota wake claim and stops restoring after redelivery', () => {
    const events = [
      quotaSuspension(),
      event(2, 'run.resumed', {
        kind: 'quota',
        attemptId: 'wake-attempt',
        generation: 3,
        cause: 'timeout',
      }),
      event(3, 'run.started', { attemptId: 'wake-attempt' }),
      event(4, 'run.started', { attemptId: 'redelivery' }),
    ];

    expect(quotaWakeStateFromEvents(events, 'wake-attempt')).toBeUndefined();
    expect(quotaWakeStateFromEvents(events, 'redelivery')).toBeUndefined();
    expect(
      quotaWakeStateFromEvents(events.slice(0, 3), 'other-attempt'),
    ).toBeUndefined();
  });

  it('does not treat kindless legacy job suspension and wake events as quota events', () => {
    const events = [
      event(1, 'run.suspended', {
        generation: 3,
        parts: [{ type: 'text', text: 'legacy jobs' }],
        steps: {},
      }),
      event(2, 'run.resumed', {
        generation: 3,
        attemptId: 'wake-attempt',
        cause: 'timeout',
      }),
      event(3, 'run.started', { attemptId: 'wake-attempt' }),
    ];

    expect(quotaWakeStateFromEvents(events, 'wake-attempt')).toBeUndefined();
    expect(quotaRequestFromEvents(events)).toBeUndefined();
  });

  it('keeps the request counter after awaiting is cleared and closes only matching recovery', () => {
    const suspended = quotaSuspension(3, 4, 'boundary');

    const resumed = event(2, 'run.resumed', {
      kind: 'quota',
      attemptId: 'wake-attempt',
      generation: 3,
      cause: 'timeout',
    });

    const started = event(3, 'run.started', { attemptId: 'wake-attempt' });
    const redelivery = event(4, 'run.started', { attemptId: 'redelivery' });
    expect(
      quotaRequestFromEvents([suspended, resumed, started, redelivery]),
    ).toEqual({
      resumeAt: 'boundary',
      waitCount: 4,
      generation: 3,
    });

    const wrongRecovery = event(5, 'run.quota_recovered', {
      generation: 3,
      resumeAt: 'request',
    });

    expect(
      quotaRequestFromEvents([
        suspended,
        resumed,
        started,
        redelivery,
        wrongRecovery,
      ]),
    ).toEqual({ resumeAt: 'boundary', waitCount: 4, generation: 3 });

    const matchingRecovery = event(6, 'run.quota_recovered', {
      generation: 3,
      resumeAt: 'boundary',
    });

    expect(
      quotaRequestFromEvents([
        suspended,
        resumed,
        started,
        redelivery,
        wrongRecovery,
        matchingRecovery,
      ]),
    ).toBeUndefined();
  });

  it('projects the latest open quota suspension and accepts only valid durable records', () => {
    const first = quotaSuspension(3, 2, 'request');
    const second = event(2, 'run.suspended', quotaPayload(8, 1, 'preDispatch'));

    expect(quotaRequestFromEvents([first, second])).toEqual({
      resumeAt: 'preDispatch',
      waitCount: 1,
      generation: 8,
    });
    expect(
      quotaRequestFromEvents([
        event(1, 'run.suspended', quotaPayload(8, 4.5, 'preDispatch')),
      ]),
    ).toBeUndefined();
  });
  it('stops at a recovered latest quota request instead of reviving an older wait', () => {
    const first = quotaSuspension(1, 1);
    const second = event(2, 'run.suspended', quotaPayload(2, 2));

    const recovered = event(3, 'run.quota_recovered', {
      generation: 2,
      resumeAt: 'request',
    });

    expect(quotaRequestFromEvents([first, second, recovered])).toBeUndefined();
    expect(
      quotaRequestFromEvents([
        first,
        second,
        recovered,
        event(4, 'run.suspended', quotaPayload(3, 1)),
      ]),
    ).toEqual({ resumeAt: 'request', waitCount: 1, generation: 3 });
  });

  it('reuses only the matching quota resume attempt before another start or delivery', () => {
    const events = [
      quotaSuspension(),
      event(2, 'run.resumed', {
        kind: 'quota',
        attemptId: 'wake-attempt',
        generation: 3,
        cause: 'timeout',
      }),
    ];

    expect(quotaResumeAttemptId(events, 3)).toBe('wake-attempt');
    expect(quotaResumeAttemptId(events, 9)).toBeUndefined();
    expect(
      quotaResumeAttemptId([...events, event(3, 'run.started', {})], 3),
    ).toBeUndefined();
    expect(
      quotaResumeAttemptId([...events, event(3, 'run.delivered', {})], 3),
    ).toBeUndefined();
  });
});
