import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readFile } from "./read";
import {
  MEDIA_SELECTOR_MESSAGE,
  readMediaBytes,
  type MediaDecodeSuccess,
  type MediaReadHook,
} from "./media";
import { NativeFileError } from "./path";
import type { FileFailure } from "./source-lines";

/** A 5 MiB body behind each signature, the size a Machine read must carry. */
const BODY = Buffer.alloc(5 * 1024 * 1024, 7);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  BODY,
]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7"), BODY]);

const IMAGE = {
  status: "success" as const,
  kind: "image" as const,
  mediaType: "image/png",
  width: 1600,
  height: 900,
};

const PDF_RESULT = {
  status: "success" as const,
  kind: "pdf" as const,
  mediaType: "application/pdf" as const,
  pages: 3,
  byteSize: PDF.length,
};

function recordingHook(result: MediaDecodeSuccess | FileFailure) {
  const handed: Array<{ byteSize: number; bytes: Buffer }> = [];
  const hook: MediaReadHook = async ({ byteSize, readBytes }) => {
    handed.push({ byteSize, bytes: await readBytes() });
    return result;
  };
  return { hook, handed };
}

describe("byte-buffer media reads", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "media-buffer-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("returns exactly what a local read of the same bytes returns", async () => {
    const path = join(directory, "shot.png");
    await writeFile(path, PNG);
    const local = recordingHook(IMAGE);
    const buffered = recordingHook(IMAGE);
    const fromFile = await readFile({ path }, undefined, local.hook);
    const fromBytes = await readMediaBytes(
      PNG,
      { path },
      { media: buffered.hook },
    );
    expect(fromBytes).toEqual(fromFile);
    expect(fromBytes).toEqual({ ...IMAGE, path });
    expect(buffered.handed).toEqual([
      { byteSize: PNG.length, bytes: expect.any(Buffer) },
    ]);
    expect(buffered.handed[0]?.bytes.equals(PNG)).toBe(true);
  });

  it("reports a PDF by its bytes and keeps a canonical path", async () => {
    const path = "machine://devl/srv/report.pdf";
    const { hook } = recordingHook(PDF_RESULT);
    await expect(
      readMediaBytes(
        PDF,
        { path, realPath: "machine://devl/srv/real.pdf" },
        { media: hook },
      ),
    ).resolves.toEqual({
      ...PDF_RESULT,
      path,
      realPath: "machine://devl/srv/real.pdf",
    });
  });

  it("leaves a non-media buffer on the text path", async () => {
    const { hook, handed } = recordingHook(IMAGE);
    await expect(
      readMediaBytes(
        Buffer.from("plain text\n"),
        { path: "/a.txt" },
        { media: hook },
      ),
    ).resolves.toBeUndefined();
    expect(handed).toEqual([]);
  });

  it("leaves every buffer on the text path without a media hook", async () => {
    await expect(
      readMediaBytes(PNG, { path: "/a.png" }, {}),
    ).resolves.toBeUndefined();
  });

  it("refuses any selector for an image or PDF", async () => {
    const { hook } = recordingHook(IMAGE);
    await expect(
      readMediaBytes(PNG, { path: "/a.png", selector: "1-2" }, { media: hook }),
    ).rejects.toEqual(
      new NativeFileError("invalid_selector", MEDIA_SELECTOR_MESSAGE),
    );
  });

  it("passes a hook refusal through unchanged", async () => {
    const refusal = {
      status: "error" as const,
      type: "media_too_large" as const,
      message: "The file exceeds the media byte bound.",
    };
    const { hook } = recordingHook(refusal);
    await expect(
      readMediaBytes(PNG, { path: "/a.png" }, { media: hook }),
    ).resolves.toEqual(refusal);
  });

  it("refuses before reading bytes when the signal is already aborted", async () => {
    const { hook, handed } = recordingHook(IMAGE);
    const controller = new AbortController();
    controller.abort();
    await expect(
      readMediaBytes(
        PNG,
        { path: "/a.png" },
        { media: hook, signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(handed).toEqual([]);
  });
});
