/**
 * The context-injection rail: one envelope, one vocabulary, one order.
 *
 * Every server-authored contribution to a chat's model-visible conversation
 * that is not part of the system prompt is a **context item**. Items share a
 * single `<system-reminder>` envelope and a single persisted part type, so
 * that adding a producer is an additive change rather than a coordinated
 * API/worker revision boundary.
 *
 * Two axes, deliberately independent:
 * - `producer` — who authored the item.
 * - `form` — what kind of content it is. Semantic, never visual: it states
 *   what the content IS and lets a consumer derive presentation from that.
 *   Ordering, emphasis, and collapse behavior are the consumer's business
 *   and never enter this union.
 *
 * Tolerance is what removes the extension tax. The envelope and a recognized
 * producer's payload are validated strictly — that is what keeps
 * client-authored control metadata unforgeable — while an unrecognized
 * `producer` parses and renders as NOTHING, and an unrecognized `form` is
 * treated as absent. A reader that cannot interpret an item cannot state its
 * precedence or apply its framing, so rendering it as content would be worse
 * than rendering nothing.
 */

import { compareCodePoints } from '../canonical-json';
import { isRecord, isString, type UnknownRecord } from '../unknown-record';

/**
 * Forms with a producer in this revision. A form is NOT defined ahead of a
 * producer that emits it: anticipated forms live in
 * `docs/research/harness-transparency/2026-08-21-context-form-design-space.md`
 * as proposed design space, so a future producer adopts an existing term
 * rather than inventing a redundant one, without any of them being normative
 * before it is implemented.
 */
export const CONTEXT_ITEM_FORMS = ['notice', 'snapshot', 'checkpoint'] as const;

export type ContextItemForm = (typeof CONTEXT_ITEM_FORMS)[number];

/**
 * Producers in this revision, in the **fixed precedence order** their items
 * render in. Order is a property of the rail rather than something producers
 * negotiate between themselves; a producer added later is appended here.
 */
export const CONTEXT_ITEM_PRODUCERS = [
  'effective-context-change',
  'tool-availability',
  'recency-digest',
  'compaction',
] as const;

export type ContextItemProducer = (typeof CONTEXT_ITEM_PRODUCERS)[number];

