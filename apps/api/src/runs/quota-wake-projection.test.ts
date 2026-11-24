import { type RunEvent } from '../db/schema';
import {
  quotaPendingReplyFromEvents,
  quotaCompactionStateFromEvents,
  quotaRequestFromEvents,
  quotaResumeAttemptId,
  quotaSummaryWakeFromEvents,
  quotaWaitCutFromEvents,
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
  it.each([
    event(2, 'model.requested', { attemptId: 'later-attempt' }),
    event(2, 'run.quota_recovered', { generation: 3, resumeAt: 'request' }),
    event(2, 'run.delivered', {}),
  ])('does not recover pending history after $eventType', (later) => {
    expect(
      quotaPendingReplyFromEvents([quotaSuspension(), later]),
    ).toBeUndefined();
  });

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

  it.each(['preDispatch', 'boundary', 'finalAnswer'])(
    'retains the %s summary checkpoint through a redelivery until recovery commits',
    (resumeAt) => {
      const events = [
        quotaSuspension(3, 4, resumeAt),
        event(2, 'run.resumed', {
          kind: 'quota',
          attemptId: 'wake-attempt',
          generation: 3,
          cause: 'timeout',
        }),
        event(3, 'run.started', { attemptId: 'wake-attempt' }),
        event(4, 'run.started', { attemptId: 'redelivery' }),
      ];

      expect(quotaWakeStateFromEvents(events, 'redelivery')).toBeUndefined();
      expect(
        quotaCompactionStateFromEvents(events, quotaRequestFromEvents(events)),
      ).toEqual({
        parts: [{ type: 'text', text: 'before wait', step: 4 }],
      });

      const recovered = [
        ...events,
        event(5, 'run.quota_recovered', { generation: 3, resumeAt }),
      ];

      expect(
        quotaCompactionStateFromEvents(
          recovered,
          quotaRequestFromEvents(recovered),
        ),
      ).toBeUndefined();
    },
  );

  it.each(['request', 'compactionRun'])(
    'does not replay the parent checkpoint for a %s wake after its claim dies',
    (resumeAt) => {
      const events = [
        quotaSuspension(3, 1, resumeAt),
        event(2, 'run.started', { attemptId: 'redelivery' }),
      ];

      expect(
        quotaCompactionStateFromEvents(events, quotaRequestFromEvents(events)),
      ).toBeUndefined();
    },
  );

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

  it.each([
    { stoppedCalls: [] },
    { stoppedCalls: [{ toolName: 'bash', toolCallId: 'stopped-write' }] },
  ])(
    'retains an interrupted boundary through claim redelivery: %j',
    ({ stoppedCalls }) => {
      const events = [
        event(1, 'run.suspended', {
          ...quotaPayload(3, 2, 'boundary'),
          stoppedCalls,
        }),
        event(2, 'run.resumed', {
          kind: 'quota',
          attemptId: 'wake-attempt',
          generation: 3,
        }),
        event(3, 'run.started', { attemptId: 'wake-attempt' }),
        event(4, 'run.started', { attemptId: 'redelivery' }),
      ];

      expect(quotaRequestFromEvents(events)).toEqual({
        resumeAt: 'boundary',
        waitCount: 2,
        generation: 3,
        stoppedCalls,
      });
      expect(
        quotaRequestFromEvents([
          ...events,
          event(5, 'run.quota_recovered', {
            generation: 3,
            resumeAt: 'boundary',
          }),
        ]),
      ).toBeUndefined();
    },
  );

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
  it('rejects mismatched wake generation and attempt linkage', () => {
    const suspension = quotaSuspension();

    const resumed = (generation: number, attemptId: string) =>
      event(2, 'run.resumed', {
        kind: 'quota',
        attemptId,
        generation,
        cause: 'timeout',
      });

    const started = (attemptId: string) =>
      event(3, 'run.started', { attemptId });

    expect(
      quotaWakeStateFromEvents(
        [suspension, resumed(4, 'wake-attempt'), started('wake-attempt')],
        'wake-attempt',
      ),
    ).toBeUndefined();
    expect(
      quotaWakeStateFromEvents(
        [suspension, resumed(3, 'claimed-attempt'), started('wake-attempt')],
        'wake-attempt',
      ),
    ).toBeUndefined();
    expect(
      quotaWakeStateFromEvents(
        [suspension, resumed(3, 'wake-attempt'), started('other-attempt')],
        'wake-attempt',
      ),
    ).toBeUndefined();
  });

  it('stops restoring the checkpoint and quota request after delivery', () => {
    const events = [
      quotaSuspension(),
      event(2, 'run.resumed', {
        kind: 'quota',
        attemptId: 'wake-attempt',
        generation: 3,
        cause: 'timeout',
      }),
      event(3, 'run.started', { attemptId: 'wake-attempt' }),
      event(4, 'model.requested', { modelId: 'model-a' }),
      event(5, 'run.delivered', { messageId: 'message-a' }),
    ];

    expect(quotaWakeStateFromEvents(events, 'wake-attempt')).toBeUndefined();
    expect(quotaRequestFromEvents(events)).toBeUndefined();
  });

  it('matches a waking attempt after the original run start and model request', () => {
    const events = [
      event(1, 'run.started', { attemptId: 'original-attempt' }),
      event(2, 'model.requested', { modelId: 'model-a' }),
      event(3, 'run.suspended', quotaPayload()),
      event(4, 'run.resumed', {
        kind: 'quota',
        attemptId: 'wake-attempt',
        generation: 3,
        cause: 'timeout',
      }),
      event(5, 'run.started', { attemptId: 'wake-attempt' }),
    ];

    expect(quotaWakeStateFromEvents(events, 'wake-attempt')).toEqual({
      parts: [{ type: 'text', text: 'before wait', step: 4 }],
    });
  });

  it('accepts each durable quota failure class and resume position', () => {
    for (const failureClass of ['rate_limited', 'quota_exhausted']) {
      for (const resumeAt of [
        'request',
        'preDispatch',
        'boundary',
        'finalAnswer',
        'compactionRun',
      ]) {
        expect(
          quotaRequestFromEvents([
            event(1, 'run.suspended', {
              ...quotaPayload(1, 1, resumeAt),
              failureClass,
            }),
          ]),
        ).toEqual({ resumeAt, waitCount: 1, generation: 1 });
      }
    }
  });

  it('rejects unknown quota failure classes and any invalid checkpoint part', () => {
    expect(
      quotaRequestFromEvents([
        event(1, 'run.suspended', {
          ...quotaPayload(),
          failureClass: 'unknown',
        }),
      ]),
    ).toBeUndefined();
    expect(
      quotaRequestFromEvents([
        event(1, 'run.suspended', {
          ...quotaPayload(),
          parts: [{ type: 'text', text: 'valid part' }, null],
        }),
      ]),
    ).toBeUndefined();
  });

  it('restores only the quota checkpoint after the latest delivery boundary', () => {
    const events = [
      quotaSuspension(3),
      event(2, 'run.resumed', {
        kind: 'quota',
        attemptId: 'old-wake',
        generation: 3,
        cause: 'timeout',
      }),
      event(3, 'run.started', { attemptId: 'old-wake' }),
      event(4, 'run.delivered', {}),
      event(5, 'run.suspended', {
        ...quotaPayload(4),
        parts: [{ type: 'tool-bash', toolCallId: 'tool-b' }],
        steps: { 'tool-b': 2 },
      }),
      event(6, 'run.resumed', {
        kind: 'quota',
        attemptId: 'new-wake',
        generation: 4,
        cause: 'timeout',
      }),
      event(7, 'run.started', { attemptId: 'new-wake' }),
    ];

    expect(quotaWakeStateFromEvents(events, 'new-wake')).toEqual({
      parts: [{ type: 'tool-bash', toolCallId: 'tool-b', step: 2 }],
    });
    expect(quotaWakeStateFromEvents(events, 'old-wake')).toBeUndefined();
  });

  it('rejects absent or non-record checkpoint parts and invalid step maps', () => {
    const validWake = [
      quotaSuspension(),
      event(2, 'run.resumed', {
        kind: 'quota',
        attemptId: 'wake-attempt',
        generation: 3,
        cause: 'timeout',
      }),
      event(3, 'run.started', { attemptId: 'wake-attempt' }),
    ];

    expect(
      quotaWakeStateFromEvents(
        [
          event(1, 'run.suspended', {
            ...quotaPayload(),
            parts: undefined,
          }),
          ...validWake.slice(1),
        ],
        'wake-attempt',
      ),
    ).toBeUndefined();
    expect(
      quotaWakeStateFromEvents(
        [
          event(1, 'run.suspended', {
            ...quotaPayload(),
            parts: [{ type: 'text', text: 'valid' }, null],
          }),
          ...validWake.slice(1),
        ],
        'wake-attempt',
      ),
    ).toBeUndefined();
    expect(
      quotaWakeStateFromEvents(
        [
          event(1, 'run.suspended', {
            ...quotaPayload(),
            steps: { 'tool-a': 4, invalid: 'step' },
          }),
          ...validWake.slice(1),
        ],
        'wake-attempt',
      ),
    ).toBeUndefined();

    expect(
      quotaWakeStateFromEvents(
        [
          event(1, 'run.suspended', {
            ...quotaPayload(),
            parts: [{ type: 'tool-bash', toolCallId: 'tool-a' }],
            steps: { 'tool-a': 0 },
          }),
          ...validWake.slice(1),
        ],
        'wake-attempt',
      ),
    ).toEqual({
      parts: [{ type: 'tool-bash', toolCallId: 'tool-a', step: 0 }],
    });
    expect(
      quotaRequestFromEvents([
        event(1, 'run.suspended', {
          ...quotaPayload(),
          steps: { 'tool-a': 1.5 },
        }),
      ]),
    ).toBeUndefined();
    expect(
      quotaRequestFromEvents([
        event(1, 'run.suspended', {
          ...quotaPayload(),
          steps: { 'tool-a': -1 },
        }),
      ]),
    ).toBeUndefined();
  });

  it('validates quota reset and wake timestamps and requires exact recovery linkage', () => {
    for (const invalidTimestamp of ['not-a-time', '']) {
      expect(
        quotaRequestFromEvents([
          event(1, 'run.suspended', {
            ...quotaPayload(),
            resetsAt: invalidTimestamp,
          }),
        ]),
      ).toBeUndefined();
      expect(
        quotaRequestFromEvents([
          event(1, 'run.suspended', {
            ...quotaPayload(),
            wakeAt: invalidTimestamp,
          }),
        ]),
      ).toBeUndefined();
    }

    const suspension = quotaSuspension(3, 2, 'boundary');
    expect(
      quotaRequestFromEvents([
        suspension,
        event(2, 'run.quota_recovered', {
          generation: 4,
          resumeAt: 'boundary',
        }),
      ]),
    ).toEqual({ resumeAt: 'boundary', waitCount: 2, generation: 3 });
  });

  it('ignores recovery records that do not carry a numeric generation', () => {
    const suspension = quotaSuspension(3, 2, 'boundary');

    expect(
      quotaRequestFromEvents([
        suspension,
        event(2, 'run.quota_recovered', {
          generation: '3',
          resumeAt: 'boundary',
        }),
      ]),
    ).toEqual({ resumeAt: 'boundary', waitCount: 2, generation: 3 });
  });

  it('skips unreadable durable payloads instead of losing the open quota request', () => {
    const suspension = quotaSuspension(3, 2, 'boundary');

    expect(
      quotaRequestFromEvents([suspension, event(2, 'run.suspended', null)]),
    ).toEqual({ resumeAt: 'boundary', waitCount: 2, generation: 3 });
  });

  it('rejects out-of-range generations, wait counts, and resume positions', () => {
    for (const override of [
      { generation: 0 },
      { waitCount: 0 },
      { resumeAt: 'not-a-position' },
    ]) {
      expect(
        quotaRequestFromEvents([
          event(1, 'run.suspended', { ...quotaPayload(), ...override }),
        ]),
      ).toBeUndefined();
    }
  });
});

