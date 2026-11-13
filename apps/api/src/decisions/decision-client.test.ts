import { z } from 'zod';

import { type SystemOneProviderConfig } from '../instance-config/llame-config';
import { createAttemptSlots } from './attempt-slots';
import { createDecisionClient } from './decision-client';
import {
  DECISION_RESPONSE_MAX_BYTES,
  type DecisionQuestions,
} from './decision-protocol';

const KEY = 'sk-decision-secret';

const QUESTIONS: DecisionQuestions = {
  p0: {
    type: 'noul',
    instructions: 'Does card p0 help?',
    criteria: { true: 'yes', false: 'no' },
  },
  p1: {
    type: 'noul',
    instructions: 'Does card p1 help?',
    criteria: { true: 'yes', false: 'no' },
  },
};

const ANSWERS = {
  p0: { type: 'noul', noul: 0.9 },
  p1: { type: 'noul', noul: 0.1 },
};

type Envelope = {
  model?: unknown;
  answers?: unknown;
  usage?: unknown;
  id?: unknown;
  provider?: unknown;
  extra?: unknown;
  pad?: unknown;
  padding?: unknown;
};

function okBody(overrides: Envelope = {}) {
  return {
    model: 'jev-1.14-20261014',
    answers: ANSWERS,
    usage: { input_tokens: 514, output_tokens: 104, cost: 0.002 },
    ...overrides,
  };
}

function provider(
  overrides: Partial<SystemOneProviderConfig> = {},
): SystemOneProviderConfig {
  return {
    id: 'judge',
    type: 'system-one',
    key: KEY,
    baseUrl: 'https://judge.example/v1',
    headers: {},
    maxConcurrentRequests: 4,
    ...overrides,
  };
}

function json(body: Envelope, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

type Call = { url: string; init: RequestInit };

function bodyText(call: Call | undefined): string {
  return z.string().parse(call?.init.body);
}

function scripted(
  handler: (index: number, call: Call) => Response | Promise<Response>,
) {
  const calls: Array<Call> = [];

  const fetch = async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);

    return handler(calls.length - 1, call);
  };

  return { calls, fetch };
}

/** A sleep that records its waits and returns at once. */
function recordedSleep() {
  const waits: Array<number> = [];

  return {
    waits,
    sleep: (ms: number) => {
      waits.push(ms);

      return Promise.resolve();
    },
  };
}

function decide(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  extra: Parameters<typeof createDecisionClient>[2] = {},
  signal?: AbortSignal,
  config: SystemOneProviderConfig = provider(),
) {
  return createDecisionClient(config, 'jev-latest', {
    fetch,
    sleep: () => Promise.resolve(),
    ...extra,
  }).decide({
    state: { query: 'retry' },
    questions: QUESTIONS,
    ...(signal !== undefined && { signal }),
  });
}

function streamOf(chunks: ReadonlyArray<Uint8Array>, onCancel: () => void) {
  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;

      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
    cancel: onCancel,
  });
}

describe('decision client request', () => {
  it('posts {model,state,questions} to {baseUrl}/systemone with a bearer key', async () => {
    const { calls, fetch } = scripted(() => json(okBody()));
    await decide(
      fetch,
      {},
      undefined,
      provider({ headers: { 'x-team': ['a', 'b'] } }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://judge.example/v1/systemone');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: `Bearer ${KEY}`,
      'x-team': 'ab',
    });
    expect(JSON.parse(bodyText(calls[0]))).toEqual({
      model: 'jev-latest',
      state: { query: 'retry' },
      questions: QUESTIONS,
    });
  });

  it('strips every trailing slash before appending the route', async () => {
    const { calls, fetch } = scripted(() => json(okBody()));
    await decide(
      fetch,
      {},
      undefined,
      provider({ baseUrl: 'https://judge.example/v1///' }),
    );
    expect(calls[0]?.url).toBe('https://judge.example/v1/systemone');
  });

  it('lets an operator header replace a client-set one, ignoring case', async () => {
    const { calls, fetch } = scripted(() => json(okBody()));
    await decide(
      fetch,
      {},
      undefined,
      provider({ headers: { Authorization: ['Bearer other'] } }),
    );

    const headers = z
      .record(z.string(), z.string())
      .parse(calls[0]?.init.headers);

    const auth = Object.entries(headers).filter(
      ([name]) => name.toLowerCase() === 'authorization',
    );

    expect(auth).toEqual([['Authorization', 'Bearer other']]);
  });

  it('refuses redirects without a second call', async () => {
    let cancelled = false;

    const { calls, fetch } = scripted(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
          }),
          { status: 307, headers: { location: 'https://evil.example/' } },
        ),
    );

    await expect(decide(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'rejected',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(cancelled).toBe(true);
  });
});

