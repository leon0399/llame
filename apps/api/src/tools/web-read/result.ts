import {
  NativeFileError,
  applySelectorSuffix,
  measureNativeModelOutput,
  outlineReader,
  renderCollectedDirectory,
  selectMultiRangeLines,
  selectSourceLines,
  splitSourceLines,
  type DirectorySuccess,
  type ReadSuccess,
  type ReadTarget,
} from '@workspace/native-file-tools';
import { type UnknownRecord } from '@workspace/runtime-safety';

import { type WebLocator } from './locator';
import { type WebAdapterProvenance } from './adapters/contract';
import {
  type WebDirectory,
  type WebRender,
  type WebRenderMethod,
} from './pipeline';

/** The native read success object, extended with the web envelope. */
export type WebReadSuccess = (ReadSuccess | DirectorySuccess) & UnknownRecord;

type WebReadFailure = {
  readonly status: 'error';
  readonly type: string;
  readonly message: string;
};

/** The fields a web read adds to the native read result. `notes` is added
 * only when the render reported something, so an empty list is absent. */
type WebResultEnvelope = {
  finalUrl: string;
  method: WebRenderMethod;
  adapter?: WebAdapterProvenance;
  notes?: ReadonlyArray<string>;
};

const ADAPTER_OUTLINE_TOO_LARGE_MESSAGE =
  "The adapter document was cut at the web read's document bound, so an outline would omit structure; read it without :outline.";

/** The envelope reports where the content came from: a probe that won names
 *  its own response's URL, and every other render names the call's. */
function webResultEnvelope(
  finalUrl: string,
  render: WebRender,
): WebResultEnvelope {
  const envelope: WebResultEnvelope = {
    finalUrl: render.finalUrl ?? finalUrl,
    method: render.method,
    ...(render.adapter !== undefined && { adapter: render.adapter }),
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
export async function buildWebReadResult(
  locator: WebLocator,
  finalUrl: string,
  render: WebRender,
): Promise<WebReadSuccess | WebReadFailure> {
  const envelope = webResultEnvelope(finalUrl, render);
  try {
    const target: ReadTarget = {
      ...applySelectorSuffix(locator.url, locator.selector),
      reserveCodeUnits: measureNativeModelOutput(envelope),
    };
    if (render.directory !== undefined) {
      return buildDirectoryReadResult(target, envelope, render.directory);
    }
    return await buildWebFileResult(target, envelope, render);
  } catch (error) {
    if (!(error instanceof NativeFileError)) throw error;
    return {
      status: 'error',
      type: error.type,
      // `NativeFileError` defaults its message to its type, which tells the
      // model nothing; only wording the thrower chose is worth passing on,
      message:
        error.message === error.type && error.type === 'invalid_selector'
          ? selectorFailureMessage(selectorContent(render), locator.selector)
          : error.message,
    };
  }
}

async function buildWebFileResult(
  target: ReadTarget,
  envelope: WebResultEnvelope,
  render: WebRender,
): Promise<WebReadSuccess | WebReadFailure> {
  if (target.outline) {
    if (render.truncated === true) {
      return {
        status: 'error',
        type: 'representation_too_large',
        message: ADAPTER_OUTLINE_TOO_LARGE_MESSAGE,
      };
    }
    const read = await outlineReader(render.mediaType)(
      splitSourceLines(render.content),
      target,
    );
    return { ...read, ...envelope };
  }
  // A comma request needs the multi-range walk: the render is text in
  // hand, so it cannot go through the file-backed stream reader, and
  // `selectSourceLines` serves one window.
  const read =
    target.ranges === undefined
      ? selectSourceLines(render.content, target)
      : selectMultiRangeLines(render.content, target);
  return { ...read, ...envelope };
}

function directorySelectorFailure(
  target: ReadTarget,
): WebReadFailure | undefined {
  const message = target.outline
    ? 'The :outline member is not supported for directory reads.'
    : target.raw
      ? 'The :raw selector is not supported for directory reads.'
      : target.ranges !== undefined
        ? 'Comma-separated selectors are not supported for directory reads.'
        : undefined;
  return message === undefined
    ? undefined
    : { status: 'error', type: 'invalid_selector', message };
}

function buildDirectoryReadResult(
  target: ReadTarget,
  envelope: WebResultEnvelope,
  directory: WebDirectory,
): WebReadSuccess | WebReadFailure {
  const refusal = directorySelectorFailure(target);
  if (refusal !== undefined) return refusal;
  const options = {
    displayPath: target.path,
    reserveCodeUnits: measureNativeModelOutput(envelope),
    ...(target.offset > 0 && { offset: target.offset }),
    ...(target.limit !== undefined && { limit: target.limit }),
  };
  const result = renderCollectedDirectory(
    directory.displayPath,
    directory.entries,
    options,
  );
  if (result.status === 'error') {
    return { status: 'error', type: result.type, message: result.message };
  }
  return { ...result, ...envelope };
}

function selectorContent(render: WebRender): string {
  if (render.directory === undefined) return render.content;
  const result = renderCollectedDirectory(
    render.directory.displayPath,
    render.directory.entries,
  );
  return result.status === 'success' ? result.content : '';
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
  // A render with no lines has no range to point at, so the sentence that
  // would name one is left out rather than naming `1-0`.
  if (lines === 0) {
    return `The selector ${written}selected no line of this page, which rendered no text.`;
  }
  return `The selector ${written}selected no line of this page, which rendered ${lines} line${lines === 1 ? '' : 's'} numbered from 1. Write :N, :N-M, or :N+K within 1-${lines}, or omit the selector to read from the start.`;
}
