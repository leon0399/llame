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
 * numbered content, and the continuation line; an `edit` success uses the
 * mutation shape with its post-edit region; a `write` success is one status
 * line; a `grep` page its runs of passages under one file line each and the
 * cursor that continues it; a `bash` result uses its status header and streams.
 * Every other result, successes and failures alike, renders as a JSON value.
 */

import { z } from 'zod';

import { renderBashText } from '@workspace/bash-executor';
import {
  measureReadRendering,
  renderEditText,
  renderGrepText,
  renderReadText,
  renderWriteText,
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

/** The text shape a tool result renders in, or `undefined` to keep its JSON. */
type TextResultRenderer = (result: ToolResult) => string | undefined;

/** The tools whose result reaches the model as text. */
type TextResultToolName = 'read' | 'edit' | 'write' | 'grep' | 'bash';

/**
 * The text renderers, one per tool whose result reaches the model as text; a
 * Machine variant shares its host counterpart's name. A key marks the tool as
 * one whose failure keeps the SDK output type `text`, with its JSON body. The
 * value renders a success, and `undefined` keeps that result's JSON rendering.
 */
const TEXT_RESULT_RENDERERS: Readonly<
  Record<TextResultToolName, TextResultRenderer>
> = {
  // A `read` success renders as text when it carries content: a file of any
  // representation, or a directory listing. An image, PDF, or skill-catalog
  // result carries none and keeps its JSON rendering.
  read: (result) =>
    result.status === 'success' &&
    (result.kind === 'file' || result.kind === 'directory') &&
    isString(result.content)
      ? renderReadText(result)
      : undefined,
  edit: renderEditText,
  write: renderWriteText,
  grep: renderGrepText,
  bash: renderBashText,
};

/** Whether this build renders a tool's result as text, failures included. */
function isTextResultTool(toolName: string): toolName is TextResultToolName {
  return Object.hasOwn(TEXT_RESULT_RENDERERS, toolName);
}

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
 * rendering had to escape the serialized JSON as one text. A `read`, `edit`,
 * `write`, `grep`, or `bash` success renders in its own text shape; the one
 * reserved-name rule is applied once to the whole rendering, and that is what
 * the cap measures.
 */
function modelView(toolName: string, result: ToolResult): ModelView {
  const normalized = normalizedResult(result);
  if (normalized.status === 'success' && isTextResultTool(toolName)) {
    const text = TEXT_RESULT_RENDERERS[toolName](normalized);
    if (text !== undefined)
      return {
        text: neutralizeReservedDelimiters(text),
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
 * The text rendering of a result, for every tool and both outcomes. A tool in
 * `TEXT_RESULT_RENDERERS` renders a success in its own text shape and a failure
 * as its JSON body; every other result renders its serialized form.
 */
export function renderToolResultText(
  toolName: string,
  result: ToolResult,
): string {
  return modelView(toolName, result).text;
}

/** The smallest read a result can render: the header alone, no total. */
const MINIMAL_READ: UnknownRecord = {
  status: 'success',
  kind: 'file',
  path: '',
  representation: 'text',
  content: '',
  shownRange: null,
  requestedRange: null,
  truncated: false,
};

/** That header's own width in the model-facing rendering, which is constant. */
const MINIMAL_READ_WIDTH = measureReadRendering(MINIMAL_READ);

/**
 * Width the attribution lines of a read envelope add to the model-facing
 * rendering: rendering a minimal read with the envelope fields, minus the same
 * read without them. A caller withholds that much room from the read bound, so
 * the envelope's own lines stay inside the shared cap
 * (tool-result-rendering "Bounds are measured on the neutralized rendering").
 */
export function readAttributionReserve(envelope: UnknownRecord): number {
  return (
    measureReadRendering({ ...MINIMAL_READ, ...envelope }) - MINIMAL_READ_WIDTH
  );
}

export function renderToolResultForModel(
  toolName: string,
  result: ToolResult,
): ToolResultRendering {
  const { text, escapedAsText } = modelView(toolName, result);
  if (isTextResultTool(toolName)) return { kind: 'text', text };
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
