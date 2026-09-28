import type {
  WebFetchFailure,
  WebRequestInit,
  WebResponse,
} from '../tools/web-read/http-client';
import type { GithubWebAdapterConfig } from '../instance-config/llame-config';
import type { WebAdapterIo } from '../tools/web-read/adapters/contract';

export type Reply = WebResponse | WebFetchFailure;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonObject
  | ReadonlyArray<JsonValue>;
export type JsonObject = { readonly [key: string]: JsonValue };
export type BlobWire = {
  readonly content: string;
  readonly encoding: string;
  readonly size?: number;
};
export type RecordedRequest = {
  readonly url: string;
  readonly init: WebRequestInit | undefined;
};
export type ScriptedIo = {
  readonly io: WebAdapterIo;
  readonly requests: Array<RecordedRequest>;
};

export const API_ORIGIN = 'http://127.0.0.1:43123';

export function config(token?: string): GithubWebAdapterConfig {
  return token === undefined
    ? { id: 'github', use: 'github' }
    : { id: 'github', use: 'github', token };
}

export function response(value: JsonValue | BlobWire): WebResponse {
  return {
    finalUrl: `${API_ORIGIN}/response`,
    contentType: 'application/json',
    body: JSON.stringify(value) ?? '',
  };
}

export function scriptedIo(
  routes: ReadonlyMap<string, ReadonlyArray<Reply>>,
): ScriptedIo {
  const requests: Array<RecordedRequest> = [];
  const remaining = new Map(
    [...routes].map(([url, replies]) => [url, [...replies]]),
  );
  return {
    requests,
    io: {
      fetch: (url, init) => {
        requests.push({ url, init });
        const replies = remaining.get(url);
        if (replies === undefined || replies.length === 0) {
          throw new Error(`unexpected request ${url}`);
        }
        const reply = replies.shift();
        if (reply === undefined) throw new Error(`empty reply ${url}`);
        return Promise.resolve(reply);
      },
    },
  };
}
