import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editFile, createFile } from "./mutate";
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
      "kb://space/note.md",
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
        "kb://space/link.md",
      ),
    ).toMatchObject({ status: "error", type: "not_found" });
    expect(await readFile(outside, "utf8")).toBe("secret\n");
  });
});
