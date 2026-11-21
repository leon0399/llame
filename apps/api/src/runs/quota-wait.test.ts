import { ProviderFailure } from '../models/provider-failure/provider-failure';
import { quotaWaitForFailure } from './quota-wait';

const now = Date.parse('2026-11-19T00:00:00Z');
const cap = 691_200;

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => vi.restoreAllMocks());

it.each([60_001, cap * 1000])(
  'admits a reset %i ms away with a persisted grace and jitter',
  (delay) => {
    const failure = new ProviderFailure('Usage limit', {
      code: 'quota_exhausted',
      resetsAt: now + delay,
    });

    expect(quotaWaitForFailure(failure, cap, undefined)).toEqual({
      kind: 'quota',
      failureClass: 'quota_exhausted',
      resetsAt: new Date(now + delay).toISOString(),
      wakeAt: new Date(now + delay + 69_000).toISOString(),
      resumeAt: 'request',
      waitCount: 1,
    });
  },
);

it.each([0, 60_000, cap * 1000 + 1])(
  'does not park a reset %i ms away',
  (delay) => {
    expect(
      quotaWaitForFailure(
        new ProviderFailure('Usage limit', {
          code: 'rate_limited',
          resetsAt: now + delay,
        }),
        cap,
        undefined,
      ),
    ).toBeUndefined();
  },
);

it('preserves a recovered request allowance and ends it after four waits', () => {
  const failure = new ProviderFailure('Usage limit', {
    code: 'rate_limited',
    resetsAt: now + 3_600_000,
  });

  const request = { resumeAt: 'request' as const, waitCount: 3, generation: 7 };
  expect(quotaWaitForFailure(failure, cap, request)).toMatchObject({
    waitCount: 4,
  });
  expect(
    quotaWaitForFailure(failure, cap, { ...request, waitCount: 4 }),
  ).toBeUndefined();
});

it('never parks after a complete tool call or without an authoritative reset', () => {
  expect(
    quotaWaitForFailure(
      new ProviderFailure('Usage limit', {
        code: 'quota_exhausted',
        resetsAt: now + 3_600_000,
        toolCallStarted: true,
      }),
      cap,
      undefined,
    ),
  ).toBeUndefined();
  expect(
    quotaWaitForFailure(
      new ProviderFailure('Usage limit', {
        code: 'quota_exhausted',
        hintMs: 3_600_000,
      }),
      cap,
      undefined,
    ),
  ).toBeUndefined();
  expect(
    quotaWaitForFailure(
      new ProviderFailure('Billing limit', {
        code: 'billing',
        resetsAt: now + 3_600_000,
      }),
      cap,
      undefined,
    ),
  ).toBeUndefined();
});

it('accepts a started call only for the after-cut mode', () => {
  const failure = new ProviderFailure('Usage limit', {
    code: 'rate_limited',
    resetsAt: now + 3_600_000,
    toolCallStarted: true,
  });

  expect(quotaWaitForFailure(failure, cap, undefined)).toBeUndefined();
  expect(
    quotaWaitForFailure(failure, cap, undefined, { afterCut: true }),
  ).toMatchObject({ failureClass: 'rate_limited', waitCount: 1 });

  // The cut mode waives the started-call refusal alone: the class, the reset
  // range, and the absence of a reset still refuse.
  const afterCut = { afterCut: true };

  expect(
    quotaWaitForFailure(
      new ProviderFailure('Billing limit', {
        code: 'billing',
        resetsAt: now + 3_600_000,
        toolCallStarted: true,
      }),
      cap,
      undefined,
      afterCut,
    ),
  ).toBeUndefined();
  expect(
    quotaWaitForFailure(
      new ProviderFailure('Usage limit', {
        code: 'quota_exhausted',
        resetsAt: now + cap * 1000 + 1,
        toolCallStarted: true,
      }),
      cap,
      undefined,
      afterCut,
    ),
  ).toBeUndefined();
  expect(
    quotaWaitForFailure(
      new ProviderFailure('Usage limit', {
        code: 'quota_exhausted',
        resetsAt: now + 60_000,
        toolCallStarted: true,
      }),
      cap,
      undefined,
      afterCut,
    ),
  ).toBeUndefined();
  expect(
    quotaWaitForFailure(
      new ProviderFailure('Usage limit', {
        code: 'quota_exhausted',
        toolCallStarted: true,
      }),
      cap,
      undefined,
      afterCut,
    ),
  ).toBeUndefined();
  expect(
    quotaWaitForFailure(
      new ProviderFailure('Usage limit', {
        code: 'rate_limited',
        resetsAt: now + 3_600_000,
        toolCallStarted: true,
      }),
      cap,
      { resumeAt: 'request', waitCount: 4, generation: 6 },
      afterCut,
    ),
  ).toBeUndefined();
});

it('carries the wait count of the request it continues after a cut', () => {
  expect(
    quotaWaitForFailure(
      new ProviderFailure('Usage limit', {
        code: 'quota_exhausted',
        resetsAt: now + 3_600_000,
        toolCallStarted: true,
      }),
      cap,
      { resumeAt: 'request', waitCount: 1, generation: 4 },
      { afterCut: true },
    ),
  ).toMatchObject({ waitCount: 2, resumeAt: 'request' });
});
