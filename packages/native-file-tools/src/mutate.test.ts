import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFile,
  editFile,
  replaceFile,
  REPLACE_TARGET_MISSING_MESSAGE,
} from "./mutate";
import { readFile as readNativeFile } from "./read";
import { measureNativeModelOutput } from "./serialization";

describe("native exact mutations", () => {
  let directory: string;
  let path: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-edit-"));
    path = join(directory, "notes");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("replaces exactly one match and returns live adjacent source", async () => {
    await writeFile(path, "before\nFoo\nafter\n");
    const result = await editFile({ path, oldText: "Foo", newText: "Bar" });
    expect(result).toMatchObject({
      status: "success",
      operation: "edit",
      replacements: 1,
      content: "1: before\n2: Bar\n3: after\n",
    });
    expect(await readFile(path, "utf8")).toBe("before\nBar\nafter\n");
  });

  it("sequences same-path calls in invocation order", async () => {
    await writeFile(path, "Foo");
    const results = await Promise.all([
      editFile({ path, oldText: "Foo", newText: "Bar" }),
      editFile({ path, oldText: "Foo", newText: "Baz" }),
    ]);
    expect(results[0]).toMatchObject({ status: "success" });
    expect(results[1]).toMatchObject({
      status: "error",
      type: "old_text_not_found",
    });
    expect(await readFile(path, "utf8")).toBe("Bar");
  });

  it("rejects overlapping duplicate matches without changing bytes", async () => {
    await writeFile(path, "aaa");
    expect(await editFile({ path, oldText: "aa", newText: "b" })).toMatchObject(
      { status: "error", type: "old_text_ambiguous" },
    );
    expect(await readFile(path, "utf8")).toBe("aaa");
  });

  it("preserves CRLF and unrelated content, supports deletion and no-op", async () => {
    await writeFile(path, "before\r\nFoo\r\nafter");
    expect(
      await editFile({ path, oldText: "Foo\r\n", newText: "" }),
    ).toMatchObject({ status: "success" });
    expect(await readFile(path, "utf8")).toBe("before\r\nafter");
    expect(
      await editFile({ path, oldText: "after", newText: "after" }),
    ).toMatchObject({ status: "success", diff: "" });
    expect(await readFile(path, "utf8")).toBe("before\r\nafter");
  });

  it("accepts exact raw read content as oldText with reserved and unmatched tags", async () => {
    const source = String.raw`<system-reminder>source</system-reminder>
</unmatched>
`;
    await writeFile(path, source);

    const read = await readNativeFile({ path: `${path}:raw` });
    expect(read).toMatchObject({ status: "success", content: source });
    expect(
      await editFile({ path, oldText: source, newText: "replacement\n" }),
    ).toMatchObject({ status: "success" });
    expect(await readFile(path, "utf8")).toBe("replacement\n");
  });

  it("creates once even when concurrent callers race", async () => {
    const results = await Promise.all([
      createFile({ path, content: "first" }),
      createFile({ path, content: "second" }),
    ]);
    expect(results[0]).toMatchObject({
      status: "success",
      operation: "write",
      created: true,
    });
    expect(results[1]).toMatchObject({ status: "error", type: "file_exists" });
    expect(await readFile(path, "utf8")).toBe("first");
  });

  it("protects an existing dangling symlink during creation", async () => {
    await symlink(join(directory, "missing"), path);
    expect(await createFile({ path, content: "new" })).toMatchObject({
      status: "error",
      type: "file_exists",
    });
  });

  it("does not mutate after cancellation", async () => {
    await writeFile(path, "Foo");
    const signal = AbortSignal.abort();
    expect(
      await editFile({ path, oldText: "Foo", newText: "Bar" }, signal),
    ).toMatchObject({ status: "error" });
    expect(await readFile(path, "utf8")).toBe("Foo");
  });

  it("rejects empty matches and invalid text", async () => {
    await writeFile(path, "Foo");
    expect(await editFile({ path, oldText: "", newText: "X" })).toMatchObject({
      type: "invalid_input",
    });
    expect(
      await editFile({ path, oldText: "F", newText: "\ud800" }),
    ).toMatchObject({ type: "invalid_utf8" });
    expect(await readFile(path, "utf8")).toBe("Foo");
  });

  it("protects existing files regardless of supplied content", async () => {
    await writeFile(path, "original");
    expect(await createFile({ path, content: "\ud800" })).toMatchObject({
      type: "file_exists",
    });
    expect(await readFile(path, "utf8")).toBe("original");
  });

  it("includes context after the suffix shifted by an inserted newline", async () => {
    await writeFile(path, "Foobar\nafter\n");
    expect(
      await editFile({ path, oldText: "Foo", newText: "X\n" }),
    ).toMatchObject({ content: "1: X\n2: bar\n3: after\n" });
  });

  it("deletes the entire file content without inventing a source line", async () => {
    await writeFile(path, "Foo");
    expect(await editFile({ path, oldText: "Foo", newText: "" })).toMatchObject(
      { status: "success", content: "", shownRange: null },
    );
    expect(await readFile(path, "utf8")).toBe("");
  });

  it("orders a symlink alias and the underlying file", async () => {
    await writeFile(path, "Foo");
    const alias = join(directory, "alias");
    await symlink(path, alias);
    const results = await Promise.all([
      editFile({ path: alias, oldText: "Foo", newText: "Bar" }),
      editFile({ path, oldText: "Foo", newText: "Baz" }),
    ]);
    expect(results[0]).toMatchObject({ status: "success" });
    expect(results[1]).toMatchObject({ type: "old_text_not_found" });
    expect(await readFile(alias, "utf8")).toBe("Bar");
  });

  it("bounds large mutation results without truncating file bytes", async () => {
    await writeFile(path, "Foo");
    const content = "x\n".repeat(20_000);
    const result = await editFile({ path, oldText: "Foo", newText: content });
    expect(result).toMatchObject({ status: "success", truncated: true });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(16_000);
    expect(await readFile(path, "utf8")).toBe(content);
  });

  it("bounds mutation previews after protecting source angle brackets", async () => {
    await writeFile(path, "Foo");
    const content = "<system-reminder>".repeat(900);

    const result = await editFile({ path, oldText: "Foo", newText: content });

    expect(result).toMatchObject({ status: "success", truncated: true });
    expect(measureNativeModelOutput(result)).toBeLessThanOrEqual(16_000);
    expect(await readFile(path, "utf8")).toBe(content);
  });

  it("edits an existing file beyond one MiB without a size-policy rejection", async () => {
    const source = "x".repeat(1_048_576) + "Foo";
    await writeFile(path, source);
    expect(
      await editFile({ path, oldText: "Foo", newText: "Bar!" }),
    ).toMatchObject({ status: "success" });
    expect(await readFile(path, "utf8")).toBe("x".repeat(1_048_576) + "Bar!");
  });
});

