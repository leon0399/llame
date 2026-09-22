import {
  NativeFileError,
  applySelectorSuffix,
  measureNativeModelOutput,
  selectMultiRangeLines,
  selectSourceLines,
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
    return { status: 'error', type: error.type, message: error.message };
  }
}