const skillBaseline = {
  baseline: {
    entries: [{ name: 'review', description: 'Reviews a diff' }],
    omitted: 2,
  },
  rebakedFrom: '2026-09-01T00:00:00.000Z',
  told: ['review'],
};

function resumedClaim(
  sequence: number,
  attemptId: string,
  generation: number,
): RunEvent {
  return event(sequence, 'run.resumed', {
    kind: 'quota',
    attemptId,
    generation,
    cause: 'timeout',
  });
}

function startedAttempt(sequence: number, attemptId: string): RunEvent {
  return event(sequence, 'run.started', { attemptId });
}

describe('quota wait cut projection', () => {
  const request = {
    resumeAt: 'request' as const,
    waitCount: 1,
    generation: 3,
  };

  it('reports no cut without a quota request', () => {
    expect(quotaWaitCutFromEvents([], undefined)).toBe(false);
  });

  it('ignores a suspension of another generation', () => {
    expect(
      quotaWaitCutFromEvents(
        [
          event(1, 'run.suspended', {
            ...quotaPayload(4),
            superseded: { fromSequence: 2, step: 0 },
          }),
        ],
        request,
      ),
    ).toBe(false);
  });

  it('reports no cut when no suspension matches the request', () => {
    expect(
      quotaWaitCutFromEvents([startedAttempt(1, 'wake-attempt')], request),
    ).toBe(false);
  });

  it('requires the matching suspension to carry the cut', () => {
    expect(quotaWaitCutFromEvents([quotaSuspension()], request)).toBe(false);
    expect(
      quotaWaitCutFromEvents(
        [
          event(1, 'run.suspended', {
            ...quotaPayload(),
            superseded: { fromSequence: 2, step: 0 },
          }),
        ],
        request,
      ),
    ).toBe(true);
  });
});