describe('decision client answers', () => {
  it('returns answers, the served model, and wire usage, ignoring extra fields', async () => {
    const { fetch } = scripted(() =>
      json(okBody({ id: 'gen-1', provider: 'X', extra: { a: 1 } })),
    );

    await expect(decide(fetch)).resolves.toMatchObject({
      status: 'answered',
      model: 'jev-1.14-20261014',
      answers: ANSWERS,
      usage: { inputTokens: 514, outputTokens: 104, costUsd: 0.002 },
    });
  });

  it('reports costUsd null when the wire carries no cost', async () => {
    const { fetch } = scripted(() =>
      json(okBody({ usage: { input_tokens: 10, output_tokens: 2 } })),
    );

    await expect(decide(fetch)).resolves.toMatchObject({
      status: 'answered',
      usage: { inputTokens: 10, outputTokens: 2, costUsd: null },
    });
  });

  it.each([
    ['absent answer', { answers: { p0: ANSWERS.p0 } }],
    [
      'wrong answer type',
      { answers: { ...ANSWERS, p1: { type: 'choice', noul: 0.1 } } },
    ],
    [
      'string probability',
      { answers: { ...ANSWERS, p1: { type: 'noul', noul: '0.1' } } },
    ],
    [
      'probability above 1',
      { answers: { ...ANSWERS, p1: { type: 'noul', noul: 1.01 } } },
    ],
    [
      'probability below 0',
      { answers: { ...ANSWERS, p1: { type: 'noul', noul: -0.01 } } },
    ],
    ['empty model', { model: '' }],
    ['non-string model', { model: 3 }],
    ['absent usage', { usage: undefined }],
    ['non-object usage', { usage: 'x' }],
  ])('makes the request unavailable on %s', async (_name, overrides) => {
    const { calls, fetch } = scripted(() => json(okBody(overrides)));
    await expect(decide(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    expect(calls).toHaveLength(1);
  });

  it('makes the request unavailable on a non-JSON body', async () => {
    const { fetch } = scripted(() => new Response('<html>'));
    await expect(decide(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });
});

describe('decision client usage validation', () => {
  it.each([
    ['missing input_tokens', { output_tokens: 1 }],
    ['missing output_tokens', { input_tokens: 1 }],
    ['negative input', { input_tokens: -1, output_tokens: 1 }],
    ['fractional output', { input_tokens: 1, output_tokens: 1.5 }],
    ['unsafe input', { input_tokens: 2 ** 53, output_tokens: 1 }],
    ['negative cost', { input_tokens: 1, output_tokens: 1, cost: -0.1 }],
    ['null cost', { input_tokens: 1, output_tokens: 1, cost: null }],
    ['string cost', { input_tokens: 1, output_tokens: 1, cost: '0.1' }],
  ])('rejects %s', async (_name, usage) => {
    const { fetch } = scripted(() => json(okBody({ usage })));
    await expect(decide(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('rejects a nonfinite cost', async () => {
    const text = JSON.stringify(okBody()).replace(
      '"cost":0.002',
      '"cost":1e999',
    );

    const { fetch } = scripted(() => new Response(text));
    await expect(decide(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('accepts the numeric bounds', async () => {
    const usage = {
      input_tokens: 0,
      output_tokens: Number.MAX_SAFE_INTEGER,
      cost: 0,
    };

    const { fetch } = scripted(() => json(okBody({ usage })));
    await expect(decide(fetch)).resolves.toMatchObject({
      status: 'answered',
      usage: {
        inputTokens: 0,
        outputTokens: Number.MAX_SAFE_INTEGER,
        costUsd: 0,
      },
    });
  });
});

describe('decision client credential safety', () => {
  it('makes the request unavailable when the served model contains the key', async () => {
    const { fetch } = scripted(() =>
      json(okBody({ model: `prefix-${KEY}-suffix` })),
    );

    const outcome = await decide(fetch);
    expect(outcome).toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });

  it('keeps the key out of the outcome when fetch throws it', async () => {
    const { fetch } = scripted(() => {
      throw new Error(`failed with ${KEY}`);
    });

    const outcome = await decide(fetch);
    expect(outcome.status).toBe('unavailable');
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });
});

describe('decision client body bound', () => {
  it('cancels a stream without Content-Length at the byte bound', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(0x20);

    const chunks = Array.from(
      { length: DECISION_RESPONSE_MAX_BYTES / chunk.byteLength + 8 },
      () => chunk,
    );

    const { fetch } = scripted(
      () =>
        new Response(
          streamOf(chunks, () => {
            cancelled = true;
          }),
        ),
    );

    await expect(decide(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    expect(cancelled).toBe(true);
  });

  it('counts bytes, not code units', async () => {
    // '€' is 3 bytes but 1 code unit: under the bound in units, over in bytes.
    const padding = '€'.repeat(DECISION_RESPONSE_MAX_BYTES / 3 + 1);
    const { fetch } = scripted(() => json(okBody({ model: 'm', padding })));
    await expect(decide(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('accepts a body of exactly the bound', async () => {
    const base = JSON.stringify(okBody({ pad: '' }));
    const pad = 'x'.repeat(DECISION_RESPONSE_MAX_BYTES - base.length);
    const text = JSON.stringify(okBody({ pad }));
    expect(new TextEncoder().encode(text).byteLength).toBe(
      DECISION_RESPONSE_MAX_BYTES,
    );
    const { fetch } = scripted(() => new Response(text));
    await expect(decide(fetch)).resolves.toMatchObject({ status: 'answered' });
  });
});

describe('decision client retries', () => {
  it('retries when the body stream errors', async () => {
    const { calls, fetch } = scripted((index) =>
      index === 0
        ? new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.error(new Error('reset'));
              },
            }),
          )
        : json(okBody()),
    );

    await expect(decide(fetch)).resolves.toMatchObject({ status: 'answered' });
    expect(calls).toHaveLength(2);
  });

  it('rejects a served model id outside printable ASCII or over 256', async () => {
    for (const model of ['has space', 'é', 'x'.repeat(257)]) {
      const { fetch } = scripted(() => json(okBody({ model })));
      await expect(decide(fetch)).resolves.toMatchObject({
        status: 'unavailable',
        reason: 'invalid_response',
      });
    }
  });

  it('reads an HTTP-date retry-after against the injected clock', async () => {
    const now = Date.parse('2026-11-06T10:00:00Z');

    const { fetch } = scripted((index) =>
      index < 2
        ? new Response('', {
            status: 429,
            headers: {
              'retry-after': new Date(
                now + (index === 0 ? 2000 : -5000),
              ).toUTCString(),
            },
          })
        : json(okBody()),
    );

    const { waits, sleep } = recordedSleep();
    await decide(fetch, { sleep, now: () => now });
    expect(waits).toEqual([2000, 0]);
  });

  it('retries 503 and accepts the second response', async () => {
    const { calls, fetch } = scripted((index) =>
      index === 0 ? new Response('', { status: 503 }) : json(okBody()),
    );

    const { waits, sleep } = recordedSleep();
    await expect(decide(fetch, { sleep })).resolves.toMatchObject({
      status: 'answered',
    });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([500]);
  });

  it.each([408, 429, 500, 502])('retries status %i', async (status) => {
    const { calls, fetch } = scripted((index) =>
      index === 0 ? new Response('', { status }) : json(okBody()),
    );

    await decide(fetch);
    expect(calls).toHaveLength(2);
  });

  it('retries a transport failure', async () => {
    const { calls, fetch } = scripted((index) => {
      if (index === 0) throw new TypeError('socket hang up');

      return json(okBody());
    });

    await expect(decide(fetch)).resolves.toMatchObject({ status: 'answered' });
    expect(calls).toHaveLength(2);
  });

  it.each([400, 401, 402, 403, 404, 413, 422])(
    'does not retry status %i',
    async (status) => {
      const { calls, fetch } = scripted(() => new Response('', { status }));
      await expect(decide(fetch)).resolves.toMatchObject({
        status: 'unavailable',
        reason: 'rejected',
      });
      expect(calls).toHaveLength(1);
    },
  );

  it('does not retry a malformed answer', async () => {
    const { calls, fetch } = scripted(() => json({}));
    await decide(fetch);
    expect(calls).toHaveLength(1);
  });

  it('stops after three attempts with the last reason', async () => {
    const { calls, fetch } = scripted(() => new Response('', { status: 429 }));
    const { waits, sleep } = recordedSleep();
    await expect(decide(fetch, { sleep })).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'rate_limited',
    });
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([500, 1000]);
  });

  it('honours retry-after seconds and caps it at five seconds', async () => {
    const { fetch } = scripted((index) =>
      index < 2
        ? new Response('', {
            status: 429,
            headers: { 'retry-after': index === 0 ? '2' : '120' },
          })
        : json(okBody()),
    );

    const { waits, sleep } = recordedSleep();
    await decide(fetch, { sleep });
    expect(waits).toEqual([2000, 5000]);
  });

  it('treats a blank retry-after as absent and waits the full backoff', async () => {
    const { fetch } = scripted((index) =>
      index === 0
        ? new Response('', { status: 429, headers: { 'retry-after': '' } })
        : json(okBody()),
    );

    const { waits, sleep } = recordedSleep();
    await decide(fetch, { sleep });
    expect(waits).toEqual([500]);
  });

  it('times each attempt out and retries it', async () => {
    const { calls, fetch } = scripted((index, call) =>
      index === 0
        ? new Promise<Response>((_resolve, reject) => {
            call.init.signal?.addEventListener('abort', () => {
              reject(new DOMException('timed out', 'TimeoutError'));
            });
          })
        : json(okBody()),
    );

    await expect(
      decide(fetch, { attemptTimeoutMs: 20 }),
    ).resolves.toMatchObject({
      status: 'answered',
    });
    expect(calls).toHaveLength(2);
  });

  it('reports timeout when every attempt times out', async () => {
    const { calls, fetch } = scripted(
      (_index, call) =>
        new Promise<Response>((_resolve, reject) => {
          call.init.signal?.addEventListener('abort', () => {
            reject(new DOMException('timed out', 'TimeoutError'));
          });
        }),
    );

    await expect(
      decide(fetch, { attemptTimeoutMs: 10 }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'timeout',
    });
    expect(calls).toHaveLength(3);
  });
});

describe('decision client abort', () => {
  it('rejects with the abort and starts no request when already aborted', async () => {
    const { calls, fetch } = scripted(() => json(okBody()));
    const controller = new AbortController();
    controller.abort(new Error('run cancelled'));
    await expect(decide(fetch, {}, controller.signal)).rejects.toThrow(
      'run cancelled',
    );
    expect(calls).toHaveLength(0);
  });

  it('aborts the in-flight fetch and rejects instead of retrying', async () => {
    const controller = new AbortController();

    const { calls, fetch } = scripted(
      (_index, call) =>
        new Promise<Response>((_resolve, reject) => {
          call.init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
          controller.abort(new Error('deadline'));
        }),
    );

    await expect(decide(fetch, {}, controller.signal)).rejects.toThrow(
      'deadline',
    );
    expect(calls).toHaveLength(1);
  });

  it('stops a retry wait on abort and starts no retry', async () => {
    const controller = new AbortController();
    const { calls, fetch } = scripted(() => new Response('', { status: 503 }));

    // The real default sleep: 500 ms backoff, aborted after 20 ms.
    const pending = createDecisionClient(provider(), 'jev-latest', {
      fetch,
    }).decide({
      state: 'x',
      questions: QUESTIONS,
      signal: controller.signal,
    });

    const startedAt = Date.now();
    setTimeout(() => controller.abort(new Error('cancelled')), 20);
    await expect(pending).rejects.toThrow('cancelled');
    expect(Date.now() - startedAt).toBeLessThan(400);
    expect(calls).toHaveLength(1);
  });

  it('rejects when the signal aborts while the body is read', async () => {
    const controller = new AbortController();

    const { fetch } = scripted(() => {
      const body = new ReadableStream<Uint8Array>({
        pull() {
          controller.abort(new Error('mid-body'));
          throw new Error('stream broken');
        },
      });

      return new Response(body);
    });

    await expect(decide(fetch, {}, controller.signal)).rejects.toThrow(
      'mid-body',
    );
  });
});

describe('decision client truncation reports', () => {
  const BASE = { input_tokens: 1024, output_tokens: 0 };

  it.each([
    ['a truncated state', { ...BASE, truncated: true }],
    ['dropped state tokens', { ...BASE, state_tokens_dropped: 104 }],
    ['a string truncated', { ...BASE, truncated: 'true' }],
    ['a string dropped count', { ...BASE, state_tokens_dropped: '12' }],
    ['a negative dropped count', { ...BASE, state_tokens_dropped: -1 }],
    ['a fractional dropped count', { ...BASE, state_tokens_dropped: 0.5 }],
  ])('makes the request unavailable on %s', async (_name, usage) => {
    const { fetch } = scripted(() => json(okBody({ usage })));

    await expect(decide(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('accepts an explicit report of no truncation', async () => {
    const { fetch } = scripted(() =>
      json(
        okBody({
          usage: { ...BASE, truncated: false, state_tokens_dropped: 0 },
        }),
      ),
    );

    await expect(decide(fetch)).resolves.toMatchObject({ status: 'answered' });
  });

  it('accepts a response without truncation fields', async () => {
    const { fetch } = scripted(() => json(okBody({ usage: BASE })));

    await expect(decide(fetch)).resolves.toMatchObject({ status: 'answered' });
  });
});

describe('decision client attempt slots', () => {
  it('keeps attempts to one provider within its slots across clients', async () => {
    const slots = createAttemptSlots(2);
    let inFlight = 0;
    let peak = 0;

    const fetch = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;

      return json(okBody());
    };

    const outcomes = await Promise.all(
      Array.from({ length: 6 }, () => decide(fetch, { slots })),
    );

    expect(peak).toBe(2);
    expect(outcomes.every((outcome) => outcome.status === 'answered')).toBe(
      true,
    );
  });

  it('releases the slot during a retry wait', async () => {
    const slots = createAttemptSlots(1);
    const order: Array<string> = [];
    const retryWait = Promise.withResolvers<void>();

    const first = decide(
      scripted((index) => {
        order.push(`first-${index}`);

        return index === 0 ? json({}, 503) : json(okBody());
      }).fetch,
      { slots, sleep: () => retryWait.promise },
    );

    // The second request runs while the first waits to retry.
    const second = decide(
      scripted(() => {
        order.push('second');
        retryWait.resolve();

        return json(okBody());
      }).fetch,
      { slots },
    );

    await Promise.all([first, second]);
    expect(order).toEqual(['first-0', 'second', 'first-1']);
  });

  it('leaves the slot queue at once when the call aborts while waiting', async () => {
    const slots = createAttemptSlots(1);
    const held = Promise.withResolvers<Response>();
    const holder = decide(() => held.promise, { slots });
    const controller = new AbortController();
    const reason = new Error('owner cancelled');
    const { calls, fetch } = scripted(() => json(okBody()));
    const waiting = decide(fetch, { slots }, controller.signal);

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(calls).toHaveLength(0);
    held.resolve(json(okBody()));
    await expect(holder).resolves.toMatchObject({ status: 'answered' });
  });
});
