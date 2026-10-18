import { chmod, readFile, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile as nativeReadFile } from "@workspace/native-file-tools";
import {
  BYTES_CHUNK_BYTES,
  isSerializableRecord,
  isStringValue,
  PATH_NOT_REGISTERED_MESSAGE,
  type MachineErrorCode,
} from "@workspace/machine-protocol";
import { createRootFixture, type RootFixture } from "./testing/fixtures";
import {
  envelope,
  startDaemon,
  waitFor,
  type TestDaemon,
} from "./testing/harness";

const PREFIX = "machine://devl";

let fixture: RootFixture;
let daemon: TestDaemon;

beforeEach(async () => {
  fixture = await createRootFixture();
  daemon = startDaemon({ roots: [fixture.root] });
  const hello = await daemon.hello();
  expect(hello.ok).toBe(true);
});

afterEach(async () => {
  daemon.input.end();
  await daemon.session.done;
  await fixture.cleanup();
});

function requestFrame(s: number, method: string, params: string): string {
  return `{"s":${s},"m":{"jsonrpc":"2.0","id":${s},"method":${JSON.stringify(method)},"params":${params}}}\n`;
}

function refusal(code: MachineErrorCode) {
  return {
    name: "MachineProtocolError",
    code,
    message: PATH_NOT_REGISTERED_MESSAGE,
  };
}

type LocalFileRead = {
  readonly status: "success";
  readonly path: string;
  readonly realPath?: string;
};

function isLocalFileRead(value: unknown): value is LocalFileRead {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "success" &&
    "path" in value &&
    typeof value.path === "string"
  );
}

/** The local read's own paths, spelled as the Machine locator the daemon reports. */
function locatorize(result: LocalFileRead, prefix: string) {
  const realPath = result.realPath;
  return realPath === undefined
    ? { ...result, path: `${prefix}${result.path}` }
    : {
        ...result,
        path: `${prefix}${result.path}`,
        realPath: `${prefix}${realPath}`,
      };
}

describe("fs.stat", () => {
  it("reports a file with its size and canonical path", async () => {
    await expect(
      daemon.call("fs.stat", { envelope: envelope(), path: fixture.notes }),
    ).resolves.toEqual({
      kind: "file",
      size: 19,
      realPath: fixture.notes,
      isLink: false,
    });
  });

  it("reports a directory, a link, and a missing path", async () => {
    await expect(
      daemon.call("fs.stat", { envelope: envelope(), path: fixture.root }),
    ).resolves.toMatchObject({ kind: "directory", isLink: false });
    await expect(
      daemon.call("fs.stat", {
        envelope: envelope(),
        path: fixture.insideLink,
      }),
    ).resolves.toMatchObject({
      kind: "file",
      realPath: fixture.notes,
      isLink: true,
    });
    await expect(
      daemon.call("fs.stat", {
        envelope: envelope(),
        path: join(fixture.root, "gone"),
      }),
    ).resolves.toEqual({ kind: "missing", isLink: false });
  });
});

describe("fs.list", () => {
  it("reports entries with their kinds, directories first", async () => {
    await expect(
      daemon.call("fs.list", { envelope: envelope(), path: fixture.root }),
    ).resolves.toEqual({
      entries: [
        { name: "dangling.txt", kind: "link" },
        { name: "escape.txt", kind: "link" },
        { name: "inside.txt", kind: "link" },
        { name: "notes.txt", kind: "file" },
      ],
      totalCount: 4,
      truncated: false,
    });
  });

  it("refuses a target that is not a directory", async () => {
    await expect(
      daemon.call("fs.list", { envelope: envelope(), path: fixture.notes }),
    ).resolves.toEqual({
      status: "error",
      type: "not_regular_file",
      message: "The target is not a directory.",
    });
  });

  it("refuses a path outside the roots", async () => {
    const outcome = await daemon.attempt("fs.list", {
      envelope: envelope(),
      path: fixture.outside,
    });
    expect(outcome.error).toMatchObject(refusal("path_not_registered"));
  });
});

