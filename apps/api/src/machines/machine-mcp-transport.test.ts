import { PassThrough } from 'node:stream';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import type { JSONRPCMessage } from '@ai-sdk/mcp';
import type { CallOptions } from '@connectrpc/connect';
import {
  create,
  OpenSessionRequestSchema,
  OpenSessionResponseSchema,
  type OpenSessionRequest,
  type OpenSessionResponse,
} from '@workspace/machine-protocol';

import { MachineConnector } from './machine-connector.service';
import { MachineTransport } from './machine-mcp-transport';
import { MachineSession, type MachineRequestOptions } from './machine-session';

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: Array<T> = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T): void {
    const waiter = this.waiters.shift();

    if (waiter === undefined) this.values.push(value);
    else waiter({ done: false, value });
  }

  pushMany(...values: Array<T>): void {
    for (const value of values) this.push(value);
  }

  close(): void {
    this.ended = true;

    for (const waiter of this.waiters.splice(0))
      waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();

        if (value !== undefined) return Promise.resolve({ done: false, value });

        if (this.ended)
          return Promise.resolve({ done: true, value: undefined });
        const deferred = Promise.withResolvers<IteratorResult<T>>();
        this.waiters.push(deferred.resolve);

        return deferred.promise;
      },
    };
  }
}

const ENVELOPE = { budgetMs: 30_000 };
const START_SECRET = 'repo-token-sentinel';
const LEARNED_SECRET = 'session-id-sentinel';

type Fixture = {
  readonly connector: MachineConnector;
  readonly releaseMachineSession: (
    machine: string,
    session: MachineSession,
  ) => void;
  readonly sent: Array<OpenSessionRequest>;
  readonly options: Array<CallOptions>;
  readonly transport: MachineTransport;
  readonly diagnostics: Array<string>;
  readonly messages: Array<JSONRPCMessage>;
  readonly responses: AsyncQueue<OpenSessionResponse>;
};

function fixture(): Fixture {
  const sent: Array<OpenSessionRequest> = [];
  const options: Array<CallOptions> = [];
  const diagnostics: Array<string> = [];
  const messages: Array<JSONRPCMessage> = [];
  const responses = new AsyncQueue<OpenSessionResponse>();

  const connection = new PassThrough();

  const session = new MachineSession({
    name: 'devl',
    hubVersion: '9.9.9',
    transport: {
      input: connection,
      output: connection,
      close: () => connection.destroy(),
      ended: new Promise(() => undefined),
    },
  });

  vi.spyOn(session, 'callOptions').mockImplementation(
    (value: MachineRequestOptions = {}) => ({
      signal: value.signal,
      timeoutMs: value.envelope?.budgetMs,
    }),
  );
  vi.spyOn(session.clients.mcp, 'openSession').mockImplementation(
    (input, callOptions) => {
      options.push(callOptions ?? {});

      return (async function* () {
        void (async () => {
          for await (const request of input) {
            sent.push(create(OpenSessionRequestSchema, request));

            switch (request.message?.case) {
              case 'open':
                responses.push(
                  create(OpenSessionResponseSchema, {
                    message: {
                      case: 'opened',
                      value: { secrets: { values: [START_SECRET] } },
                    },
                  }),
                );
                break;
              case 'jsonRpc': {
                const decoded: unknown = JSON.parse(request.message.value);

                if (
                  !isRecord(decoded) ||
                  !isNumber(decoded.id) ||
                  !isString(decoded.method)
                ) {
                  throw new Error(
                    'The test received an invalid JSON-RPC request.',
                  );
                }

                const requestMessage = {
                  id: decoded.id,
                  method: decoded.method,
                };

                if (requestMessage.method === 'initialize') {
                  responses.push(
                    create(OpenSessionResponseSchema, {
                      message: {
                        case: 'jsonRpc',
                        value: JSON.stringify({
                          jsonrpc: '2.0',
                          id: requestMessage.id,
                          result: { serverInfo: { name: 'fixture' } },
                        }),
                      },
                    }),
                  );
                }

                break;
              }

              case 'protocolVersion':
              case undefined:
                break;
            }
          }

          responses.close();
        })();

        try {
          yield* responses;
        } finally {
          responses.close();
        }
      })();
    },
  );

  const connector = new MachineConnector({
    machines: {
      ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
      hosts: { devl: { destination: 'box' } },
    },
    hubVersion: '9.9.9',
    bindIdentity: () => Promise.resolve('match'),
    transportFactory: { open: vi.fn() },
  });

  vi.spyOn(connector, 'machineSession').mockResolvedValue(session);

  const releaseMachineSession = vi
    .spyOn(connector, 'releaseMachineSession')
    .mockImplementation(() => undefined);

  const transport = new MachineTransport({
    connector,
    machine: 'devl',
    root: '/srv/work',
    server: 'storybook',
    envelope: ENVELOPE,
    onDiagnostic: (text) => diagnostics.push(text),
  });

  transport.onmessage = (message) => messages.push(message);

  return {
    connector,
    releaseMachineSession,
    sent,
    options,
    transport,
    diagnostics,
    messages,
    responses,
  };
}

