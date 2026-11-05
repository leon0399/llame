import { isString, redactProtectedString } from '@workspace/runtime-safety';

/**
 * Own properties whose string value is a classification key, not text:
 * `name` and `code` decide how a failure is recognized (`instanceof` via the
 * prototype, `APICallError.isInstance` via the name, the run's own error code),
 * so rewriting them would change what the consumer sees
 * (`provider-api-selection`: redaction SHALL NOT change a failure's class).
 */
const CLASSIFICATION_KEYS = { name: true, code: true } as const;

/** Own properties that hold another failure rather than inert data. */
const FAILURE_KEYS = { cause: true, lastError: true, errors: true } as const;

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

function isRedactableKey(
  key: PropertyKey,
  keys: Readonly<Record<string, true>>,
): boolean {
  return isString(key) && Object.hasOwn(keys, key);
}

/**
 * Redefines one own data property with the redacted value, keeping the
 * original descriptor's attributes. A non-configurable, non-writable property
 * (or a frozen object) refuses the change; the caller then builds a
 * replacement instead of forwarding the original.
 */
function defineRedacted(
  error: Error,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  redacted: Error | string | Array<unknown>,
): boolean {
  try {
    Object.defineProperty(error, key, {
      ...descriptor,
      value: redacted,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Replaces an own accessor property with the redacted text the accessor
 * returned. `stack` is V8's one lazy accessor on an error, and it repeats the
 * message, so it cannot be left to re-format the unredacted value. Returns
 * `false` when the accessor refuses the change or cannot be read, which asks
 * the caller for a replacement.
 */
function redactAccessor(
  error: Error,
  key: PropertyKey,
  descriptor: PropertyDescriptor,
  credentials: ReadonlyArray<string>,
): boolean {
  if (descriptor.get === undefined) return true;
  let read: unknown;
  try {
    read = descriptor.get.call(error);
  } catch {
    return false;
  }
  if (!isString(read)) return true;
  const redacted = redactedText(read, credentials);
  if (redacted === read) return true;
  try {
    Object.defineProperty(error, key, {
      value: redacted,
      writable: true,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Redacts a failure value — an `Error` or an abort reason string — so no
 * configured credential survives in it (`provider-api-selection`, "Provider
 * failures never carry a configured credential").
 *
 * An `Error` is rewritten in place, so its identity, prototype chain, symbol
 * marker, `name`, `code`, and any property a consumer branches on are
 * unchanged: `instanceof`, the AI SDK's `isInstance` checks, and a run's own
 * error code keep classifying the failure exactly as they would without the
 * credential. Only string own values are rewritten, except `name` and `code`,
 * and `cause`, `lastError`, and `errors[]` are walked too (cycle-safe).
 *
 * A failure that cannot be rewritten in place — a non-writable,
 * non-configurable property or a frozen error — is never forwarded: the
 * result is a copy on the same prototype carrying every own property, strings
 * redacted and nested failures substituted, so classification still holds.
 *
 * Returns `undefined` for a value that is neither an `Error` nor a string; the
 * caller forwards that value unchanged.
 */
export function redactModelFailure(
  error: unknown,
  credentials: ReadonlyArray<string>,
): Error | string | undefined {
  if (isString(error)) return redactedText(error, credentials);
  if (!(error instanceof Error)) return undefined;
  return redactedError(error, credentials, new Set());
}

function redactedError(
  error: Error,
  credentials: ReadonlyArray<string>,
  seen: Set<object>,
): Error {
  if (seen.has(error)) return error;
  seen.add(error);
  return redactOwnProperties(error, credentials, seen)
    ? error
    : buildRedactedReplacement(error, {
        credentials,
        copies: new Map(),
      });
}

/** Redacts one error's own strings in place; `false` means a replacement is required. */
function redactOwnProperties(
  error: Error,
  credentials: ReadonlyArray<string>,
  seen: Set<object>,
): boolean {
  for (const key of Reflect.ownKeys(error)) {
    if (isRedactableKey(key, CLASSIFICATION_KEYS)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (descriptor === undefined) continue;
    if (!('value' in descriptor)) {
      if (!redactAccessor(error, key, descriptor, credentials)) return false;
      continue;
    }
    const redacted = redactedOwnValue(descriptor.value, key, credentials, seen);
    if (redacted === undefined || redacted === descriptor.value) continue;
    if (!defineRedacted(error, key, descriptor, redacted)) return false;
  }
  return true;
}

/** The redacted form of one own property value, or `undefined` when it stays as it is. */
function redactedOwnValue(
  current: unknown,
  key: PropertyKey,
  credentials: ReadonlyArray<string>,
  seen: Set<object>,
): Error | string | Array<unknown> | undefined {
  if (isString(current)) {
    const redacted = redactedText(current, credentials);
    return redacted === current ? undefined : redacted;
  }
  if (!isRedactableKey(key, FAILURE_KEYS)) return undefined;
  return key === 'errors' && Array.isArray(current)
    ? redactedList(current, credentials, seen)
    : redactedNestedFailure(current, credentials, seen);
}

/** The redacted form of one `cause`/`lastError` value, or `undefined` when it is not a failure. */
function redactedNestedFailure(
  error: unknown,
  credentials: ReadonlyArray<string>,
  seen: Set<object>,
): Error | string | undefined {
  if (isString(error)) return redactedText(error, credentials);
  return error instanceof Error
    ? redactedError(error, credentials, seen)
    : undefined;
}

/** A redacted copy of an `errors[]` list, or `undefined` when no entry changed identity. */
function redactedList(
  values: Array<unknown>,
  credentials: ReadonlyArray<string>,
  seen: Set<object>,
): Array<unknown> | undefined {
  const next: Array<unknown> = [];
  let changed = false;
  for (const value of values) {
    const redacted = redactedNestedFailure(value, credentials, seen);
    if (redacted !== undefined && redacted !== value) changed = true;
    next.push(redacted === undefined ? value : redacted);
  }
  return changed ? next : undefined;
}

/** One copied failure's credentials and the original-to-copy links built so far. */
type ReplacementContext = {
  readonly credentials: ReadonlyArray<string>;
  readonly copies: Map<object, object>;
};

/**
 * The replacement for an error that cannot be rewritten in place: the same
 * prototype (so `instanceof` holds), every own property copied with its own
 * attributes — symbols included, so the AI SDK's class marker survives — every
 * string redacted except `name` and `code`, and nested failures substituted.
 * `copies` keeps the original/sibling links, so a cycle copies as a cycle.
 */
function buildRedactedReplacement(
  original: Error,
  context: ReplacementContext,
): Error {
  const existing = context.copies.get(original);
  if (existing instanceof Error) return existing;
  // A typed empty error keeps the copy an `Error` without a cast from
  // `Object.create`'s `any`; its own `stack` and `message` are then replaced
  // by the original's own properties below, and its prototype is the
  // original's, so `instanceof` and the SDK's class marker hold.
  const copy: Error = new Error();
  Object.setPrototypeOf(copy, Reflect.getPrototypeOf(original));
  context.copies.set(original, copy);
  for (const key of Reflect.ownKeys(original)) {
    copyRedactedProperty(original, copy, key, context);
  }
  return copy;
}

/** Copies one own property of `original` onto its replacement, redacted. */
function copyRedactedProperty(
  original: Error,
  copy: Error,
  key: PropertyKey,
  context: ReplacementContext,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(original, key);
  if (descriptor === undefined) return;
  if (!('value' in descriptor)) {
    const read: unknown = descriptor.get?.call(original);
    if (!isString(read)) {
      Object.defineProperty(copy, key, descriptor);
      return;
    }
    Object.defineProperty(copy, key, {
      value: redactedText(read, context.credentials),
      writable: true,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
    });
    return;
  }
  const current: unknown = descriptor.value;
  let next: unknown = current;
  if (isString(current)) {
    if (!isRedactableKey(key, CLASSIFICATION_KEYS)) {
      next = redactedText(current, context.credentials);
    }
  } else if (isRedactableKey(key, FAILURE_KEYS)) {
    next =
      key === 'errors' && Array.isArray(current)
        ? (replacementList(current, context) ?? current)
        : (replacementNestedFailure(current, context) ?? current);
  }
  Object.defineProperty(copy, key, { ...descriptor, value: next });
}

function replacementNestedFailure(
  error: unknown,
  context: ReplacementContext,
): Error | string | undefined {
  if (isString(error)) return redactedText(error, context.credentials);
  return error instanceof Error
    ? buildRedactedReplacement(error, context)
    : undefined;
}

function replacementList(
  values: Array<unknown>,
  context: ReplacementContext,
): Array<unknown> | undefined {
  const next: Array<unknown> = [];
  let changed = false;
  for (const value of values) {
    const redacted = replacementNestedFailure(value, context);
    if (redacted !== undefined && redacted !== value) changed = true;
    next.push(redacted === undefined ? value : redacted);
  }
  return changed ? next : undefined;
}