describe("fs.read", () => {
  it("reads exactly what a local read of the same selector returns", async () => {
    const local = await nativeReadFile({ path: `${fixture.notes}:2-3` });
    if (!isLocalFileRead(local)) throw new Error("the local read failed");
    await expect(
      daemon.call("fs.read", {
        envelope: envelope(),
        path: fixture.notes,
        options: { displayPrefix: PREFIX, selector: "2-3" },
      }),
    ).resolves.toEqual(locatorize(local, PREFIX));
  });

  it("reads a whole file exactly as a local read of it does", async () => {
    const local = await nativeReadFile({ path: fixture.notes });
    if (!isLocalFileRead(local)) throw new Error("the local read failed");
    await expect(
      daemon.call("fs.read", {
        envelope: envelope(),
        path: fixture.notes,
        options: { displayPrefix: PREFIX },
      }),
    ).resolves.toEqual(locatorize(local, PREFIX));
  });

  it("lists a directory with a locator header and hides link targets", async () => {
    const result = await daemon.call("fs.read", {
      envelope: envelope(),
      path: fixture.root,
      options: { displayPrefix: PREFIX },
    });
    expect(result).toMatchObject({ status: "success", kind: "directory" });
    const content = JSON.stringify(result);
    expect(content).toContain(`${PREFIX}${fixture.root}`);
    expect(content).not.toContain(fixture.outside);
  });

  it("reports the canonical locator when the address is a link", async () => {
    await expect(
      daemon.call("fs.read", {
        envelope: envelope(),
        path: fixture.insideLink,
        options: { displayPrefix: PREFIX },
      }),
    ).resolves.toMatchObject({
      realPath: `${PREFIX}${fixture.notes}`,
      path: `${PREFIX}${fixture.insideLink}`,
    });
  });

  it("refuses a link that leaves the roots, for reading and for creating", async () => {
    const read = await daemon.attempt("fs.read", {
      envelope: envelope(),
      path: fixture.escapeLink,
      options: { displayPrefix: PREFIX },
    });
    expect(read.error).toMatchObject(refusal("path_not_registered"));
    const write = await daemon.attempt("fs.write", {
      envelope: envelope(),
      path: `${fixture.escapeLink}/new.txt`,
      options: { displayPrefix: PREFIX },
      content: "no\n",
    });
    expect(write.error).toEqual(read.error);
    await expect(readFile(join(fixture.outside, "new.txt"))).rejects.toThrow(
      /ENOENT/u,
    );
  });

  it("refuses a dangling link that points outside the roots", async () => {
    await expect(
      daemon.attempt("fs.read", {
        envelope: envelope(),
        path: fixture.danglingLink,
        options: { displayPrefix: PREFIX },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: refusal("path_not_registered"),
    });
    await expect(
      daemon.attempt("fs.write", {
        envelope: envelope(),
        path: fixture.danglingLink,
        options: { displayPrefix: PREFIX },
        content: "no\n",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: refusal("path_not_registered"),
    });
  });

  it("refuses an absent and an existing path outside the roots identically", async () => {
    const absent = await daemon.attempt("fs.read", {
      envelope: envelope(),
      path: join(fixture.outside, "missing.txt"),
      options: { displayPrefix: PREFIX },
    });
    const existing = await daemon.attempt("fs.read", {
      envelope: envelope(),
      path: fixture.secret,
      options: { displayPrefix: PREFIX },
    });
    expect(absent.error).toEqual(existing.error);
  });

  it("requires display options", async () => {
    daemon.write(
      requestFrame(
        51,
        "fs.read",
        JSON.stringify({ envelope: envelope(), path: fixture.notes }),
      ),
    );
    await waitFor(() => daemon.frames.some((frame) => frame.s === 51));
    expect(daemon.frames.find((frame) => frame.s === 51)?.m).toMatchObject({
      error: { code: -32_602, data: { code: "invalid_params" } },
    });
  });
});

describe("fs.edit and fs.write", () => {
  it("edits a file and reports the locator", async () => {
    await expect(
      daemon.call("fs.edit", {
        envelope: envelope(),
        path: fixture.notes,
        options: { displayPrefix: PREFIX },
        oldText: "two\n",
        newText: "TWO\n",
      }),
    ).resolves.toMatchObject({
      status: "success",
      operation: "edit",
      path: `${PREFIX}${fixture.notes}`,
    });
    await expect(readFile(fixture.notes, "utf8")).resolves.toBe(
      "one\nTWO\nthree\nfour\n",
    );
  });

  it("creates a missing directory chain for a new file", async () => {
    const target = join(fixture.root, "fresh", "deep", "new.txt");
    await expect(
      daemon.call("fs.write", {
        envelope: envelope(),
        path: target,
        options: { displayPrefix: PREFIX },
        content: "hello\n",
      }),
    ).resolves.toMatchObject({
      status: "success",
      operation: "write",
      path: `${PREFIX}${target}`,
      created: true,
    });
    await expect(readFile(target, "utf8")).resolves.toBe("hello\n");
  });

  it("replaces an existing file only when asked", async () => {
    await expect(
      daemon.call("fs.write", {
        envelope: envelope(),
        path: fixture.notes,
        options: { displayPrefix: PREFIX },
        content: "over\n",
      }),
    ).resolves.toMatchObject({ status: "error", type: "file_exists" });
    await expect(readFile(fixture.notes, "utf8")).resolves.toBe(
      "one\ntwo\nthree\nfour\n",
    );
    await expect(
      daemon.call("fs.write", {
        envelope: envelope(),
        path: fixture.notes,
        options: { displayPrefix: PREFIX },
        content: "over\n",
        replace: true,
      }),
    ).resolves.toMatchObject({ status: "success", replaced: true });
    await expect(readFile(fixture.notes, "utf8")).resolves.toBe("over\n");
  });

  it("refuses a mutation of a path outside the roots", async () => {
    const outcome = await daemon.attempt("fs.write", {
      envelope: envelope(),
      path: join(fixture.outside, "new.txt"),
      options: { displayPrefix: PREFIX },
      content: "no\n",
    });
    expect(outcome.error).toMatchObject(refusal("path_not_registered"));
  });
});

describe("fs.bytes", () => {
  it("chunks a file larger than one chunk and reports its media type", async () => {
    const png = join(fixture.root, "picture.png");
    const bytes = Buffer.alloc(1_200_000, 7);
    Buffer.from("\u0089PNG\r\n\u001a\n", "latin1").copy(bytes);
    await writeFile(png, bytes);
    const { channel, notifications } = daemon.open();
    const result = await channel.request("fs.bytes", {
      envelope: envelope(),
      path: png,
    });
    const chunks = notifications.filter(({ method }) => method === "bytes");
    expect(result).toEqual({ size: bytes.byteLength, mediaType: "image/png" });
    expect(chunks).toHaveLength(3);
    const reassembled = Buffer.concat(
      chunks.map((chunk) => {
        const params = chunk.params;
        const data = isSerializableRecord(params) ? params["data"] : undefined;
        return Buffer.from(isStringValue(data) ? data : "", "base64");
      }),
    );
    expect(reassembled.equals(bytes)).toBe(true);
    expect(chunks[0].params).toMatchObject({ seq: 1 });
    channel.close();
  });

  it("sends no chunk for an empty file", async () => {
    const empty = join(fixture.root, "empty.bin");
    await writeFile(empty, "");
    const { channel, notifications } = daemon.open();
    await expect(
      channel.request("fs.bytes", { envelope: envelope(), path: empty }),
    ).resolves.toEqual({ size: 0, mediaType: "application/octet-stream" });
    expect(notifications).toHaveLength(0);
    channel.close();
  });

  it("refuses bytes above the media bound without reading them", async () => {
    const huge = join(fixture.root, "huge.bin");
    await writeFile(huge, "");
    await truncate(huge, 21 * 1024 * 1024);
    await expect(
      daemon.call("fs.bytes", { envelope: envelope(), path: huge }),
    ).resolves.toMatchObject({ status: "error", type: "media_too_large" });
  });

  it("refuses a directory", async () => {
    await expect(
      daemon.call("fs.bytes", { envelope: envelope(), path: fixture.root }),
    ).resolves.toMatchObject({ status: "error", type: "not_regular_file" });
  });

  it("keeps each chunk within the raw chunk bound", () => {
    expect(BYTES_CHUNK_BYTES).toBe(512 * 1024);
  });
});

describe("proc.bash", () => {
  it("runs in the given directory and prints its remote pwd", async () => {
    await expect(
      daemon.call("proc.bash", {
        envelope: envelope(),
        command: "pwd",
        cwd: fixture.root,
      }),
    ).resolves.toMatchObject({
      status: "success",
      operation: "bash",
      exitCode: 0,
      stdout: `${fixture.root}\n`,
      stderr: "",
      truncated: false,
    });
  });

  it("adds declared environment entries to the managed base", async () => {
    await expect(
      daemon.call("proc.bash", {
        envelope: envelope(),
        command: "printf '%s' \"$LLAME_TEST\"",
        cwd: fixture.root,
        env: { LLAME_TEST: "value" },
      }),
    ).resolves.toMatchObject({ status: "success", stdout: "value" });
  });

  it("refuses a base environment name as an addition", async () => {
    await expect(
      daemon.call("proc.bash", {
        envelope: envelope(),
        command: "true",
        cwd: fixture.root,
        env: { PATH: "/nonexistent" },
      }),
    ).resolves.toMatchObject({
      status: "error",
      type: "unavailable",
    });
  });

  it("refuses a working directory outside the roots", async () => {
    const outcome = await daemon.attempt("proc.bash", {
      envelope: envelope(),
      command: "pwd",
      cwd: fixture.outside,
    });
    expect(outcome.error).toMatchObject(refusal("path_not_registered"));
  });

  it("reports a failing command as a result, not a protocol error", async () => {
    await expect(
      daemon.call("proc.bash", {
        envelope: envelope(),
        command: "exit 3",
        cwd: fixture.root,
      }),
    ).resolves.toMatchObject({
      status: "error",
      operation: "bash",
      exitCode: 3,
      executor: "managed",
    });
  });

  it("runs in the first registered root when no cwd is given", async () => {
    await expect(
      daemon.call("proc.bash", { envelope: envelope(), command: "pwd" }),
    ).resolves.toMatchObject({
      status: "success",
      stdout: `${fixture.root}\n`,
    });
  });

  it("reports that it cannot run without a registered root", async () => {
    const rootless = startDaemon({ roots: [] });
    await rootless.hello();
    const mux = await rootless.attempt("proc.bash", {
      envelope: envelope(),
      command: "pwd",
    });
    expect(mux.error).toMatchObject({ code: "invalid_params" });
    rootless.input.end();
    await rootless.session.done;
  });

  it("hides the command's stderr from the protocol stream", async () => {
    await expect(
      daemon.call("proc.bash", {
        envelope: envelope(),
        command: "printf 'problem' >&2; true",
        cwd: fixture.root,
      }),
    ).resolves.toMatchObject({ status: "success", stderr: "problem" });
  });

  it("does not leak a host path through a refused working directory", async () => {
    const outcome = await daemon.attempt("proc.bash", {
      envelope: envelope(),
      command: "pwd",
      cwd: join(fixture.root, "not-there"),
    });
    expect(outcome.error).toMatchObject({
      code: "invalid_params",
      message: "proc.bash: the working directory is not a directory",
    });
    expect(JSON.stringify(outcome)).not.toContain(fixture.base);
  });

  it("reads a file the Managed base environment points at", async () => {
    const readable = join(fixture.root, "readable.txt");
    await writeFile(readable, "ok\n");
    await chmod(readable, 0o600);
    await expect(
      daemon.call("proc.bash", {
        envelope: envelope(),
        command: `cat ${JSON.stringify(readable)}`,
        cwd: fixture.root,
      }),
    ).resolves.toMatchObject({ status: "success", stdout: "ok\n" });
  });
});

describe("Workspace MCP methods", () => {
  it("registers the methods but reports them as not implemented yet", async () => {
    for (const method of ["mcp.servers", "mcp.open"] as const) {
      const outcome = await daemon.attempt(method, {
        envelope: envelope(),
        root: fixture.root,
        server: "storybook",
      });
      expect(outcome.error).toMatchObject({
        name: "MachineProtocolError",
        code: "internal",
        message: "not implemented yet",
      });
    }
  });
});