/** The persisted envelope. Payload validation belongs to each producer. */
export interface ContextItemPart {
  readonly type: 'data-context';
  readonly data: {
    readonly v: 1;
    readonly producer: string;
    /**
     * As PARSED, not as recognized: validation accepts any string here, so
     * typing it as the closed union would let a caller pass a future form
     * straight into rendering as though it were recognized. `resolveForm` is
     * the only narrowing to `ContextItemForm`.
     */
    readonly form?: string;
    readonly runId: string;
    readonly payload: UnknownRecord;
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Producer names are model-visible attribute values, so keep them boring. */
const PRODUCER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Exact-key-set matching. An added field is a rejected part, not a tolerated
 * one — that is what stops a client smuggling fields past the validator, and
 * it is also why an optional field needs its own accepted key set below
 * rather than being waved through.
 */
function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is UnknownRecord {
  return (
    isRecord(value) &&
    Object.keys(value).sort(compareCodePoints).join('\0') ===
      [...expectedKeys].sort(compareCodePoints).join('\0')
  );
}

/**
 * Strict persisted-shape validation of the ENVELOPE only.
 *
 * `form` is genuinely optional: an item may decline to declare one, and an
 * absent form renders as opaque content. Both key sets are therefore
 * accepted, and neither tolerates an extra field.
 */
export function isContextItemPart(value: unknown): value is ContextItemPart {
  if (
    !isExactRecord(value, ['data', 'type']) ||
    value['type'] !== 'data-context'
  ) {
    return false;
  }
  const data = value['data'];
  if (
    !isExactRecord(data, ['form', 'payload', 'producer', 'runId', 'v']) &&
    !isExactRecord(data, ['payload', 'producer', 'runId', 'v'])
  ) {
    return false;
  }
  if (
    data['v'] !== 1 ||
    !isString(data['producer']) ||
    !PRODUCER_PATTERN.test(data['producer']) ||
    !isString(data['runId']) ||
    !UUID_PATTERN.test(data['runId']) ||
    !isRecord(data['payload'])
  ) {
    return false;
  }
  return data['form'] === undefined || isString(data['form']);
}

/**
 * An unrecognized form is treated as absent rather than rejected. Rejecting
 * it would make adding a form a coordinated revision boundary, which is the
 * tax this envelope exists to remove.
 */
export function resolveForm(
  part: ContextItemPart,
): ContextItemForm | undefined {
  const form = part.data.form;
  return form !== undefined && isContextItemForm(form) ? form : undefined;
}

function isContextItemForm(value: string): value is ContextItemForm {
  return CONTEXT_ITEM_FORMS.some((form) => form === value);
}

/** An unrecognized producer parses and is recorded, but renders nothing. */
export function isRecognizedProducer(
  producer: string,
): producer is ContextItemProducer {
  return CONTEXT_ITEM_PRODUCERS.some((known) => known === producer);
}

/** The only application authoring path. Server-only by construction. */
export function createContextItemPart(input: {
  readonly producer: ContextItemProducer;
  readonly form?: ContextItemForm;
  readonly runId: string;
  readonly payload: UnknownRecord;
}): ContextItemPart {
  const part: ContextItemPart = {
    type: 'data-context',
    data: {
      v: 1,
      producer: input.producer,
      ...(input.form !== undefined && { form: input.form }),
      runId: input.runId,
      payload: input.payload,
    },
  };
  if (!isContextItemPart(part)) {
    throw new TypeError('Invalid server-authored context item');
  }
  return part;
}

export interface ClientTextPart {
  readonly type: 'text';
  readonly text: string;
}

/**
 * Defense-in-depth for direct service callers that bypass the HTTP DTO: a
 * client may author text and nothing else. Every context item is server-authored,
 * so a client-supplied item-shaped part is discarded rather than trusted.
 */
export function sanitizeClientMessageParts(
  parts: readonly unknown[],
): ClientTextPart[] {
  return parts.flatMap((part) => {
    if (
      !isRecord(part) ||
      !('type' in part) ||
      part.type !== 'text' ||
      !('text' in part) ||
      !isString(part.text)
    ) {
      return [];
    }
    return [{ type: 'text' as const, text: part.text }];
  });
}

export const CONTEXT_ITEM_TAG = 'system-reminder';

/**
 * The provenance line every item carries.
 *
 * One line, not a paragraph: it is paid for on every item and accumulates in
 * history until compaction, and an identical paragraph repeated on every item
 * is skimmed rather than read. The full explanation lives in the packaged
 * system prompt, which sits inside the cached prefix and is paid for once —
 * but it is additive rather than sufficient, because an operator may replace
 * that prompt wholesale, so this line is what keeps an item self-identifying
 * with no configuration able to remove it.
 */
export const CONTEXT_ITEM_PROVENANCE =
  'Inserted by llame; not written by the user.';

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Render one item's envelope around producer-authored body text.
 *
 * The envelope is core-owned: producers supply the body, never the framing,
 * so provenance and escaping are enforced in one place rather than trusted to
 * every future producer.
 */
export function renderContextItem(input: {
  readonly producer: string;
  readonly form: ContextItemForm | undefined;
  readonly body: string;
}): string | null {
  // Fail closed HERE rather than relying on a producer dispatch returning null
  // further out: this is the only function that can put an envelope in front of
  // the model, so an older worker reading a newer API's producer must be unable
  // to emit it even if a future caller forgets the check.
  if (!isRecognizedProducer(input.producer)) return null;
  const attributes = [
    `producer="${escapeXmlAttribute(input.producer)}"`,
    ...(input.form === undefined
      ? []
      : [`form="${escapeXmlAttribute(input.form)}"`]),
  ].join(' ');
  return [
    `<${CONTEXT_ITEM_TAG} ${attributes}>`,
    CONTEXT_ITEM_PROVENANCE,
    input.body,
    `</${CONTEXT_ITEM_TAG}>`,
  ].join('\n');
}

/**
 * Order items by the fixed producer precedence, preserving emission order
 * within one producer.
 *
 * Intra-producer order is load-bearing, not incidental: the recency digest
 * can emit a supersession and a later delta on the same turn, and a delta
 * rendered before the supersession that precedes it reads as already
 * superseded. `Array.prototype.sort` is specified as stable, so emission
 * order survives the sort without a secondary key.
 */
export interface ContentTextBlock {
  readonly type: 'text';
  readonly text: string;
}

/**
 * Assemble one user message's content: one text block per rendered item, then
 * the user's own visible text in a block of its own.
 *
 * Blocks rather than one joined string, because the boundary between
 * server-authored framing and user-authored text then becomes structural
 * instead of a `\n\n` convention user input can imitate. Forging content
 * inside a block stays possible — that is what neutralization is for — but
 * forging a boundary does not.
 *
 * A turn carrying no item yields a single block, which the provider adapter
 * collapses back to a plain string, so an item-free turn serializes exactly
 * as it did before the rail existed.
 */
export function assembleUserContent(input: {
  readonly renderedItems: readonly string[];
  readonly visibleText: string;
}): ContentTextBlock[] {
  return [
    ...input.renderedItems.map((text) => ({ type: 'text' as const, text })),
    ...(input.visibleText.length > 0
      ? [{ type: 'text' as const, text: input.visibleText }]
      : []),
  ];
}

export function orderContextItems<T extends { readonly producer: string }>(
  items: readonly T[],
): T[] {
  const rank = (producer: string) => {
    const index = CONTEXT_ITEM_PRODUCERS.findIndex(
      (known) => known === producer,
    );
    return index === -1 ? CONTEXT_ITEM_PRODUCERS.length : index;
  };
  return [...items].sort((a, b) => rank(a.producer) - rank(b.producer));
}
