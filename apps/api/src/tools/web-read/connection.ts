import { isIP } from 'node:net';
import type { ConnectionOptions } from 'node:tls';

import { Agent, type Response as UndiciResponse } from 'undici';

import { type AdmitAddress } from './admission';
import {
  addressLocator,
  canonicalAddress,
  hostLiteralAddress,
} from './address';
import { canonicalHref } from './locator';
import type {
  ResolveHost,
  ResolvedAddress,
  WebFetchDeps,
  WebFetchFailure,
  WebFetchOptions,
} from './http-client';
import {
  abortFailure,
  transportFailure,
  type CallDeadline,
} from './call-deadline';

/** The `Accept` value every request of a web read sends: publisher Markdown
 *  first, plain text ranked above HTML (design D9). */
const ACCEPT = 'text/markdown, text/plain;q=0.9, text/html;q=0.8, */*;q=0.5';

const HOST_RESOLUTION_FAILURE: WebFetchFailure = {
  type: 'network_error',
  message: 'The host could not be resolved.',
};

type ConnectionDispatchOutcome =
  | { readonly kind: 'response'; readonly response: UndiciResponse }
  | { readonly kind: 'failure'; readonly failure: WebFetchFailure };

export type ConnectionRequestOutcome =
  | ConnectionDispatchOutcome
  | {
      readonly kind: 'address_refused';
      readonly locator: string;
    };

export type ConnectionPlanner = {
  request(
    url: string,
    options: WebFetchOptions,
    deadline: CallDeadline,
  ): Promise<ConnectionRequestOutcome>;
  dispose(): void;
};

type ConnectionState = {
  readonly deps: Pick<WebFetchDeps, 'admitAddress' | 'fetch' | 'resolve'>;
  readonly resolutions: Map<string, Promise<Array<ResolvedAddress>>>;
  readonly agents: Set<Agent>;
};

type ConnectionRequestContext = {
  readonly state: ConnectionState;
  readonly url: string;
  readonly options: WebFetchOptions;
  readonly deadline: CallDeadline;
};

type ConnectionDispatchContext = {
  readonly url: string;
  readonly options: WebFetchOptions;
  readonly deadline: CallDeadline;
  readonly fetch: WebFetchDeps['fetch'];
  readonly agent: Agent;
};
type AddressResolution =
  | { readonly kind: 'addresses'; readonly addresses: Array<ResolvedAddress> }
  | { readonly kind: 'resolution_failed' }
  | { readonly kind: 'aborted' };

type AddressPlan =
  | {
      readonly kind: 'admitted';
      readonly requestUrl: URL;
      readonly addresses: Array<ResolvedAddress>;
    }
  | { readonly kind: 'failure'; readonly failure: WebFetchFailure }
  | { readonly kind: 'refused'; readonly locator: string };

type ResolutionRace<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'rejected' }
  | { readonly kind: 'aborted' };

