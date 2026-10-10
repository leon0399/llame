import type { FileHandle } from "node:fs/promises";
import { NativeFileError, type ReadTarget } from "./path";
import type { FileFailure } from "./source-lines";

/** The leading bytes every signature below fits in. */
const SIGNATURE_BYTES = 12;

/** The one refusal for a selector on an image, on every source. */
export const IMAGE_SELECTOR_MESSAGE = "An image is read without a selector.";

/**
 * The image an owner's media store holds for the bytes a read handed it: the
 * object's `media://` locator and the stored original's format and size.
 */
export type ImageIngestSuccess = {
  status: "success";
  media: string;
  mediaType: string;
  width: number;
  height: number;
};

/**
 * What a reader does with a regular file whose leading bytes are an image
 * (vision-media D7). It is given the file's size before any byte is read, so
 * a file over the store's bound is refused without being read whole; it reads
 * the bytes only through `readBytes`. The caller binds the source label, the
 * locator as submitted, when it builds the hook. A refusal is a structured
 * failure, never a fallback to text. A reader without a hook keeps every file
 * on the text path.
 */
export type ImageReadHook = (file: {
  byteSize: number;
  readBytes: () => Promise<Buffer>;
}) => Promise<ImageIngestSuccess | FileFailure>;

/** A read whose bytes were an image: the stored object, no content. */
export type ImageReadSuccess = ImageIngestSuccess & {
  kind: "image";
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

/**
 * The image read of an opened regular file, or undefined when the source has
 * no image hook or the file's leading bytes match no image signature, and the
 * text path applies. The probe is a positional read, so it leaves the handle
 * where the text readers start. A selector is refused before anything is
 * counted or ingested.
 */
export async function readImage(
  file: FileHandle,
  byteSize: number,
  target: ReadTarget,
  source: {
    image?: ImageReadHook | undefined;
    signal?: AbortSignal | undefined;
  },
): Promise<ImageReadSuccess | FileFailure | undefined> {
  const { image, signal } = source;
  if (image === undefined) return undefined;
  const head = Buffer.alloc(SIGNATURE_BYTES);
  const { bytesRead } = await file.read(head, 0, SIGNATURE_BYTES, 0);
  if (!isImageSignature(head.subarray(0, bytesRead))) return undefined;
  // Any selector, including an open-ended or tail member that is still
  // pending a line count, leaves the target off its no-selector defaults.
  if (
    target.raw ||
    target.outline === true ||
    target.offset > 0 ||
    target.limit !== undefined ||
    target.ranges !== undefined ||
    target.pending !== undefined
  )
    throw new NativeFileError("invalid_selector", IMAGE_SELECTOR_MESSAGE);
  const ingested = await image({
    byteSize,
    readBytes: () => file.readFile({ signal }),
  });
  if (ingested.status === "error") return ingested;
  return {
    ...ingested,
    kind: "image",
    path: target.path,
    ...(target.realPath !== undefined && { realPath: target.realPath }),
  };
}
