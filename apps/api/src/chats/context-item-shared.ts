/**
 * Low-level helpers shared by every context-item producer
 * (context-item-producers.ts and tool-availability-context-item.ts): the
 * exact-key-set payload guard, the non-empty-string guard, and the
 * envelope-rendering constructor. Split out so the producer modules can depend
 * on this without depending on each other.
 */
import {
  createContextItemPart,
  renderContextItem,
  type AuthoredContextItemPart,
  type ContextItemForm,
} from './context-item';
import { compareCodePoints } from '../canonical-json';
import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

/** A string with at least one non-whitespace character. */
export function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

export function isExactRecord(
  value: unknown,
  expectedKeys: ReadonlyArray<string>,
): value is UnknownRecord {
  return (
    isRecord(value) &&
    Object.keys(value).sort(compareCodePoints).join('\0') ===
      [...expectedKeys].sort(compareCodePoints).join('\0')
  );
}

export function createRenderedContextItem(input: {
  readonly producer: Parameters<typeof createContextItemPart>[0]['producer'];
  readonly form?: ContextItemForm;
  readonly runId: string;
  readonly payload: UnknownRecord;
  readonly body: string;
}): AuthoredContextItemPart {
  const text = renderContextItem({
    producer: input.producer,
    form: input.form,
    body: input.body,
  });
  if (text === null) {
    throw new TypeError('Invalid server-authored context item producer');
  }
  return createContextItemPart({
    producer: input.producer,
    ...(input.form !== undefined && { form: input.form }),
    runId: input.runId,
    payload: input.payload,
    text,
  });
}
