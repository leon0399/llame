/**
 * The address checks the file operations share: the literal-path probe a
 * selector must not steal from an existing filename, the kernel's reading of
 * the request text (a trailing separator or a final `.`/`..` addresses a
 * directory), the missing-root suggestion guard, and the media signature that
 * selects the bytes path and words the one size refusal.
 */

import { constants } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { type MediaReadHook } from "@workspace/native-file-tools";
import type { NativeFailureResult } from "@workspace/machine-protocol";
import { MachineRequestError } from "./errors";
import type { GuardedPath, RootGuard } from "./guard";
import { isInsideRoots } from "./locators";

export const SIGNATURE_BYTES = 12;
export const OCTET_STREAM = "application/octet-stream";
export const NOT_FOUND_MESSAGE = "File not found.";
export const FILE_READ_FAILED_MESSAGE = "File could not be read.";
export const NOT_MEDIA_MESSAGE = "The file is not an image or PDF.";
const MEDIA_TOO_LARGE_MESSAGE = "The file exceeds the media byte bound.";
const IMAGE_TOO_LARGE_MESSAGE = "Image exceeds 20 MiB or 40 megapixels";
const PDF_TOO_LARGE_MESSAGE = "PDF exceeds 20 MiB or 100 pages";

const MEDIA_SIGNATURE_MESSAGE =
  "The file is an image or PDF; it is read as bytes.";

export function failure(
  type: NativeFailureResult["type"],
  message: string,
): NativeFailureResult {
  return { status: "error", type, message };
}

/**
 * The text read's media probe: a file whose leading bytes are an image or PDF
 * refuses here, before any text decode, so the hub takes `fs.bytes` exactly as
 * a local read takes its media hook. Only the signature is read; the bytes
 * travel on the separate call, and a selector on media is refused by the
 * shared probe before anything is decoded.
 */
export const MEDIA_SIGNATURE_HOOK: MediaReadHook = () =>
  Promise.resolve(failure("invalid_utf8", MEDIA_SIGNATURE_MESSAGE));

/** The media kind a file's leading bytes name, as the local readers spell it. */
export function mediaTypeOf(bytes: Buffer): string {
  const head = bytes.subarray(0, SIGNATURE_BYTES).toString("latin1");

  if (head.startsWith("\u0089PNG\r\n\u001a\n")) return "image/png";

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";

  if (head.startsWith("GIF87a") || head.startsWith("GIF89a"))
    return "image/gif";

  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP")
    return "image/webp";

  if (head.startsWith("%PDF-")) return "application/pdf";

  return OCTET_STREAM;
}

/** The one media-bound refusal, worded for the kind its signature names. */
export function tooLargeFailure(head: Buffer): NativeFailureResult {
  const mediaType = mediaTypeOf(head);

  if (mediaType.startsWith("image/"))
    return failure("media_too_large", IMAGE_TOO_LARGE_MESSAGE);

  return failure(
    "media_too_large",
    mediaType === "application/pdf"
      ? PDF_TOO_LARGE_MESSAGE
      : MEDIA_TOO_LARGE_MESSAGE,
  );
}

/**
 * The first signature bytes of the address the guard checked. A leaf link is
 * refused and a FIFO or device is never opened, because the probe classifies
 * only a regular file; a target that vanished since the guard is `undefined`.
 */
export async function readSignature(path: string): Promise<Buffer | undefined> {
  let file: FileHandle;

  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
  } catch {
    return undefined;
  }

  try {
    const stats = await file.stat();

    if (!stats.isFile()) return undefined;
    const head = Buffer.alloc(SIGNATURE_BYTES);
    const { bytesRead } = await file.read(head, 0, SIGNATURE_BYTES, 0);

    return head.subarray(0, bytesRead);
  } catch {
    return undefined;
  } finally {
    await file.close();
  }
}

/** The literal address a selector was split from, and its guarded form. */
export type LiteralTarget = {
  readonly requested: string;
  readonly guarded: GuardedPath;
};

/**
 * The file or directory the full request text names literally, when one inside
 * the roots exists: the literal-path probe a host read runs before it
 * interprets a selector. A probe the roots refuse is not a literal target, so
 * the split path the policy judged is the address the request then means.
 */
export async function literalTargetOf(
  guard: RootGuard,
  path: string,
  selector: string | undefined,
): Promise<LiteralTarget | undefined> {
  if (selector === undefined) return undefined;
  const requested = `${path}:${selector}`;
  let guarded: GuardedPath;

  try {
    guarded = await guard.resolvePath(requested);
  } catch (error) {
    if (error instanceof MachineRequestError) return undefined;
    throw error;
  }

  return guarded.kind === "missing" ? undefined : { requested, guarded };
}

/** Whether the request text itself spells a directory: a trailing separator,
 *  or a final `.` or `..` segment. */
function namesDirectoryBySpelling(requested: string): boolean {
  if (requested.length > 1 && requested.endsWith("/")) return true;
  const trimmed = requested.replace(/\/+$/u, "");
  const final = trimmed.slice(trimmed.lastIndexOf("/") + 1);

  return final === "." || final === "..";
}

type KernelResolution =
  | { readonly kind: "resolved"; readonly path: string }
  | { readonly kind: "absent" }
  | { readonly kind: "denied" };

/**
 * The kernel's reading of a request text: the resolved target, `absent` for a
 * missing tail, or `denied` when a component is not a directory or a link
 * loops.
 */
async function kernelResolution(requested: string): Promise<KernelResolution> {
  try {
    return { kind: "resolved", path: await realpath(requested) };
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;

    return code === "ENOENT" ? { kind: "absent" } : { kind: "denied" };
  }
}

/**
 * The refusal for a request text the kernel resolves to a different address
 * than the guard checked: a trailing separator or a final `.`/`..` on a
 * non-directory, a `..` after a non-directory, or a lexical `..` that follows
 * a link. Acting on the normalized address would read, replace, or create an
 * entry the permission decision never saw. An ordinary spelling costs nothing.
 */
export async function spellingFailure(
  requested: string,
  guarded: GuardedPath,
): Promise<NativeFailureResult | undefined> {
  if (guarded.kind !== "directory" && namesDirectoryBySpelling(requested))
    return failure("not_found", NOT_FOUND_MESSAGE);

  if (requested === guarded.path) return undefined;
  const resolved = await kernelResolution(requested);

  if (resolved.kind === "absent")
    return guarded.kind === "missing"
      ? undefined
      : failure("not_found", NOT_FOUND_MESSAGE);

  if (resolved.kind === "denied" || resolved.path !== guarded.canonical)
    return failure("not_found", NOT_FOUND_MESSAGE);

  return undefined;
}

/**
 * A missing target whose parent lies outside every root: a registered root, or
 * an ancestor of one, was removed. The sibling suggestions would name entries
 * from a directory no root contains.
 */
export function suggestionsSuppressed(
  guard: RootGuard,
  guarded: GuardedPath,
): boolean {
  return (
    guarded.kind === "missing" &&
    !isInsideRoots(guard.roots, dirname(guarded.path))
  );
}
