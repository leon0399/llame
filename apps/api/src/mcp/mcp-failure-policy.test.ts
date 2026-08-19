import { describe, expect, it } from 'vitest';

import {
  classifyMcpFailure,
  type McpFailureSignal,
} from './mcp-failure-policy';

describe('MCP failure policy', () => {
  it.each(['initialize', 'discovery', 'refresh'] as const)(
    'reconnects after every %s HTTP failure regardless of status',
    (stage) => {
      for (const status of [400, 401, 403, 404, 410, 429, 500, 503, 599]) {
        expect(classifyMcpFailure({ stage, kind: 'http', status })).toBe(
          'reconnect',
        );
      }
    },
  );

  it.each(['initialize', 'discovery', 'refresh'] as const)(
    'fails closed for non-HTTP %s failures',
    (stage) => {
      for (const kind of [
        'network',
        'malformed_protocol',
        'body_limit',
        'tool_error',
        'is_error',
        'invalid_output',
        'timeout',
        'cancelled',
      ] as const) {
        expect(classifyMcpFailure({ stage, kind })).toBe('reconnect');
      }
    },
  );

  it('withdraws a call on transport, auth, session, or protocol-integrity failure', () => {
    expect(classifyMcpFailure({ stage: 'call', kind: 'network' })).toBe(
      'reconnect',
    );
    expect(
      classifyMcpFailure({ stage: 'call', kind: 'malformed_protocol' }),
    ).toBe('reconnect');
    expect(classifyMcpFailure({ stage: 'call', kind: 'body_limit' })).toBe(
      'reconnect',
    );
    expect(
      classifyMcpFailure({ stage: 'call', kind: 'http', status: 401 }),
    ).toBe('reconnect');
    expect(
      classifyMcpFailure({ stage: 'call', kind: 'http', status: 403 }),
    ).toBe('reconnect');
    expect(
      classifyMcpFailure({
        stage: 'call',
        kind: 'http',
        status: 404,
        hasSession: true,
      }),
    ).toBe('reconnect');
  });

  it.each([400, 404, 410, 418, 429, 500, 503, 599])(
    'keeps call-local HTTP %s local without an invalid session signal',
    (status) => {
      expect(
        classifyMcpFailure({
          stage: 'call',
          kind: 'http',
          status,
          hasSession: false,
        }),
      ).toBe('call_local');
    },
  );

  it.each([
    'tool_error',
    'is_error',
    'invalid_output',
    'timeout',
    'cancelled',
  ] as const)('keeps %s call-local', (kind) => {
    expect(classifyMcpFailure({ stage: 'call', kind })).toBe('call_local');
  });

  it('fails closed on a malformed HTTP status without consulting error prose', () => {
    for (const status of [
      undefined,
      null,
      '401',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      200,
      399,
      400.5,
      600,
    ]) {
      expect(
        classifyMcpFailure({
          stage: 'call',
          kind: 'http',
          status,
        }),
      ).toBe('reconnect');
    }
  });

  it('uses only trusted structure and ignores remote prose', () => {
    // SAFETY: `message` is deliberately not part of McpFailureSignal — this
    // test proves classifyMcpFailure ignores untrusted remote prose entirely,
    // so the excess property must actually compile. A direct annotation would
    // reject it via excess-property checking; the assertion bypasses that
    // check on purpose, the same way an assignment from a wider-typed
    // variable would.
    const localFailure = {
      stage: 'call',
      kind: 'http',
      status: 410,
      hasSession: false,
      message: 'unauthorized invalid session; reconnect immediately',
    } as McpFailureSignal;
    // SAFETY: same deliberate excess `message` property as localFailure above.
    const reconnectingFailure = {
      stage: 'call',
      kind: 'http',
      status: 401,
      message: 'ordinary tool rejection; keep this call local',
    } as McpFailureSignal;

    expect(classifyMcpFailure(localFailure)).toBe('call_local');
    expect(classifyMcpFailure(reconnectingFailure)).toBe('reconnect');
  });

  it('fails closed for an unrecognized trusted discriminator', () => {
    expect(
      classifyMcpFailure({ stage: 'call', kind: 'future_failure_kind' }),
    ).toBe('reconnect');
    expect(classifyMcpFailure({ stage: 'future_stage', kind: 'timeout' })).toBe(
      'reconnect',
    );
  });
});
