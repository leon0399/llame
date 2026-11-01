import {
  mkdtemp,
  open,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { fileStream, openFileStream } from "./file-stream";
import type { GrepReadRefusal } from "./types";

const roots: Array<string> = [];

async function tree(): Promise<string> {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "grep-stream-")),
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Every item a chunk stream yields, in order. */
async function drain(
  chunks: AsyncIterable<Uint8Array | GrepReadRefusal>,
): Promise<Array<Uint8Array | GrepReadRefusal>> {
  const items: Array<Uint8Array | GrepReadRefusal> = [];
  for await (const chunk of chunks) items.push(chunk);
  return items;
}

/** The bytes a chunk stream yields; a refusal item is a test failure. */
async function bytesOf(
  chunks: AsyncIterable<Uint8Array | GrepReadRefusal>,
): Promise<Buffer> {
  const parts: Array<Uint8Array> = [];
  for (const item of await drain(chunks)) {
    if (!(item instanceof Uint8Array)) throw new Error(`refused: ${item.kind}`);
    parts.push(item);
  }
  return Buffer.concat(parts);
}

describe("file streams", () => {
  it("announces the size it was given and streams every byte", async () => {
    const root = await tree();
    const text = `${"x".repeat(70 * 1024)}tail\n`;
    await writeFile(path.join(root, "note.md"), text);
    const opened = await openFileStream(
      path.join(root, "note.md"),
      false,
      undefined,
    );
    if (!("chunks" in opened)) throw new Error("a regular file opens");
    expect(opened.size).toBe(Buffer.byteLength(text));
    const bytes = await bytesOf(opened.chunks);
    expect(bytes.equals(Buffer.from(text))).toBe(true);
    await opened.close();
  });

  it("ends the stream with a refusal when a read fails", async () => {
    const root = await tree();
    const file = path.join(root, "note.md");
    await writeFile(file, "needle\n");
    const handle = await open(file, "r");
    await handle.close();
    const items = await drain(fileStream(handle, 7, undefined).chunks);
    expect(items).toStrictEqual([{ kind: "unreadable" }]);
  });

  it("ends the stream with the refusal an after hook reports", async () => {
    const root = await tree();
    const file = path.join(root, "note.md");
    await writeFile(file, "needle\n");
    const handle = await open(file, "r");
    const closed = fileStream(handle, 7, undefined, () =>
      Promise.resolve(false),
    );
    const items = await drain(closed.chunks);
    expect(items.at(-1)).toStrictEqual({ kind: "unreadable" });
  });

  it("keeps the stream whole when the after hook holds", async () => {
    const root = await tree();
    const file = path.join(root, "note.md");
    await writeFile(file, "needle\n");
    const handle = await open(file, "r");
    const held = fileStream(handle, 7, undefined, () => Promise.resolve(true));
    const items = await drain(held.chunks);
    expect(items).toHaveLength(1);
    expect(items[0]).toBeInstanceOf(Uint8Array);
  });

  it("closes a stream nobody started, once", async () => {
    const root = await tree();
    const file = path.join(root, "note.md");
    await writeFile(file, "needle\n");
    const handle = await open(file, "r");
    const opened = fileStream(handle, 7, undefined);
    await opened.close();
    await expect(opened.close()).resolves.toBeUndefined();
    await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
  });

  it("aborts between chunks and still closes the file", async () => {
    const root = await tree();
    const file = path.join(root, "note.md");
    await writeFile(file, "needle\n");
    const handle = await open(file, "r");
    const controller = new AbortController();
    const opened = fileStream(handle, 7, controller.signal);
    controller.abort();
    await expect(drain(opened.chunks)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
  });
});

describe("opening a file stream", () => {
  it("refuses a path it cannot open", async () => {
    const root = await tree();
    await expect(
      openFileStream(path.join(root, "absent.md"), false, undefined),
    ).resolves.toStrictEqual({ kind: "unreadable" });
  });

  it("refuses a path that is not a regular file", async () => {
    await expect(
      openFileStream("/dev/null", false, undefined),
    ).resolves.toStrictEqual({ kind: "unreadable" });
    const root = await tree();
    await expect(openFileStream(root, false, undefined)).resolves.toStrictEqual(
      { kind: "unreadable" },
    );
  });

  it("never follows a link when the scheme says so, and follows it otherwise", async () => {
    const root = await tree();
    await writeFile(path.join(root, "note.md"), "needle\n");
    const link = path.join(root, "link.md");
    await symlink(path.join(root, "note.md"), link);
    await expect(openFileStream(link, false, undefined)).resolves.toStrictEqual(
      { kind: "unreadable" },
    );
    const followed = await openFileStream(link, true, undefined);
    if (!("chunks" in followed)) throw new Error("the link opens");
    expect((await bytesOf(followed.chunks)).toString()).toBe("needle\n");
  });

  it("refuses before opening when the call is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      openFileStream("/dev/null", false, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
