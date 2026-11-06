import { type UnknownRecord } from '@workspace/runtime-safety';
import { z } from 'zod';

import { type SystemOneProviderConfig } from '../instance-config/llame-config';
import { createDecisionClient } from './decision-client';
import {
  encodeDecisionRequest,
  type DecisionQuestions,
} from './decision-protocol';

/**
 * The exact bodies captured from live probes on 2026-11-05: the OpenRouter
 * System One route (which adds `id`/`provider`/`usage.cost`) and the OpenCode
 * route (which adds `usage.cost` and an `usage.opencode` billing block). The
 * codec must read both and ignore what it does not model.
 */
const OPENROUTER_BODY = {
  model: 'typesafe/jev-1.14-20261014',
  answers: {
    c1: { type: 'noul', noul: 0.91 },
    c2: { type: 'noul', noul: 0.01 },
    c3: { type: 'noul', noul: 0.9 },
    best: {
      type: 'choice',
      choice: 'one',
      probabilities: { one: 0.55, two: 0.01, three: 0.44 },
      confidence: 0.33,
    },
    enough: {
      type: 'score',
      score: 1.44,
      legend: { '0': 'not at all', '1': 'partly', '2': 'fully' },
      probabilities: { '0': 0, '1': 0.55, '2': 0.45 },
      confidence: 0.32,
    },
  },
  usage: { input_tokens: 514, output_tokens: 104, cost: 0.000021588 },
  id: 'gen-dec-1793880697-T0WGUG9dTgSJG3kVOJKx',
  provider: 'TypeSafe',
};

const OPENCODE_BODY = {
  model: 'jev-1.13',
  answers: {
    c1: { type: 'noul', noul: 0.87 },
    c2: { type: 'noul', noul: 0.01 },
    c3: { type: 'noul', noul: 0.88 },
    best: {
      type: 'choice',
      choice: 'one',
      confidence: 0.38,
      probabilities: { one: 0.59, two: 0.01, three: 0.4 },
    },
    enough: {
      type: 'score',
      score: 1.51,
      confidence: 0.28,
      legend: { '0': 'not at all', '1': 'partly', '2': 'fully' },
      probabilities: { '0': 0, '1': 0.48, '2': 0.52 },
    },
  },
  usage: {
    input_tokens: 514,
    output_tokens: 104,
    cost: 0.00002159,
    opencode: {
      billing_source: 'balance',
      list_cost: 0.00002159,
      tokens: {
        input: 514,
        output: 104,
        reasoning: 0,
        cache_read: 0,
        cache_write_5m: 0,
        cache_write_1h: 0,
      },
    },
  },
};

/** The probe's question map, exactly as the request carried it. */
const PROBE_QUESTIONS: DecisionQuestions = {
  c1: {
    type: 'noul',
    instructions: 'Does candidate [1] help answer the query?',
  },
  c2: {
    type: 'noul',
    instructions: 'Does candidate [2] help answer the query?',
  },
  c3: {
    type: 'noul',
    instructions: 'Does candidate [3] help answer the query?',
  },
  best: {
    type: 'choice',
    instructions: 'Which candidate best answers the query?',
    criteria: {
      one: 'candidate [1]',
      two: 'candidate [2]',
      three: 'candidate [3]',
    },
  },
  enough: {
    type: 'score',
    instructions:
      'How sufficient are the candidates together to answer the query?',
    criteria: ['not at all', 'partly', 'fully'],
  },
};

const PROBE_STATE =
  'Query: how does postgres row level security interact with security definer functions';

function provider(
  overrides: Partial<SystemOneProviderConfig> = {},
): SystemOneProviderConfig {
  return {
    id: 'opencode-decisions',
    type: 'system-one',
    key: 'sk-test',
    baseUrl: 'https://opencode.ai/zen/v1',
    headers: {},
    ...overrides,
  };
}

