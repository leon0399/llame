import type { JSONValue } from '@ai-sdk/provider';
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
} from '@workspace/runtime-safety';

/**
 * One adapter namespace's provider-native request options — the record every
 * composition layer carries, `models[].providerOptions` included. Keys and
 * values belong to the adapter the entry's provider `type` selects; this
 * module merges records without interpreting them.
 *
 * JSON-valued, not `unknown`-valued: this is exactly the record shape the AI
 * SDK's `providerOptions` accepts, so a composed result reaches the SDK with
 * no cast at the wire.
 */
export type ProviderOptionRecord = Record<string, JSONValue>;

/**
 * Proves a parsed `models[].providerOptions` is what its `ProviderOptionRecord`
 * type claims — a JSON value per key, at every depth — at the one point the
 * file's content crosses into that type: the loader runs this once, at boot,
 * and composition (and through it every client) then carries the proven
 * record, never re-walking it per request.
 */
export function isProviderOptionRecord(
  value: unknown,
): value is ProviderOptionRecord {
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

/** One provider option value, at any depth: exactly the branches JSON permits. */
function isJsonValue(value: unknown): value is JSONValue {
  if (
    isString(value) ||
    isNumber(value) ||
    isBoolean(value) ||
    value === null
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

/**
 * The record branch of a JSON value, one level deep. Every value this module
 * reads is JSON by its type — the operator's record by the boot proof above,
 * the other layers by construction — so a non-array object here is a record of
 * JSON values, and the check stays shallow rather than re-walking a subtree the
 * boot proof already covered.
 */
function isOptionObject(
  value: JSONValue | undefined,
): value is ProviderOptionRecord {
  return isRecord(value);
}

/**
 * Composes one request's effective provider options from the four layers
 * every client shares, lowest precedence first: per-request-kind client
 * defaults, the operator's `models[].providerOptions`, the run's resolved
 * effort, and the client's invariants.
 *
 * Object-valued options merge key by key, recursively; arrays and scalars
 * replace the value beneath them. `null` at any depth removes the key it
 * names, which is how an operator deletes a client default — and why a later
 * layer setting the same key restores it, so an invariant cannot be removed
 * from below. Reserved dotted paths (`thinking.blockBinding`) name keys a
 * client owns and are stripped from the operator record before merging.
 * Inputs are never mutated and no input value is aliased into the result;
 * unknown keys pass through untouched for the adapter to accept or drop. An
 * empty composition is `undefined`, so the request carries no options at all.
 */
export function composeProviderOptions(input: {
  defaults?: ProviderOptionRecord;
  operator?: ProviderOptionRecord;
  effort?: ProviderOptionRecord;
  invariants?: ProviderOptionRecord;
  reservedPaths?: ReadonlyArray<string>;
}): ProviderOptionRecord | undefined {
  // Lowest precedence first: each layer merges over the ones before it.
  const layers = [
    input.defaults,
    stripReservedPaths(input.operator, input.reservedPaths),
    input.effort,
    input.invariants,
  ];
  const composed: ProviderOptionRecord = {};
  for (const layer of layers) {
    if (layer !== undefined) mergeInto(composed, layer);
  }
  return Object.keys(composed).length === 0 ? undefined : composed;
}

/**
 * Merges one layer into `target`, which is always a record this module built
 * (composition seeds it with `{}`), so mutating it in place is local. Every
 * value kept from `layer` is deep-copied, so no input is ever aliased into
 * the result.
 *
 * An object value always merges key by key into a record on the target — the
 * one already there, or a fresh empty record when the key is absent or holds
 * a non-record — never replacing it. That is what makes a `null` delete the
 * key it names at ANY depth: a `null` leaf under a parent no lower layer
 * declared is visited by the recursion instead of riding into the result as
 * a literal, and a parent whose keys were all nulled survives as the empty
 * record the removals left.
 *
 * The read stays on own keys, because an option may be named `__proto__`: an
 * unguarded `target[key]` would read — and then deep-merge into —
 * `Object.prototype`. Writes go through `defineOption` for the same reason;
 * a literal `__proto__` option is ordinary enumerable data here.
 */
function mergeInto(
  target: ProviderOptionRecord,
  layer: ProviderOptionRecord,
): void {
  for (const [key, value] of Object.entries(layer)) {
    if (value === null) {
      delete target[key];
      continue;
    }
    const existing: JSONValue | undefined = Object.hasOwn(target, key)
      ? target[key]
      : undefined;
    if (isOptionObject(value)) {
      const nested = isOptionObject(existing) ? existing : {};
      mergeInto(nested, value);
      if (nested !== existing) defineOption(target, key, nested);
      continue;
    }
    defineOption(target, key, structuredClone(value));
  }
}

/**
 * Stores one composed value as an ordinary own enumerable data property —
 * never an assignment, which for the key `__proto__` would trip
 * `Object.prototype`'s setter and swap the record's prototype instead of
 * storing the key.
 */
function defineOption(
  target: ProviderOptionRecord,
  key: string,
  value: JSONValue,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * The operator record with every reserved path removed. Only the leaf key of
 * a dotted path is deleted, so sibling keys under the same parent survive,
 * and a path that names nothing is ignored. With nothing reserved the record
 * passes through: `mergeInto` copies every value it keeps, so it can be
 * neither aliased nor mutated.
 */
function stripReservedPaths(
  operator: ProviderOptionRecord | undefined,
  reservedPaths: ReadonlyArray<string> | undefined,
): ProviderOptionRecord | undefined {
  if (
    operator === undefined ||
    reservedPaths === undefined ||
    reservedPaths.length === 0
  ) {
    return operator;
  }
  const stripped = structuredClone(operator);
  for (const path of reservedPaths) deleteAtPath(stripped, path.split('.'));
  return stripped;
}

/**
 * Deletes the key a dotted path names; a path through a non-record is
 * ignored. A dotted path always has at least one segment.
 */
function deleteAtPath(
  record: ProviderOptionRecord,
  segments: ReadonlyArray<string>,
): void {
  const [segment, ...rest] = segments;
  if (rest.length === 0) {
    delete record[segment];
    return;
  }
  const nested = record[segment];
  if (isOptionObject(nested)) deleteAtPath(nested, rest);
}
