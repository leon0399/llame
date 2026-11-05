import {
  isRecord,
  isString,
  redactProtectedString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

/**
 * Own properties whose string value is a classification key, not text:
 * `name` and `code` decide how a failure is recognized (`instanceof` via the
 * prototype, `APICallError.isInstance` via the name, the run's own error code),
 * so rewriting them would change what the consumer sees
 * (`provider-api-selection`: redaction SHALL NOT change a failure's class).
 */
const CLASSIFICATION_KEYS = { name: true, code: true } as const;

/** One message-bearing container of a failure: an error, an array, or a plain object. */
type FailureNode = Error | Array<unknown> | UnknownRecord;

/**
 * Whether `value` is part of a failure's message-bearing graph: an error, an
 * array, or a plain object. Binary payloads, dates, maps, and class instances
 * are not walked — an error's `requestBodyValues` can hold a typed array, and
 * enumerating its indices would walk megabytes of image bytes.
 */
export function isFailureGraph(value: unknown): value is FailureNode {
  if (value instanceof Error || Array.isArray(value)) return true;
  if (!isRecord(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function isClassificationKey(key: PropertyKey): boolean {
  return isString(key) && Object.hasOwn(CLASSIFICATION_KEYS, key);
}

/**
 * `text` with every configured credential replaced by the shared marker, or
 * `text` itself when it holds none — the identity check callers use to know a
 * failure needed no rewrite.
 */
function redactedText(
  text: string,
  credentials: ReadonlyArray<string>,
): string {
  const carriesCredential = credentials.some((credential) =>
    text.includes(credential),
  );
  return carriesCredential ? redactProtectedString(text, credentials) : text;
}

/**
 * Redacts a failure value — an `Error`, a structured failure object, or an
 * abort reason string — so no configured credential survives in it
 * (`provider-api-selection`, "Provider failures never carry a configured
 * credential").
 *
 * An error is rewritten in place, so its identity, prototype chain, symbol
 * marker, `name`, `code`, and any property a consumer branches on are
 * unchanged: `instanceof`, the AI SDK's `isInstance` checks, and a run's own
 * error code keep classifying the failure exactly as they would without the
 * credential. Only string own values are rewritten, except `name` and `code`;
 * the rest of the message-bearing graph — `cause`, `lastError`, `errors[]`,
 * response bodies, headers, and parsed payloads — is walked too (cycle-safe).
 *
 * A graph that cannot be rewritten in place — a non-writable,
 * non-configurable property, a frozen object, or an unreadable accessor — is
 * never forwarded: the whole graph is rebuilt on the same prototypes with
 * every string redacted and every alias preserved, so classification still
 * holds and no original object survives behind a second reference.
 *
 * Returns `undefined` for a value that is not part of a failure graph; the
 * caller forwards that value unchanged.
 */
export function redactModelFailure(
  error: string,
  credentials: ReadonlyArray<string>,
): string;
export function redactModelFailure(
  error: FailureNode,
  credentials: ReadonlyArray<string>,
): FailureNode;
export function redactModelFailure(
  error: unknown,
  credentials: ReadonlyArray<string>,
): object | string | undefined;
export function redactModelFailure(
  error: unknown,
  credentials: ReadonlyArray<string>,
): object | string | undefined {
  if (isString(error)) return redactedText(error, credentials);
  if (!isFailureGraph(error)) return undefined;
  const unrewritable = new Set<object>();
  redactInPlace(error, credentials, new Set(), unrewritable);
  return unrewritable.size === 0
    ? error
    : rebuildRedacted(error, credentials, new Map());
}

/** Redacts one container's own strings and records containers it cannot rewrite. */
function redactInPlace(
  container: FailureNode,
  credentials: ReadonlyArray<string>,
  visited: Set<object>,
  unrewritable: Set<object>,
): void {
  if (visited.has(container)) return;
  visited.add(container);
  for (const key of Reflect.ownKeys(container)) {
    if (isClassificationKey(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(container, key);
    if (descriptor === undefined) continue;
    if (!('value' in descriptor)) {
      if (!redactAccessor(container, key, descriptor, credentials)) {
        unrewritable.add(container);
      }
      continue;
    }
    const current: unknown = descriptor.value;
    if (isString(current)) {
      const redacted = redactedText(current, credentials);
      if (redacted === current) continue;
      if (!defineValue(container, key, descriptor, redacted)) {
        unrewritable.add(container);
      }
      continue;
    }
    if (isFailureGraph(current)) {
      redactInPlace(current, credentials, visited, unrewritable);
    }
  }
}

/**
 * Redacts an own accessor's text where it can be replaced with a data
 * property. A getter that throws, or that yields anything but a string, asks
 * for the rebuild — an object-returning getter could re-derive the raw
 * message, and an unreadable one must not abort the redaction.
 */
function redactAccessor(
  container: FailureNode,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  credentials: ReadonlyArray<string>,
): boolean {
  if (descriptor.get === undefined) return true;
  let read: unknown;
  try {
    read = descriptor.get.call(container);
  } catch {
    return false;
  }
  if (!isString(read)) return false;
  const redacted = redactedText(read, credentials);
  return (
    redacted === read ||
    defineValue(
      container,
      key,
      {
        writable: true,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
      },
      redacted,
    )
  );
}

function defineValue(
  container: FailureNode,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  value: string,
): boolean {
  try {
    Object.defineProperty(container, key, { ...descriptor, value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The rebuilt graph: the same prototypes (so `instanceof` holds), every own
 * property copied with its own attributes — symbols included, so the AI SDK's
 * class marker survives — every string redacted except `name` and `code`, and
 * every nested container replaced by its own rebuilt form. `copies` is filled
 * before a container's properties are read, so a cycle, a shared child, or an
 * alias such as `RetryError.lastError` resolves to the one redacted form.
 */
function rebuildRedacted(
  original: FailureNode,
  credentials: ReadonlyArray<string>,
  copies: Map<object, FailureNode>,
): FailureNode {
  const existing = copies.get(original);
  if (existing !== undefined) return existing;
  const copy = createCopy(original);
  copies.set(original, copy);
  const state = { original, copy, credentials, copies };
  for (const key of Reflect.ownKeys(original)) {
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    if (descriptor !== undefined) copyProperty(state, key, descriptor);
  }
  return copy;
}

/** One rebuilt container and what its copied properties are read from. */
type RebuildState = {
  readonly original: FailureNode;
  readonly copy: FailureNode;
  readonly credentials: ReadonlyArray<string>;
  readonly copies: Map<object, FailureNode>;
};

/**
 * The copy of `original` on the same prototype, without capturing a stack of
 * its own: an empty object of the same kind, then the original's prototype.
 */
function createCopy(original: FailureNode): FailureNode {
  const copy: FailureNode = Array.isArray(original) ? [] : {};
  Object.setPrototypeOf(copy, Reflect.getPrototypeOf(original));
  return copy;
}

/** Copies one own property of `original` onto its copy, redacted. */
function copyProperty(
  state: RebuildState,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  if (!('value' in descriptor)) {
    copyAccessor(state, key, descriptor);
    return;
  }
  const current: unknown = descriptor.value;
  let next: unknown = current;
  if (isString(current)) {
    if (!isClassificationKey(key)) {
      next = redactedText(current, state.credentials);
    }
  } else if (isFailureGraph(current)) {
    next = readRedactedGraph(current, state);
  }
  Object.defineProperty(state.copy, key, { ...descriptor, value: next });
}

/**
 * Copies one own accessor as the value it read, redacted. An accessor that
 * throws is omitted rather than aborting the redaction; one that yields a
 * container is rebuilt like a data property, so it cannot re-derive the raw
 * message from the original.
 */
function copyAccessor(
  state: RebuildState,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
): void {
  let read: unknown;
  try {
    read = descriptor.get?.call(state.original);
  } catch {
    return;
  }
  const value = isString(read)
    ? redactedText(read, state.credentials)
    : isFailureGraph(read)
      ? readRedactedGraph(read, state)
      : read;
  Object.defineProperty(state.copy, key, {
    value,
    writable: true,
    enumerable: descriptor.enumerable,
    configurable: descriptor.configurable,
  });
}

/** The rebuilt or already-copied form of one nested container. */
function readRedactedGraph(
  node: FailureNode,
  state: RebuildState,
): FailureNode {
  return (
    state.copies.get(node) ??
    rebuildRedacted(node, state.credentials, state.copies)
  );
}
