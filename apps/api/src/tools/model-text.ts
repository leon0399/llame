/**
 * The one function that turns a tool result into the content a model reads.
 *
 * Its input is the result object an executor returned — a success, or a failure
 * with its type, message, and locators — so the live result, the replayed
 * result of a later turn, and the kept result of a Continue Run are all the
 * same rendering of the same object. The stored field a model must not see,
 * `display`, is removed here, a legacy top-level `thumbnail` included, and the
 * reserved-name rule is applied before the result is measured or sent.
 *
 * A native file tool renders as its serialized text because the SDK output type
 * `text` is what carries its media reference; every other tool, successes and
 * failures alike, renders as a JSON value. The text shapes of the content
 * bearing tools replace the JSON of those tools in the later layers.
 */

import { z } from 'zod';

import { serializeNativeModelOutput } from '@workspace/native-file-tools';
import {
  modelVisibleResult,
  neutralizeReservedDelimitersDeep,
} from '@workspace/runtime-safety';

import { type ToolResult } from './types';

/**
 * The native file tools: their result reaches the model as serialized text,
 * and a Machine variant shares its host counterpart's name.
 */
const NATIVE_FILE_TOOL_NAMES = {
  read: true,
  edit: true,
  write: true,
} as const satisfies Record<string, true>;

/** The JSON value the SDK's `json` tool output accepts, validated here. */
const jsonValue = z.json();

/** One rendering: text, or the JSON value the SDK serializes itself. */
export type ToolResultRendering =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'json'; readonly value: z.infer<typeof jsonValue> };

export function renderToolResultForModel(
  toolName: string,
  result: ToolResult,
): ToolResultRendering {
  if (Object.hasOwn(NATIVE_FILE_TOOL_NAMES, toolName)) {
    return { kind: 'text', text: serializeNativeModelOutput(result) };
  }
  // The SDK serializes a JSON output with `JSON.stringify`, so the value takes
  // the same round trip: an undefined member, a `toJSON` method, or a bare
  // payload becomes exactly the JSON text the model would have read.
  const visible = neutralizeReservedDelimitersDeep(modelVisibleResult(result));
  return {
    kind: 'json',
    value: jsonValue.parse(JSON.parse(JSON.stringify(visible) ?? 'null')),
  };
}

/** The payload text a rendering carries, either way it was rendered. */
export function renderedText(rendering: ToolResultRendering): string {
  return rendering.kind === 'text'
    ? rendering.text
    : JSON.stringify(rendering.value);
}