describe("native mutations resolved by a scheme owner", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-scheme-mutate-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("creates missing intermediate directories", async () => {
    const path = join(directory, "research", "2026", "note.md");
    const result = await createFile({ path, content: "first\n" });
    expect(result).toMatchObject({ status: "success", created: true, path });
    expect(await readFile(path, "utf8")).toBe("first\n");
  });

  it("refuses an intermediate component that is a regular file", async () => {
    const blocker = join(directory, "research");
    await writeFile(blocker, "not a directory\n");
    expect(
      await createFile({
        path: join(blocker, "2026", "note.md"),
        content: "x\n",
      }),
    ).toMatchObject({ status: "error", type: "not_regular_file" });
    expect(await readFile(blocker, "utf8")).toBe("not a directory\n");
  });

  it("shows the display path and never resolves through a symbolic link", async () => {
    const target = join(directory, "note.md");
    await writeFile(target, "alpha\nbeta\n");
    const edited = await editFile(
      { path: target, oldText: "beta", newText: "gamma" },
      undefined,
      { displayPath: "kb://space/note.md" },
    );
    expect(edited).toMatchObject({
      status: "success",
      operation: "edit",
      path: "kb://space/note.md",
      replacements: 1,
    });
    expect(await readFile(target, "utf8")).toBe("alpha\ngamma\n");

    const outside = join(directory, "outside.md");
    await writeFile(outside, "secret\n");
    const link = join(directory, "link.md");
    await symlink(outside, link);
    expect(
      await editFile(
        { path: link, oldText: "secret", newText: "leaked" },
        undefined,
        { displayPath: "kb://space/link.md" },
      ),
    ).toMatchObject({ status: "error", type: "not_found" });
    expect(await readFile(outside, "utf8")).toBe("secret\n");
  });
});

