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
 * A native file tool renders as text because the SDK output type `text` is
 * what carries its media reference. A `read` success with content uses the
 * read text shape — one header line, the attribution lines it carries, its
 * numbered content, and the continuation line; every other result, successes
 * and failures alike, renders as a JSON value.
 */

import { z } from 'zod';

import {
  renderReadText,
  serializeNativeModelOutput,
} from '@workspace/native-file-tools';
import {
  hasEscapedKeyCollision,
  isString,
  modelVisibleResult,
  neutralizeReservedDelimiters,
  type UnknownRecord,
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
 * rendering had to escape the serialized JSON as one text. A `read` success
 * with content renders in the read text shape; the one reserved-name rule is
 * applied once to the whole rendering, and that is what the cap measures.
 */
function modelView(toolName: string, result: ToolResult): ModelView {
  const normalized = normalizedResult(result);
  if (toolName === 'read' && isReadTextResult(normalized)) {
    return {
      text: neutralizeReservedDelimiters(renderReadText(normalized)),
      escapedAsText: true,
    };
  }
  const visible = modelVisibleResult(normalized);
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
 * A `read` success that carries content: a file of any representation, or a
 * directory listing. Image, PDF, and skill-catalog results carry no content
 * and keep their JSON rendering.
 */
function isReadTextResult(result: ToolResult): boolean {
  return (
    result.status === 'success' &&
    (result.kind === 'file' || result.kind === 'directory') &&
    isString(result.content)
  );
}

/**
 * The text rendering of a result, for every tool and both outcomes. `toolName`
 * selects a tool's own text shape: a `read` success renders as its header,
 * attribution lines, numbered content, and continuation line; every other
 * result renders its serialized form.
 */
export function renderToolResultText(
  toolName: string,
  result: ToolResult,
): string {
  return modelView(toolName, result).text;
}

/**
 * Width the attribution lines of a read envelope add to the model-facing
 * rendering: rendering a minimal read with the envelope fields, minus the same
 * read without them. A caller withholds that much room from the read bound, so
 * the envelope's own lines stay inside the shared cap
 * (tool-result-rendering "Bounds are measured on the neutralized rendering").
 */
export function readAttributionReserve(envelope: UnknownRecord): number {
  const minimal: UnknownRecord = {
    status: 'success',
    kind: 'file',
    path: '',
    representation: 'text',
    content: '',
    shownRange: null,
    requestedRange: null,
    truncated: false,
  };
  return (
    neutralizeReservedDelimiters(renderReadText({ ...minimal, ...envelope }))
      .length - neutralizeReservedDelimiters(renderReadText(minimal)).length
  );
}

export function renderToolResultForModel(
  toolName: string,
  result: ToolResult,
): ToolResultRendering {
  const { text, escapedAsText } = modelView(toolName, result);
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
