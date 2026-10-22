import * as Sentry from '@sentry/nestjs';

import { processTraced, publishTraced } from './job-trace';

vi.mock('@sentry/nestjs', () => ({
  startSpan: vi.fn(),
  getTraceData: vi.fn(),
  continueTrace: vi.fn(),
  withIsolationScope: vi.fn(),
  captureException: vi.fn(),
}));

const TRACE = {
  'sentry-trace': '0123456789abcdef0123456789abcdef-0123456789abcdef-1',
  baggage: 'sentry-trace_id=0123456789abcdef0123456789abcdef',
};

const span = { setAttribute: vi.fn() };

beforeEach(() => {
  vi.mocked(Sentry.startSpan).mockImplementation((_options, callback) =>
    // SAFETY: the code under test only calls `setAttribute` on its span.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    callback(span as never),
  );
  vi.mocked(Sentry.continueTrace).mockImplementation((_trace, callback) =>
    callback(),
  );
  vi.mocked(Sentry.withIsolationScope).mockImplementation(
    // SAFETY: the code under test passes one callback and ignores the scope.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    ((callback: () => Promise<void>) => callback()) as never,
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('publishTraced', () => {
  it('sends the active trace with the payload inside a queue.publish span', async () => {
    vi.mocked(Sentry.getTraceData).mockReturnValue(TRACE);
    const send = vi.fn().mockResolvedValue('job-1');

    await expect(publishTraced('runs', { runId: 'r1' }, send)).resolves.toBe(
      'job-1',
    );

    const payload = { runId: 'r1', _trace: TRACE };
    expect(send).toHaveBeenCalledWith(payload);
    expect(Sentry.startSpan).toHaveBeenCalledWith(
      {
        name: 'send runs',
        op: 'queue.publish',
        attributes: {
          'messaging.system': 'pg-boss',
          'messaging.operation.name': 'send',
          'messaging.operation.type': 'send',
          'messaging.destination.name': 'runs',
        },
      },
      expect.any(Function),
    );
    expect(span.setAttribute.mock.calls).toEqual([
      [
        'messaging.message.body.size',
        Buffer.byteLength(JSON.stringify(payload)),
      ],
      ['messaging.message.id', 'job-1'],
    ]);
  });

  it('sends the payload unchanged when there is no trace, and no id for a coalesced send', async () => {
    vi.mocked(Sentry.getTraceData).mockReturnValue({});
    const data = { runId: 'r1' };
    const send = vi.fn().mockResolvedValue(null);

    await expect(publishTraced('runs', data, send)).resolves.toBeNull();

    expect(send.mock.calls[0]?.[0]).toBe(data);
    expect(span.setAttribute.mock.calls).toEqual([
      ['messaging.message.body.size', Buffer.byteLength(JSON.stringify(data))],
    ]);
  });
});

describe('processTraced', () => {
  const job = {
    id: 'job-1',
    data: { runId: 'r1', _trace: TRACE },
    retryCount: 2,
    createdOn: new Date(1000),
    startedOn: new Date(1250),
  };

  it("runs the job in its own scope as a queue.process transaction on the sender's trace", async () => {
    const work = vi.fn().mockResolvedValue(undefined);

    await processTraced('runs', job, work);

    expect(work).toHaveBeenCalledOnce();
    expect(Sentry.withIsolationScope).toHaveBeenCalledOnce();
    expect(Sentry.continueTrace).toHaveBeenCalledWith(
      { sentryTrace: TRACE['sentry-trace'], baggage: TRACE.baggage },
      expect.any(Function),
    );
    expect(Sentry.startSpan).toHaveBeenCalledWith(
      {
        name: 'process runs',
        op: 'queue.process',
        forceTransaction: true,
        attributes: {
          'messaging.system': 'pg-boss',
          'messaging.operation.name': 'process',
          'messaging.operation.type': 'process',
          'messaging.destination.name': 'runs',
          'messaging.message.id': 'job-1',
          'messaging.message.body.size': Buffer.byteLength(
            JSON.stringify(job.data),
          ),
          'messaging.message.retry.count': 2,
          'messaging.message.receive.latency': 250,
        },
      },
      expect.any(Function),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('starts a new trace for a job sent without one', async () => {
    await processTraced(
      'runs',
      { ...job, data: { runId: 'r1' } },
      vi.fn().mockResolvedValue(undefined),
    );

    expect(Sentry.continueTrace).toHaveBeenCalledWith(
      { sentryTrace: undefined, baggage: undefined },
      expect.any(Function),
    );
  });

  it('reports a failed attempt and rethrows it for the retry policy', async () => {
    const failure = new Error('handler failed');

    await expect(
      processTraced('runs', job, vi.fn().mockRejectedValue(failure)),
    ).rejects.toBe(failure);

    expect(Sentry.captureException).toHaveBeenCalledWith(failure);
  });
});
