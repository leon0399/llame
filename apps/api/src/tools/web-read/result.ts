import {
  NativeFileError,
  applySelectorSuffix,
  measureNativeModelOutput,
  outlineReader,
  renderCollectedDirectory,
  resolveEndRelativeSelector,
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

const ADAPTER_TAIL_TOO_LARGE_MESSAGE =
  "The adapter document was cut at the web read's document bound, so its last lines are not the document's last lines; read the range from a line instead of a tail.";

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
      // A selector the render could not serve carries no message of its own,
      // and a bare type tells the model nothing it can act on, so the count it
      // could not select within is reported. Wording a reader chose for a
      // refusal of its own — a bound the grammar rejects, a media type that
      // has no outline — is passed on unchanged.
      message:
        error.type === 'invalid_selector' && error.message === error.type
          ? selectorFailureMessage(render.content, locator.selector)
          : error.message,
    };
  }
}

async function buildWebFileResult(
  target: ReadTarget,
  envelope: WebResultEnvelope,
  render: WebRender,
): Promise<WebReadSuccess | WebReadFailure> {
  // The render holds its own text in memory, so its line count is the count
  // an `N-` or a `-K` resolves against, exactly as a file's own lines are.
  const renderedLines =
    target.pending === undefined ? undefined : splitSourceLines(render.content);
  const resolved =
    renderedLines === undefined
      ? target
      : resolveEndRelativeSelector(target, renderedLines.length);
  if (resolved.outline) {
    if (render.truncated === true) {
      return {
        status: 'error',
        type: 'representation_too_large',
        message: ADAPTER_OUTLINE_TOO_LARGE_MESSAGE,
      };
    }
    const lines = renderedLines ?? splitSourceLines(render.content);
    const read = await outlineReader(render.mediaType)(lines, resolved);
    return { ...read, ...envelope };
  }
  // A cut document's end is not the document's end, so a `-K` member is
  // refused rather than answered with the wrong end. An `N-` member names a
  // real start, and the ordinary truncation note already covers the cut.
  if (
    render.truncated === true &&
    target.pending !== undefined &&
    /(?:^|,)-/u.test(target.pending)
  ) {
    return {
      status: 'error',
      type: 'representation_too_large',
      message: ADAPTER_TAIL_TOO_LARGE_MESSAGE,
    };
  }
  // A comma request needs the multi-range walk: the render is text in
  // hand, so it cannot go through the file-backed stream reader, and
  // `selectSourceLines` serves one window.
  const read =
    resolved.ranges === undefined
      ? selectSourceLines(render.content, resolved, render.mediaType)
      : selectMultiRangeLines(render.content, resolved, render.mediaType);
  return { ...read, ...envelope };
}

function directorySelectorFailure(
  target: ReadTarget,
): WebReadFailure | undefined {
  // A comma list is refused whether it was placed or is still waiting for the
  // listing's entry count: a flat slice has no second interval to show.
  const comma =
    target.ranges !== undefined || (target.pending?.includes(',') ?? false);
  const message = target.outline
    ? 'The :outline member is not supported for directory reads.'
    : target.raw
      ? 'The :raw selector is not supported for directory reads.'
      : comma
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
    // The listing's own renderer places the pending members against the
    // requested level's entry count and returns its empty page for one that
    // starts past the last entry.
    ...(target.pending !== undefined && { pending: target.pending }),
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
