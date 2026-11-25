import {
  create,
  OpenSessionRequestSchema,
  OpenSessionResponseSchema,
  type JsonValue,
  type OpenSessionRequest,
  type OpenSessionResponse,
} from '@workspace/machine-protocol';
import type { MachineSession } from '../machines/machine-session';

type QueueItem =
  | { readonly value: OpenSessionResponse; readonly done: false }
  | { readonly value: undefined; readonly done: true };

class ResponseQueue implements AsyncIterable<OpenSessionResponse> {
  private readonly values: Array<OpenSessionResponse> = [];
  private readonly readers: Array<(item: QueueItem) => void> = [];
  private ended = false;

  push(value: OpenSessionResponse): void {
    const reader = this.readers.shift();

    if (reader === undefined) this.values.push(value);
    else reader({ done: false, value });
  }

  close(): void {
    this.ended = true;

    for (const reader of this.readers.splice(0))
      reader({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<OpenSessionResponse> {
    return {
      next: () => {
        const value = this.values.shift();

        if (value !== undefined) return Promise.resolve({ done: false, value });

        if (this.ended)
          return Promise.resolve({ done: true, value: undefined });

        const deferred =
          Promise.withResolvers<IteratorResult<OpenSessionResponse>>();

        this.readers.push((item) => deferred.resolve(item));

        return deferred.promise;
      },
    };
  }
}

export type MachineMcpSessionHandler = (
  request: OpenSessionRequest,
) => OpenSessionResponse | undefined;

/** Install a Connect MCP service on one established test Machine session. */
export function installMachineMcpSession(
  session: MachineSession,
  handle: MachineMcpSessionHandler,
): (response: OpenSessionResponse) => void {
  let notify: ((response: OpenSessionResponse) => void) | undefined;

  session.clients.mcp.openSession = (input) => {
    const responses = new ResponseQueue();
    notify = (response) => responses.push(response);
    void session.ended.then(() => responses.close());
    void (async () => {
      try {
        for await (const request of input) {
          const response = handle(create(OpenSessionRequestSchema, request));

          if (response !== undefined) responses.push(response);
        }
      } finally {
        responses.close();
      }
    })();

    return responses;
  };

  return (response) => notify?.(response);
}

export function openedMachineMcpSession(
  secrets: ReadonlyArray<string> = [],
): OpenSessionResponse {
  return create(OpenSessionResponseSchema, {
    message: { case: 'opened', value: { secrets: { values: [...secrets] } } },
  });
}

export function machineMcpJsonRpc(value: JsonValue): OpenSessionResponse {
  return create(OpenSessionResponseSchema, {
    message: { case: 'jsonRpc', value: JSON.stringify(value) },
  });
}

export function machineMcpSecrets(
  values: ReadonlyArray<string>,
): OpenSessionResponse {
  return create(OpenSessionResponseSchema, {
    message: { case: 'secrets', value: { values: [...values] } },
  });
}

export function machineMcpStderr(text: string): OpenSessionResponse {
  return create(OpenSessionResponseSchema, {
    message: { case: 'stderr', value: text },
  });
}
