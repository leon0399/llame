import type { FileHandle } from "node:fs/promises";
import { NativeFileError, type ReadTarget } from "./path";
import type { FileFailure } from "./source-lines";

/** The leading bytes every signature below fits in. */
const SIGNATURE_BYTES = 12;

/** The one refusal for a selector on an image or PDF, on every source. */
export const MEDIA_SELECTOR_MESSAGE =
  "An image or PDF is read without a selector.";

/**
 * An image a read decoded without storing it (vision-media D7): the original's
 * format and size, and the display-only thumbnail data URL its stored tool
 * output carries under `display` and no model ever receives. An image whose
 * thumbnail would exceed the cap has none.
 */
export type MediaDecodeSuccess =
  | {
      status: "success";
      kind: "image";
      mediaType: string;
      width: number;
      height: number;
      /** Owner-UI data: stored with the result, never rendered (D2). */
      display?: { thumbnail?: string };
    }
  | {
      status: "success";
      kind: "pdf";
      mediaType: "application/pdf";
      pages: number;
      byteSize: number;
    };

/**
 * What a reader does with a regular file whose leading bytes are an image or
 * PDF. It is given the file's size before it is read whole, so
 * a file over the byte bound is refused without being read whole; it reads
 * the bytes only through `readBytes`, and stores nothing. `signal` is the
 * read's abort signal: a hook that keeps anything checks it last, so a read
 * abandoned mid-decode keeps nothing. The caller binds the locator as
 * submitted when it builds the hook. A refusal is a structured failure,
 * never a fallback to text. A reader without a hook keeps every file on the
 * text path.
 */
export type MediaReadHook = (file: {
  kind: "image" | "pdf";
  byteSize: number;
  readBytes: () => Promise<Buffer>;
  signal?: AbortSignal | undefined;
}) => Promise<MediaDecodeSuccess | FileFailure>;

/** A read whose bytes were an image or PDF: metadata, no content. */
export type MediaReadSuccess = MediaDecodeSuccess & {
  path: string;
  /** Host paths only, as on a text read. */
  realPath?: string;
};

/**
 * Whether `head` starts with a PNG, JPEG, GIF, or WebP signature. The
 * extension never takes part, and SVG, being text, matches none.
 */
function isImageSignature(head: Buffer): boolean {
  const ascii = (start: number, end: number) =>
    head.toString("latin1", start, end);
  return (
    ascii(0, 8) === "\x89PNG\r\n\x1a\n" ||
    (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) ||
    ascii(0, 6) === "GIF87a" ||
    ascii(0, 6) === "GIF89a" ||
    (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP")
  );
}

/** The media kind a file's leading bytes name, or undefined for the text path. */
function mediaKindOf(head: Buffer): "image" | "pdf" | undefined {
  const isPdf = head.toString("latin1", 0, 5) === "%PDF-";
  if (isPdf) return "pdf";
  return isImageSignature(head) ? "image" : undefined;
}

/**
 * The media read of an opened regular file, or undefined when the source has
 * no media hook or the file's leading bytes match no media signature, and the
 * text path applies. The probe is a positional read, so it leaves the handle
 * where the text readers start. A selector is refused before anything is
 * counted or decoded.
 */
export async function readMedia(
  file: FileHandle,
  byteSize: number,
  target: ReadTarget,
  source: {
    media?: MediaReadHook | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<MediaReadSuccess | FileFailure | undefined> {
  const { media, signal } = source;
  if (media === undefined) return undefined;
  const head = Buffer.alloc(SIGNATURE_BYTES);
  const { bytesRead } = await file.read(head, 0, SIGNATURE_BYTES, 0);
  const kind = mediaKindOf(head.subarray(0, bytesRead));
  if (kind === undefined) return undefined;
  // pending a line count, leaves the target off its no-selector defaults.
  if (
    target.raw ||
    target.outline === true ||
    target.offset > 0 ||
    target.limit !== undefined ||
    target.ranges !== undefined ||
    target.pending !== undefined
  )
    throw new NativeFileError("invalid_selector", MEDIA_SELECTOR_MESSAGE);
  const decoded = await media({
    kind,
    byteSize,
    readBytes: () => file.readFile({ signal }),
    signal,
  });
  if (decoded.status === "error") return decoded;
  return {
    ...decoded,
    path: target.path,
    ...(target.realPath !== undefined && { realPath: target.realPath }),
  };
}

/** What a byte-buffer media read reports: the display path and its canonical
 *  form, exactly as `readMedia` takes them from a read target. */
export type MediaBufferTarget = {
  readonly path: string;
  readonly realPath?: string;
  /** The read selector the caller split off; a media read takes none. */
  readonly selector?: string;
};

/**
 * The media read of bytes already in memory, for a source that cannot hand
 * this package a local file handle (a Machine streams `fs.bytes`, and the hub
 * prepares what it receives exactly as a local read would). Same signature
 * probe, hook contract, selector refusal, and result shape as `readMedia`;
 * `undefined` means the bytes are not an image or PDF and the text path
 * applies.
 */
export async function readMediaBytes(
  bytes: Buffer,
  target: MediaBufferTarget,
  source: {
    media?: MediaReadHook | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<MediaReadSuccess | FileFailure | undefined> {
  const { media, signal } = source;
  if (media === undefined) return undefined;
  const kind = mediaKindOf(bytes.subarray(0, SIGNATURE_BYTES));
  if (kind === undefined) return undefined;
  if (target.selector !== undefined)
    throw new NativeFileError("invalid_selector", MEDIA_SELECTOR_MESSAGE);
  signal?.throwIfAborted();
  const decoded = await media({
    kind,
    byteSize: bytes.byteLength,
    readBytes: () => Promise.resolve(bytes),
    signal,
  });
  if (decoded.status === "error") return decoded;
  return {
    ...decoded,
    path: target.path,
    ...(target.realPath !== undefined && { realPath: target.realPath }),
  };
}