function jsonResponse(
  body: UnknownRecord,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

type Call = {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: string;
};

/** The decoded request body, typed to what the codec sends. */
const WireBodySchema = z.object({
  model: z.string(),
  state: z.unknown(),
  questions: z.record(
    z.string(),
    z.object({ type: z.string(), instructions: z.string() }),
  ),
});
type WireBody = z.infer<typeof WireBodySchema>;

/** The client always sends JSON text; narrow `BodyInit` without a typeof. */
function isStringBody(body: BodyInit | null | undefined): body is string {
  return typeof body === 'string';
}

function scriptedFetch(
  handler: (call: Call, index: number) => Response | Promise<Response>,
) {
  const calls: Array<Call> = [];
  const fetch = async (url: string, init: RequestInit) => {
    const call = {
      url,
      init,
      body: isStringBody(init.body) ? init.body : '',
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { calls, fetch };
}

function bodyOf(call: Call): WireBody {
  return WireBodySchema.parse(JSON.parse(call.body));
}

describe('System One codec', () => {
  it('encodes the exact request body the probe sent', () => {
    expect(
      encodeDecisionRequest(
        '~typesafe/jev-latest',
        PROBE_STATE,
        PROBE_QUESTIONS,
      ),
    ).toEqual({
      model: '~typesafe/jev-latest',
      state: PROBE_STATE,
      questions: {
        c1: {
          type: 'noul',
          instructions: 'Does candidate [1] help answer the query?',
        },
        c2: {
          type: 'noul',
          instructions: 'Does candidate [2] help answer the query?',
        },
        c3: {
          type: 'noul',
          instructions: 'Does candidate [3] help answer the query?',
        },
        best: {
          type: 'choice',
          instructions: 'Which candidate best answers the query?',
          criteria: {
            one: 'candidate [1]',
            two: 'candidate [2]',
            three: 'candidate [3]',
          },
        },
        enough: {
          type: 'score',
          instructions:
            'How sufficient are the candidates together to answer the query?',
          criteria: ['not at all', 'partly', 'fully'],
        },
      },
    });
  });

  it('encodes optional noul criteria only when they are present', () => {
    const body = encodeDecisionRequest('jev-1.13', 'state', {
      urgent: {
        type: 'noul',
        instructions: 'Is it urgent?',
        criteria: { true: 'Yes-ish', false: 'No-ish' },
      },
      other: { type: 'noul', instructions: 'Is it other?' },
    });
    expect(body.questions).toEqual({
      urgent: {
        type: 'noul',
        instructions: 'Is it urgent?',
        criteria: { true: 'Yes-ish', false: 'No-ish' },
      },
      other: { type: 'noul', instructions: 'Is it other?' },
    });
  });

  it('decodes the OpenRouter probe response, keeping every answer type', async () => {
    const { fetch } = scriptedFetch(() => jsonResponse(OPENROUTER_BODY));
    const client = createDecisionClient(provider(), '~typesafe/jev-latest', {
      fetch,
    });

    const outcome = await client.decide({
      state: PROBE_STATE,
      questions: PROBE_QUESTIONS,
    });

    expect(outcome).toMatchObject({
      status: 'answered',
      model: 'typesafe/jev-1.14-20261014',
      answers: {
        c1: { type: 'noul', noul: 0.91 },
        c2: { type: 'noul', noul: 0.01 },
        c3: { type: 'noul', noul: 0.9 },
        best: {
          type: 'choice',
          choice: 'one',
          probabilities: { one: 0.55, two: 0.01, three: 0.44 },
          confidence: 0.33,
        },
        enough: {
          type: 'score',
          score: 1.44,
          legend: { '0': 'not at all', '1': 'partly', '2': 'fully' },
          probabilities: { '0': 0, '1': 0.55, '2': 0.45 },
          confidence: 0.32,
        },
      },
      unanswered: [],
      usage: { inputTokens: 514, outputTokens: 104, costUsd: 0.000021588 },
    });
  });

  it('decodes the OpenCode probe response and ignores its billing block', async () => {
    const { fetch } = scriptedFetch(() => jsonResponse(OPENCODE_BODY));
    const client = createDecisionClient(provider(), 'jev-1.13', { fetch });

    const outcome = await client.decide({
      state: PROBE_STATE,
      questions: PROBE_QUESTIONS,
    });

    expect(outcome).toMatchObject({
      status: 'answered',
      model: 'jev-1.13',
      usage: { inputTokens: 514, outputTokens: 104, costUsd: 0.00002159 },
    });
  });

  it('posts to {baseUrl}/systemone with a bearer key and no session header', async () => {
    const { calls, fetch } = scriptedFetch(() => jsonResponse(OPENCODE_BODY));
    const client = createDecisionClient(
      provider({
        baseUrl: 'https://opencode.ai/zen/v1/',
        headers: {
          'x-static': ['literal'],
          'x-session': ['', ''],
        },
      }),
      'jev-1.13',
      { fetch },
    );

    await client.decide({ state: 'state', questions: PROBE_QUESTIONS });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://opencode.ai/zen/v1/systemone');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toMatchObject({
      authorization: 'Bearer sk-test',
      'content-type': 'application/json',
      'x-static': 'literal',
    });
    expect(calls[0].init.headers).not.toHaveProperty('x-session');
    expect(bodyOf(calls[0]).model).toBe('jev-1.13');
  });

  it('answers nothing and calls nothing when there are no questions', async () => {
    const { calls, fetch } = scriptedFetch(() => jsonResponse(OPENCODE_BODY));
    const client = createDecisionClient(provider(), 'jev-1.13', {
      fetch,
      now: () => 0,
    });

    await expect(
      client.decide({ state: 'state', questions: {} }),
    ).resolves.toEqual({
      status: 'answered',
      model: 'jev-1.13',
      answers: {},
      unanswered: [],
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      latencyMs: 0,
    });
    expect(calls).toHaveLength(0);
  });

  it('prices an unpriced wire from pricingUsdPer1M input tokens', async () => {
    const { fetch } = scriptedFetch(() =>
      jsonResponse({
        model: 'jev-1.13.0',
        answers: { urgent: { type: 'noul', noul: 0.5 } },
        usage: { input_tokens: 1_000_000, output_tokens: 12 },
      }),
    );
    const client = createDecisionClient(provider(), 'jev-1.13', {
      fetch,
      pricingUsdPer1M: { input: 0.042 },
    });

    const outcome = await client.decide({
      state: 'state',
      questions: { urgent: { type: 'noul', instructions: 'Urgent?' } },
    });

    expect(outcome).toMatchObject({
      status: 'answered',
      usage: { inputTokens: 1_000_000, outputTokens: 12, costUsd: 0.042 },
    });
  });

  it('leaves cost unknown when the wire reports none and no price is configured', async () => {
    const { fetch } = scriptedFetch(() =>
      jsonResponse({
        model: 'jev-1.13.0',
        answers: { urgent: { type: 'noul', noul: 0.5 } },
        usage: { input_tokens: 10, output_tokens: 0 },
      }),
    );
    const client = createDecisionClient(provider(), 'jev-1.13', { fetch });

    const outcome = await client.decide({
      state: 'state',
      questions: { urgent: { type: 'noul', instructions: 'Urgent?' } },
    });

    expect(outcome).toMatchObject({
      status: 'answered',
      usage: { costUsd: null },
    });
  });
});

describe('System One strict answer parsing', () => {
  const questions: DecisionQuestions = {
    a: { type: 'noul', instructions: 'A?' },
    b: { type: 'noul', instructions: 'B?' },
  };

  function clientReturning(body: UnknownRecord) {
    const { calls, fetch } = scriptedFetch(() => jsonResponse(body));
    return {
      calls,
      client: createDecisionClient(provider(), 'jev-1.13', { fetch }),
    };
  }

  it('fails the whole call when an answer is missing', async () => {
    const { calls, client } = clientReturning({
      model: 'jev-1.13',
      answers: { a: { type: 'noul', noul: 0.5 } },
      usage: { input_tokens: 10, output_tokens: 0 },
    });

    await expect(
      client.decide({ state: 's', questions }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    // A codec mismatch is not transient: exactly one attempt.
    expect(calls).toHaveLength(1);
  });

  it('fails the whole call when an answer has the wrong type', async () => {
    const { client } = clientReturning({
      model: 'jev-1.13',
      answers: {
        a: { type: 'noul', noul: 0.5 },
        b: { type: 'choice', choice: 'x', probabilities: { x: 1, y: 0 } },
      },
      usage: { input_tokens: 10, output_tokens: 0 },
    });

    await expect(
      client.decide({ state: 's', questions }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('rejects a probability outside [0, 1] instead of trusting it', async () => {
    const { client } = clientReturning({
      model: 'jev-1.13',
      answers: {
        a: { type: 'noul', noul: 2 },
        b: { type: 'noul', noul: 0.1 },
      },
      usage: { input_tokens: 10, output_tokens: 0 },
    });

    await expect(
      client.decide({ state: 's', questions }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('fails the call when the body is not the documented envelope', async () => {
    const { client } = clientReturning({ answers: {}, usage: {} });

    await expect(
      client.decide({ state: 's', questions }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });
});

describe('System One retries', () => {
  const questions: DecisionQuestions = {
    a: { type: 'noul', instructions: 'A?' },
  };
  const answered = {
    model: 'jev-1.13',
    answers: { a: { type: 'noul', noul: 0.4 } },
    usage: { input_tokens: 10, output_tokens: 0 },
  };

  it('retries a 500 and succeeds on the second attempt', async () => {
    const sleeps: Array<number> = [];
    const { calls, fetch } = scriptedFetch((_call, index) =>
      index === 0
        ? jsonResponse({ error: { message: 'boom' } }, 500)
        : jsonResponse(answered),
    );
    const client = createDecisionClient(provider(), 'jev-1.13', {
      fetch,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await expect(
      client.decide({ state: 's', questions }),
    ).resolves.toMatchObject({
      status: 'answered',
    });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([500]);
  });

  it('honours retry-after seconds up to the cap', async () => {
    const sleeps: Array<number> = [];
    const { fetch } = scriptedFetch((_call, index) =>
      index === 0
        ? jsonResponse({ error: { message: 'slow down' } }, 429, {
            'retry-after': '2',
          })
        : jsonResponse(answered),
    );
    const client = createDecisionClient(provider(), 'jev-1.13', {
      fetch,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await client.decide({ state: 's', questions });
    expect(sleeps).toEqual([2000]);
  });

  it('caps a huge retry-after at five seconds', async () => {
    const sleeps: Array<number> = [];
    const { fetch } = scriptedFetch(() =>
      jsonResponse({ error: { message: 'slow down' } }, 429, {
        'retry-after': '30',
      }),
    );
    const client = createDecisionClient(provider(), 'jev-1.13', {
      fetch,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await expect(
      client.decide({ state: 's', questions }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'rate_limited',
    });
    expect(sleeps).toEqual([5000, 5000]);
  });

  it('does not retry a non-transient rejection', async () => {
    const sleeps: Array<number> = [];
    const { calls, fetch } = scriptedFetch(() =>
      jsonResponse({ error: { message: 'bad key' } }, 401),
    );
    const client = createDecisionClient(provider(), 'jev-1.13', {
      fetch,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await expect(
      client.decide({ state: 's', questions }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'rejected',
    });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('backs off 500ms then 1s across a transport failure and then answers', async () => {
    const sleeps: Array<number> = [];
    const { calls, fetch } = scriptedFetch((_call, index) => {
      if (index < 2) throw new Error('socket hang up');
      return jsonResponse(answered);
    });
    const client = createDecisionClient(provider(), 'jev-1.13', {
      fetch,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    await expect(
      client.decide({ state: 's', questions }),
    ).resolves.toMatchObject({
      status: 'answered',
    });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it('gives up as upstream_error after three transport failures', async () => {
    const { calls, fetch } = scriptedFetch(() => {
      throw new Error('socket hang up');
    });
    const client = createDecisionClient(provider(), 'jev-1.13', {
      fetch,
      sleep: () => Promise.resolve(),
    });

    await expect(
      client.decide({ state: 's', questions }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'upstream_error',
    });
    expect(calls).toHaveLength(3);
  });

  it('never calls the provider once the caller has aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { calls, fetch } = scriptedFetch(() => jsonResponse(answered));
    const client = createDecisionClient(provider(), 'jev-1.13', { fetch });

    await expect(
      client.decide({ state: 's', questions, signal: controller.signal }),
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'aborted' });
    expect(calls).toHaveLength(0);
  });
});
