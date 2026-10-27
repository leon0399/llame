/**
 * The envelope every server-authored `data-context` part shares, and the
 * small object guards the stored-part readers need. Split out of `history.ts`
 * when the notice producers outgrew that module's line budget — the guards
 * here are about the wire envelope, not about any one producer.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNonNullObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** A canonical lowercase-or-uppercase 8-4-4-4-12 identifier, as the api
 *  writes message and Run ids. */
export function isUuid(value: unknown): value is string {
  return isString(value) && UUID_PATTERN.test(value);
}

/** Exact key-set structural check on an already-narrowed object's own keys —
 *  the caller still owns validating each field's type; this only confirms
 *  which fields exist. */
export function keysMatch(
  actualKeys: ReadonlyArray<string>,
  expectedKeys: ReadonlyArray<string>,
): boolean {
  return (
    [...actualKeys].sort().join("\0") === [...expectedKeys].sort().join("\0")
  );
}

export function isContextItemPart(
  value: unknown,
): value is { type: "data-context"; data: unknown } {
  if (
    !isNonNullObject(value) ||
    !keysMatch(Object.keys(value), ["type", "data"])
  ) {
    return false;
  }
  // SAFETY: `keysMatch` above confirmed `value` has exactly the `type` and
  // `data` keys; both are read here still unvalidated, and checked on the
  // following lines before this function returns true.
  const { type, data } = value as { type: unknown; data: unknown };
  return type === "data-context" && isNonNullObject(data);
}

/** The producers whose items this build reads from stored parts. */
export type NoticeProducer =
  | "effective-context-change"
  | "instructions"
  | "prompt-imports"
  | "regenerate";

/** The envelope fields every notice carries, plus the optional model text. */
type NoticeEnvelope = {
  v: unknown;
  producer: unknown;
  form: unknown;
  runId: unknown;
  payload: unknown;
  text?: unknown;
};

/** Whether a value holds exactly the notice envelope's keys. */
function isNoticeEnvelope(data: unknown): data is NoticeEnvelope {
  if (!isNonNullObject(data)) return false;
  const requiredKeys = ["v", "producer", "form", "runId", "payload"];
  const actualKeys = Object.keys(data);
  return (
    keysMatch(actualKeys, requiredKeys) ||
    keysMatch(actualKeys, [...requiredKeys, "text"])
  );
}

/** Whether the envelope's own fields hold: `v: 1`, the expected `producer`,
 *  form `notice`, a UUID `runId`, and `text` a string when present. */
function isNoticeEnvelopeOf(
  envelope: NoticeEnvelope,
  producer: NoticeProducer,
): boolean {
  return (
    envelope.v === 1 &&
    envelope.producer === producer &&
    envelope.form === "notice" &&
    isUuid(envelope.runId) &&
    (envelope.text === undefined || isString(envelope.text))
  );
}

/** The envelope every `data-context` notice this app renders shares: exact
 *  key set (`text` optional), `v: 1`, the expected `producer`, form
 *  `notice`, a UUID `runId`, and `text` a string when present. Returns the
 *  envelope once it holds — its `payload` still unvalidated, which is each
 *  caller's own guard's job, because returning the bare payload would expose an
 *  `unknown` to every caller — or `undefined` when it does not. */
export function contextItemEnvelope(
  value: unknown,
  producer: NoticeProducer,
): NoticeEnvelope | undefined {
  if (!isContextItemPart(value)) return undefined;
  const data = value.data;
  if (!isNoticeEnvelope(data)) return undefined;
  return isNoticeEnvelopeOf(data, producer) ? data : undefined;
}