describe('quota summary wake ownership', () => {
  it.each(['boundary', 'finalAnswer'])(
    'keeps the saved %s summary reply after its own recovery commits',
    (resumeAt) => {
      const events = [
        quotaSuspension(3, 3, resumeAt),
        resumedClaim(2, 'wake-attempt', 3),
        startedAttempt(3, 'wake-attempt'),
        event(4, 'run.quota_recovered', { generation: 3, resumeAt }),
      ];

      expect(quotaRequestFromEvents(events)).toBeUndefined();
      expect(quotaSummaryWakeFromEvents(events, 'wake-attempt')).toBe(true);
      expect(
        quotaSummaryWakeFromEvents(
          [...events, startedAttempt(5, 'redelivery')],
          'redelivery',
        ),
      ).toBe(false);
    },
  );

  it('refuses summary ownership to ordinary and foreign wake claims', () => {
    const legacyJobWait = [
      event(1, 'run.suspended', {
        attemptId: 'suspended-attempt',
        generation: 3,
        toolCallId: 'tool-1',
        parts: [{ type: 'text', text: 'legacy jobs', step: 0 }],
        steps: {},
        awaiting: {},
      }),
      resumedClaim(2, 'wake-attempt', 3),
      startedAttempt(3, 'wake-attempt'),
    ];

    expect(quotaSummaryWakeFromEvents(legacyJobWait, 'wake-attempt')).toBe(
      false,
    );

    expect(
      quotaSummaryWakeFromEvents(
        [
          quotaSuspension(3, 2, 'preDispatch'),
          resumedClaim(2, 'wake-attempt', 3),
          startedAttempt(3, 'wake-attempt'),
        ],
        'wake-attempt',
      ),
    ).toBe(false);

    expect(
      quotaSummaryWakeFromEvents(
        [
          quotaSuspension(3, 2, 'compactionRun'),
          resumedClaim(2, 'wake-attempt', 3),
          startedAttempt(3, 'wake-attempt'),
        ],
        'wake-attempt',
      ),
    ).toBe(false);

    expect(
      quotaSummaryWakeFromEvents(
        [quotaSuspension(3, 2, 'boundary'), startedAttempt(2, 'other-attempt')],
        'wake-attempt',
      ),
    ).toBe(false);

    expect(
      quotaSummaryWakeFromEvents(
        [
          quotaSuspension(3, 2, 'boundary'),
          startedAttempt(2, 'wake-attempt'),
          startedAttempt(3, 'redelivery'),
        ],
        'wake-attempt',
      ),
    ).toBe(false);
  });

  it('keeps an open summary with the latest attempt after redelivery', () => {
    const events = [
      quotaSuspension(3, 2, 'boundary'),
      resumedClaim(2, 'wake-attempt', 3),
      startedAttempt(3, 'wake-attempt'),
      startedAttempt(4, 'retry-attempt'),
    ];

    expect(quotaSummaryWakeFromEvents(events, 'retry-attempt')).toBe(true);
  });
});

