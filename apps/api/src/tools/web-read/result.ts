import {
  NativeFileError,
  applySelectorSuffix,
  measureNativeModelOutput,
  selectMultiRangeLines,
  selectSourceLines,
  splitSourceLines,
  type ReadSuccess,
  type ReadTarget,
} from '@workspace/native-file-tools';
import { type UnknownRecord } from '@workspace/runtime-safety';

import { type WebResponse } from './http-client';
import { type WebLocator } from './locator';
import { type WebRender, type WebRenderMethod } from './pipeline';

/** The native read success object, extended with the web envelope. */
export type WebReadSuccess = ReadSuccess & UnknownRecord;

type WebReadFailure = {
  readonly status: 'error';
  readonly type: string;
  readonly message: string;
};

/** The fields a web read adds to the native read result. `notes` is added
 *  only when the render reported something, so an empty list is absent. */
type WebResultEnvelope = {
  finalUrl: string;
  method: WebRenderMethod;
  notes?: ReadonlyArray<string>;
};

/** The envelope reports where the content came from: a probe that won names
 *  its own response's URL, and every other render names the call's. */
function webResultEnvelope(
  response: WebResponse,
  render: WebRender,
): WebResultEnvelope {
  const envelope: WebResultEnvelope = {
    finalUrl: render.finalUrl ?? response.finalUrl,
    method: render.method,
  };
  const notes = render.notes ?? [];
  if (notes.length > 0) envelope.notes = notes;
  return envelope;
}

/**
 * Assemble the tool's own read result over the rendered text. The rendered
 * text is measured against the shared native bound, which first reserves the
 * room the envelope needs, and the locator's line selector applies to it
 * exactly as to a local file.
 */
export function buildWebReadResult(
  locator: WebLocator,
  response: WebResponse,
  render: WebRender,
): WebReadSuccess | WebReadFailure {
  const envelope = webResultEnvelope(response, render);
  try {
    const target: ReadTarget = {
      ...applySelectorSuffix(locator.url, locator.selector),
      reserveCodeUnits: measureNativeModelOutput(envelope),
    };
    // A comma request needs the multi-range walk: the render is text in
    // hand, so it cannot go through the file-backed stream reader, and
    // `selectSourceLines` serves one window.
    const read =
      target.ranges === undefined
        ? selectSourceLines(render.content, target)
        : selectMultiRangeLines(render.content, target);
    return { ...read, ...envelope };
  } catch (error) {
    if (!(error instanceof NativeFileError)) throw error;
    return {
      status: 'error',
      type: error.type,
      // `NativeFileError` defaults its message to its type, which tells the
      // model nothing; only wording the thrower chose is worth passing on.
      message:
        error.message === error.type
          ? selectorFailureMessage(render.content, locator.selector)
          : error.message,
    };
  }
}

/**
 * A selector the render could not serve carries no message of its own, and a
 * bare error type tells the model nothing it can act on: a page's length is
 * unknown until it is read, so the count it should have selected within is
 * the one fact worth reporting.
 */
function selectorFailureMessage(
  content: string,
  selector: string | undefined,
): string {
  const lines = splitSourceLines(content).length;
  const written = selector === undefined ? '' : `:${selector} `;
  return `The selector ${written}selected no line of this page, which rendered ${lines} line${lines === 1 ? '' : 's'} numbered from 1. Write :N, :N-M, or :N+K within 1-${lines}, or omit the selector to read from the start.`;
}