describe('MachineTransport', () => {
  it('opens one OpenSession stream and learns protected values', async () => {
    const test = fixture();
    await test.transport.start();

    expect(test.sent[0]?.message.case).toBe('open');
    expect(test.options[0]?.timeoutMs).toBeUndefined();
    await test.transport.close();
    expect(test.options[0]?.signal?.aborted).toBe(true);
    expect(test.releaseMachineSession).toHaveBeenCalledOnce();
  });

  it('relays JSON-RPC text in both directions and negotiated protocol version', async () => {
    const test = fixture();
    await test.transport.start();

    const inbound = {
      jsonrpc: '2.0' as const,
      id: 1,
      method: 'initialize',
      params: {},
    };

    await test.transport.send(inbound);
    test.transport.setProtocolVersion('2025-06-18');

    await vi.waitFor(() => expect(test.sent).toHaveLength(3));
    expect(
      test.sent[1]?.message.case === 'jsonRpc'
        ? JSON.parse(test.sent[1].message.value)
        : undefined,
    ).toEqual(inbound);
    await vi.waitFor(() =>
      expect(test.messages).toEqual([
        { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'fixture' } } },
      ]),
    );
    expect(test.transport.protocolVersion).toBe('2025-06-18');
    await test.transport.close();
  });

  it('redacts stderr using initial and later secrets', async () => {
    const test = fixture();
    await test.transport.start();
    test.responses.pushMany(
      create(OpenSessionResponseSchema, {
        message: { case: 'stderr', value: `started ${START_SECRET}\n` },
      }),
      create(OpenSessionResponseSchema, {
        message: { case: 'secrets', value: { values: [LEARNED_SECRET] } },
      }),
      create(OpenSessionResponseSchema, {
        message: { case: 'stderr', value: `authenticated ${LEARNED_SECRET}\n` },
      }),
    );
    await vi.waitFor(() =>
      expect(test.diagnostics.join('\n')).toContain('[REDACTED]'),
    );
    expect(test.diagnostics.join('\n')).not.toContain(START_SECRET);
    expect(test.diagnostics.join('\n')).not.toContain(LEARNED_SECRET);
    expect(test.transport.protectedValues()).toEqual([
      START_SECRET,
      LEARNED_SECRET,
    ]);
    await test.transport.close();
  });

  it('reports an unexpectedly ended server stream as lost', async () => {
    const test = fixture();
    const closed = vi.fn();
    const failed = vi.fn();
    test.transport.onclose = closed;
    test.transport.onerror = failed;
    await test.transport.start();
    test.responses.close();
    await vi.waitFor(() => expect(test.transport.lost).toBe(true));
    expect(closed).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledOnce();
  });
  it('surfaces consumer callback failures without rejecting the receive loop', async () => {
    const test = fixture();
    const failed = vi.fn();
    const callbackError = new Error('consumer callback failed');
    test.transport.onerror = failed;
    test.transport.onmessage = () => {
      throw callbackError;
    };

    await test.transport.start();
    test.responses.push(
      create(OpenSessionResponseSchema, {
        message: {
          case: 'jsonRpc',
          value: JSON.stringify({ jsonrpc: '2.0', id: 0, result: {} }),
        },
      }),
    );

    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(callbackError));
    expect(test.transport.lost).toBe(true);
    await test.transport.close();
  });
});
