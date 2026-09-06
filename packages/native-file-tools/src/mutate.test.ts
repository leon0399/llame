import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editFile, createFile } from "./mutate";

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

  it("edits an existing file beyond one MiB without a size-policy rejection", async () => {
    const source = "x".repeat(1_048_576) + "Foo";
    await writeFile(path, source);
    expect(
      await editFile({ path, oldText: "Foo", newText: "Bar!" }),
    ).toMatchObject({ status: "success" });
    expect(await readFile(path, "utf8")).toBe("x".repeat(1_048_576) + "Bar!");
  });
});
