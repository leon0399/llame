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
 * failures alike, renders as a JSON value.
 */

import { z } from 'zod';

import { serializeNativeModelOutput } from '@workspace/native-file-tools';
import {
  hasEscapedKeyCollision,
  modelVisibleResult,
  neutralizeReservedDelimiters,
} from '@workspace/runtime-safety';

import {
  type ToolMediaRef,
  type ToolResultOutput,
  toolResultOutput,
} from '../media/epoch-admission';
import { type ToolResult } from './types';

/**
 * The native file tools: their result reaches the model as serialized text,
 * and a Machine variant shares its host counterpart's name.
 */
const NATIVE_FILE_TOOL_NAMES = {
  read: true,
  edit: true,
  write: true,
} satisfies Record<string, true>;

/** The JSON value the SDK's `json` tool output accepts, validated here. */
const jsonValue = z.json();

type ToolResultRendering =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'json'; readonly value: z.infer<typeof jsonValue> };

/**
 * The failure shape every path renders: the fields the stored part keeps and
 * replay and Continue rebuild. A diagnostic a result carries beside them — the
 * directory a failed worktree entry left behind — is not part of the rendering,
 * so live, replay, and Continue stay the same text.
 */
function normalizedResult(result: ToolResult): ToolResult {
  if (result.status !== 'error') return result;
  const { rejectedUrl } = result;
  return {
    status: 'error',
    type: result.type,
    message: result.message,
    ...(rejectedUrl !== undefined && { rejectedUrl }),
  };
}

/** One tool result as the model may see it. */
interface ModelView {
  /** The rendering the model reads. */
  readonly text: string;
  /** Whether the rendering escaped the serialized JSON as one text, because
   *  escaping key by key would have collided two members. */
  readonly escapedAsText: boolean;
}

/**
 * The result as the model may see it, with its text rendering and whether that
 * rendering had to escape the serialized JSON as one text.
 */
function modelView(result: ToolResult): ModelView {
  const visible = modelVisibleResult(normalizedResult(result));
  // The deep neutralizer escapes one key and one value at a time, so an object
  // holding both a key and that key's escaped spelling would keep only the
  // later member. Escaping the serialized JSON as one text cannot collide, and
  // the model reads the same JSON either way.
  if (hasEscapedKeyCollision(visible)) {
    return {
      text: neutralizeReservedDelimiters(JSON.stringify(visible) ?? 'null'),
      escapedAsText: true,
    };
  }
  return { text: serializeNativeModelOutput(visible), escapedAsText: false };
}

/**
 * The text rendering of a result, for every tool and both outcomes. `toolName`
 * is the parameter a tool's own text shape branches on; in this layer every
 * tool renders its serialized result, which is also what the JSON rendering
 * below derives its value from.
 */
export function renderToolResultText(
  _toolName: string,
  result: ToolResult,
): string {
  return modelView(result).text;
}

export function renderToolResultForModel(
  toolName: string,
  result: ToolResult,
): ToolResultRendering {
  const { text, escapedAsText } = modelView(result);
  if (Object.hasOwn(NATIVE_FILE_TOOL_NAMES, toolName)) {
    return { kind: 'text', text };
  }
  // Escaping the text as a whole leaves two members with the same spelling,
  // and a JSON value would keep one; its text keeps both values visible.
  if (escapedAsText) return { kind: 'text', text };
  // The SDK serializes a JSON output with `JSON.stringify`, so the value is the
  // rendering's own round trip: an undefined member, a `toJSON` method, or a
  // bare payload becomes exactly the JSON text the model would have read.
  return { kind: 'json', value: jsonValue.parse(JSON.parse(text)) };
}

/** The output one settled result sends: its text with its media reference, or
 *  its JSON value. */
export function modelToolOutput(
  rendering: ToolResultRendering,
  ref: ToolMediaRef | undefined,
): ToolResultOutput {
  return rendering.kind === 'json'
    ? { type: 'json', value: rendering.value }
    : toolResultOutput(rendering.text, ref);
}

/** The result cap's measure for one tool: the code units of its rendering. */
export function measureToolResultForModel(
  toolName: string,
): (candidate: ToolResult) => number {
  return (candidate) => renderToolResultText(toolName, candidate).length;
}