/** Returns only the request's admitted addresses to undici's socket lookup. */
export function pinnedLookup(
  requestHostname: string,
  admitted: ReadonlyArray<ResolvedAddress>,
): NonNullable<ConnectionOptions['lookup']> {
  const addresses = admitted.map(({ address, family }) => ({
    address,
    family,
  }));
  const error = Object.assign(new Error('The pinned host lookup failed.'), {
    code: 'ENOTFOUND',
  });
  return (hostname, options, callback) => {
    if (hostname !== requestHostname) {
      callback(error, '', 0);
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const first = admitted[0];
    if (first === undefined) {
      callback(error, '', 0);
      return;
    }
    callback(null, first.address, first.family);
  };
}

/** The call's shared address resolutions and per-request pinned agents. */
export function createConnectionPlanner(
  deps: Pick<WebFetchDeps, 'admitAddress' | 'fetch' | 'resolve'>,
): ConnectionPlanner {
  const state: ConnectionState = {
    deps,
    resolutions: new Map(),
    agents: new Set(),
  };
  return {
    request: (url, options, deadline) =>
      requestConnection({ state, url, options, deadline }),
    dispose() {
      for (const agent of state.agents) void agent.destroy();
      state.agents.clear();
    },
  };
}

async function requestConnection(
  context: ConnectionRequestContext,
): Promise<ConnectionRequestOutcome> {
  const plan = await resolveAndAdmit(context);
  if (plan.kind === 'failure') return plan;
  if (plan.kind === 'refused') {
    return { kind: 'address_refused', locator: plan.locator };
  }
  const agent = new Agent({
    allowH2: false,
    connect: {
      lookup: pinnedLookup(plan.requestUrl.hostname, plan.addresses),
    },
  });
  context.state.agents.add(agent);
  return dispatchRequest({
    url: context.url,
    options: context.options,
    deadline: context.deadline,
    fetch: context.state.deps.fetch,
    agent,
  });
}

async function resolveAndAdmit({
  state,
  url,
  options,
  deadline,
}: ConnectionRequestContext): Promise<AddressPlan> {
  if (options.signal?.aborted === true) {
    return { kind: 'failure', failure: abortFailure('aborted') };
  }
  deadline.requestStarted();
  const requestUrl = new URL(url);
  const resolution = await resolveRequestAddresses(
    requestUrl,
    deadline.signal,
    state.resolutions,
    state.deps.resolve,
  );
  if (resolution.kind !== 'addresses') {
    deadline.headersArrived();
    const failure =
      resolution.kind === 'aborted'
        ? abortFailure(deadline.reason())
        : HOST_RESOLUTION_FAILURE;
    return { kind: 'failure', failure };
  }
  const addresses = admittedAddressesFor(
    url,
    resolution.addresses,
    state.deps.admitAddress,
  );
  if (addresses.length === 0) {
    deadline.headersArrived();
    return { kind: 'refused', locator: url };
  }
  return { kind: 'admitted', requestUrl, addresses };
}

async function dispatchRequest({
  url,
  options,
  deadline,
  fetch,
  agent,
}: ConnectionDispatchContext): Promise<ConnectionDispatchOutcome> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      headers: {
        accept: ACCEPT,
        'user-agent': options.userAgent,
      },
      signal: deadline.signal,
      dispatcher: agent,
    });
    deadline.headersArrived();
    if (deadline.signal.aborted) {
      void cancelResponseBody(response);
      return { kind: 'failure', failure: abortFailure(deadline.reason()) };
    }
    return { kind: 'response', response };
  } catch (error) {
    deadline.headersArrived();
    return { kind: 'failure', failure: transportFailure(error, deadline) };
  }
}

function memoizedResolution(
  hostname: string,
  resolutions: Map<string, Promise<Array<ResolvedAddress>>>,
  resolve: ResolveHost,
): Promise<Array<ResolvedAddress>> {
  const existing = resolutions.get(hostname);
  if (existing !== undefined) return existing;
  const pending = Promise.resolve()
    .then(() => resolve(hostname))
    .then((addresses) => Array.from(addresses));
  void pending.catch(() => undefined);
  resolutions.set(hostname, pending);
  return pending;
}

function raceResolution<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<ResolutionRace<T>> {
  if (signal.aborted) return Promise.resolve({ kind: 'aborted' });
  return new Promise<ResolutionRace<T>>((resolve) => {
    let settled = false;
    const finish = (result: ResolutionRace<T>): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = (): void => finish({ kind: 'aborted' });
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => finish({ kind: 'value', value }),
      () => finish({ kind: 'rejected' }),
    );
  });
}

async function resolveRequestAddresses(
  requestUrl: URL,
  signal: AbortSignal,
  resolutions: Map<string, Promise<Array<ResolvedAddress>>>,
  resolve: ResolveHost,
): Promise<AddressResolution> {
  const literal = hostLiteralAddress(requestUrl);
  if (literal !== undefined) {
    const family = isIP(literal);
    if (family === 4 || family === 6) {
      return { kind: 'addresses', addresses: [{ address: literal, family }] };
    }
    return { kind: 'resolution_failed' };
  }
  const pending = memoizedResolution(requestUrl.hostname, resolutions, resolve);
  const result = await raceResolution(pending, signal);
  if (result.kind === 'aborted') return { kind: 'aborted' };
  // An empty answer resolved nothing; reporting it as refused would blame
  // policy for a host that has no address at all.
  if (result.kind === 'rejected' || result.value.length === 0) {
    return { kind: 'resolution_failed' };
  }
  return { kind: 'addresses', addresses: result.value };
}

function admittedAddressesFor(
  requestLocator: string,
  addresses: ReadonlyArray<ResolvedAddress>,
  admitAddress: AdmitAddress,
): Array<ResolvedAddress> {
  const admitted: Array<ResolvedAddress> = [];
  for (const address of addresses) {
    const canonical = canonicalAddress(address.address);
    const locator = canonicalHref(
      new URL(addressLocator(requestLocator, address.address)),
    );
    if (admitAddress(canonical.text, locator)) admitted.push(address);
  }
  return admitted;
}

async function cancelResponseBody(response: UndiciResponse): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A response whose headers arrived after its deadline is already refused.
  }
}