describe('quota summary checkpoint attribution', () => {
  it('preserves the last readable checkpoint when a later record is malformed', () => {
    const events = [
      event(1, 'run.suspended', {
        ...quotaPayload(1, 1, 'boundary'),
        parts: [{ type: 'text', text: 'saved boundary reply', step: 0 }],
        steps: {},
      }),
      resumedClaim(2, 'wake-attempt', 1),
      startedAttempt(3, 'wake-attempt'),
      event(4, 'run.suspended', {
        ...quotaPayload(2, 2, 'boundary'),
        failureClass: 'unknown',
        parts: [{ type: 'text', text: 'unreadable reply', step: 1 }],
        steps: {},
      }),
    ];

    const request = quotaRequestFromEvents(events);

    expect(request?.generation).toBe(1);
    expect(quotaCompactionStateFromEvents(events, request)).toEqual({
      parts: [{ type: 'text', text: 'saved boundary reply', step: 0 }],
    });
  });
});

describe('quota checkpoint metadata projection', () => {
  const summaryCheckpoint = {
    ...quotaPayload(5, 2, 'boundary'),
    boundaryMode: 'automatic',
    stepBudgetUsed: 12,
    summaryAttemptId: 'summary-attempt',
    summaryPrefixFingerprint: 'sha256:prefix',
    stoppedCalls: [{ toolName: 'bash', toolCallId: 'call-1' }],
  };

  it('carries every boundary checkpoint field of the open request', () => {
    expect(
      quotaRequestFromEvents([event(1, 'run.suspended', summaryCheckpoint)]),
    ).toEqual({
      resumeAt: 'boundary',
      waitCount: 2,
      generation: 5,
      boundaryMode: 'automatic',
      stepBudgetUsed: 12,
      summaryAttemptId: 'summary-attempt',
      summaryPrefixFingerprint: 'sha256:prefix',
      stoppedCalls: [{ toolName: 'bash', toolCallId: 'call-1' }],
    });
  });

  it('drops the boundary-only mode and stop list from a final-answer request', () => {
    expect(
      quotaRequestFromEvents([
        event(1, 'run.suspended', {
          ...summaryCheckpoint,
          resumeAt: 'finalAnswer',
          boundaryMode: 'owner',
        }),
      ]),
    ).toEqual({
      resumeAt: 'finalAnswer',
      waitCount: 2,
      generation: 5,
      stepBudgetUsed: 12,
      summaryAttemptId: 'summary-attempt',
      summaryPrefixFingerprint: 'sha256:prefix',
    });
  });

  it('keeps a skill catalog freeze without a recency digest baseline', () => {
    const baselines = { skillCatalogFreeze: skillBaseline };

    expect(
      quotaRequestFromEvents([
        event(1, 'run.suspended', {
          ...quotaPayload(3, 2, 'boundary'),
          baselines,
        }),
      ]),
    ).toEqual({
      resumeAt: 'boundary',
      waitCount: 2,
      generation: 3,
      baselines,
    });
  });
});