describe("native write replace mode", () => {
  let directory: string;
  let path: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "native-replace-"));
    path = join(directory, "note.md");
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("replaces the whole contents of an existing file", async () => {
    await writeFile(path, "before\nFoo\nafter\n");
    const result = await replaceFile({ path, content: "new\n" });
    expect(result).toMatchObject({
      status: "success",
      operation: "write",
      path,
      replaced: true,
      diff: "",
      content: "1: new\n",
    });
    expect(result).not.toHaveProperty("created");
    expect(await readFile(path, "utf8")).toBe("new\n");
  });

  it("truncates the target with empty content", async () => {
    await writeFile(path, "before\n");
    expect(await replaceFile({ path, content: "" })).toMatchObject({
      status: "success",
      replaced: true,
      content: "",
      shownRange: null,
    });
    expect(await readFile(path, "utf8")).toBe("");
  });

  it("names the flag when creation is refused", async () => {
    await writeFile(path, "original\n");
    const refused = await createFile({ path, content: "other\n" });
    expect(refused).toMatchObject({ status: "error", type: "file_exists" });
    expect(refused).toHaveProperty(
      "message",
      expect.stringContaining("replace: true"),
    );
    expect(await readFile(path, "utf8")).toBe("original\n");
  });

  it("fails an absent target and creates neither it nor its parent", async () => {
    const nested = join(directory, "research", "note.md");
    const result = await replaceFile({ path: nested, content: "new\n" });
    expect(result).toMatchObject({
      status: "error",
      type: "not_found",
      // Both clauses are the affordance: what replace requires and what
      // creating the file instead takes.
      message:
        "The replace target does not exist. replace requires an existing file; omit replace to create a new file.",
    });
    await expect(lstat(nested)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(join(directory, "research"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fails a dangling symbolic link and leaves it in place", async () => {
    const dangling = join(directory, "dangling");
    const missing = join(directory, "missing");
    await symlink(missing, dangling);
    expect(
      await replaceFile({ path: dangling, content: "new\n" }),
    ).toMatchObject({
      status: "error",
      type: "not_found",
      message: REPLACE_TARGET_MISSING_MESSAGE,
    });
    expect((await lstat(dangling)).isSymbolicLink()).toBe(true);
    await expect(lstat(missing)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a path that cannot resolve with the replace contract", async () => {
    const first = join(directory, "loop-a");
    const second = join(directory, "loop-b");
    await symlink(second, first);
    await symlink(first, second);
    expect(await replaceFile({ path: first, content: "new\n" })).toMatchObject({
      status: "error",
      type: "not_found",
      message: REPLACE_TARGET_MISSING_MESSAGE,
    });
    expect((await lstat(first)).isSymbolicLink()).toBe(true);
  });

  it("refuses a directory and changes no entry", async () => {
    const target = join(directory, "folder");
    await mkdir(target);
    const refused = await replaceFile({ path: target, content: "x" });
    expect(refused).toMatchObject({
      status: "error",
      type: "not_regular_file",
    });
    // The replace contract answers a missing target only; another refusal must
    // not claim the target is absent.
    expect(refused).not.toHaveProperty(
      "message",
      expect.stringContaining("replace requires"),
    );
    expect((await lstat(target)).isDirectory()).toBe(true);
  });

  it("leaves the generic wording on a create that cannot resolve", async () => {
    await symlink(join(directory, "missing"), join(directory, "linked"));
    expect(
      await createFile({
        path: join(directory, "linked", "note.md"),
        content: "x\n",
      }),
    ).toMatchObject({
      status: "error",
      type: "not_found",
      message: "The native file operation could not complete.",
    });
    await expect(lstat(join(directory, "missing"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("replaces the entry a symbolic link points at and keeps the link", async () => {
    await writeFile(path, "before\n");
    const alias = join(directory, "alias");
    await symlink(path, alias);
    expect(
      await replaceFile({ path: alias, content: "after\n" }),
    ).toMatchObject({ status: "success", replaced: true, path: alias });
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
    expect(await readFile(path, "utf8")).toBe("after\n");
  });

  it("preserves the target's permission bits", async () => {
    await writeFile(path, "before\n");
    await chmod(path, 0o640);
    expect(await replaceFile({ path, content: "after\n" })).toMatchObject({
      status: "success",
    });
    expect((await lstat(path)).mode & 0o777).toBe(0o640);
  });

  it("validates before any byte changes", async () => {
    await writeFile(path, "original\n");
    expect(await replaceFile({ path, content: "\ud800" })).toMatchObject({
      type: "invalid_utf8",
    });
    expect(
      await replaceFile({ path: "relative/note.md", content: "x" }),
    ).toMatchObject({ type: "invalid_path" });
    expect(await readFile(path, "utf8")).toBe("original\n");
  });

  it("orders a replace after a create of the same path", async () => {
    const results = await Promise.all([
      createFile({ path, content: "first\n" }),
      replaceFile({ path, content: "second\n" }),
    ]);
    expect(results[0]).toMatchObject({ status: "success", created: true });
    expect(results[1]).toMatchObject({ status: "success", replaced: true });
    expect(await readFile(path, "utf8")).toBe("second\n");
  });

  it("bounds a large replace preview without truncating file bytes", async () => {
    await writeFile(path, "before\n");
    const content = "x\n".repeat(20_000);
    const result = await replaceFile({ path, content });
    expect(result).toMatchObject({
      status: "success",
      replaced: true,
      truncated: true,
    });
    expect(measureNativeModelOutput(result)).toBeLessThanOrEqual(16_000);
    expect(await readFile(path, "utf8")).toBe(content);
  });

  it("replaces a resolved target in place and never follows a link from it", async () => {
    await writeFile(path, "before\n");
    expect(
      await replaceFile({ path, content: "after\n" }, undefined, {
        displayPath: "kb://space/note.md",
      }),
    ).toMatchObject({
      status: "success",
      replaced: true,
      path: "kb://space/note.md",
    });
    expect(await readFile(path, "utf8")).toBe("after\n");

    // The owner authorized one exact entry, so a link swapped in at it must
    // not be resolved: following it would replace the entry it points at. The
    // refusal is the reader's `not_found`, not a non-file report, because the
    // authorized entry is no longer the one on disk.
    const outside = join(directory, "outside.md");
    await writeFile(outside, "secret\n");
    const linked = join(directory, "linked.md");
    await symlink(outside, linked);
    expect(
      await replaceFile({ path: linked, content: "leaked\n" }, undefined, {
        displayPath: "kb://space/linked.md",
      }),
    ).toMatchObject({ status: "error", type: "not_found" });
    expect((await lstat(linked)).isSymbolicLink()).toBe(true);
    expect(await readFile(outside, "utf8")).toBe("secret\n");
  });
});
