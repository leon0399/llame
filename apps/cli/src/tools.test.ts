import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  type Tool,
  type ToolResult,
  type UnknownRecord,
} from "@workspace/harness";

import { createCodingTools, resolveWithin } from "./tools";

function tempWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "llame-cli-ws-"));
}

/** Tools declare a sync-or-async result union; normalize for awaiting. */
function call(
  tool: Tool | undefined,
  args: UnknownRecord,
): Promise<ToolResult> {
  if (!tool) throw new Error("tool not registered");
  return Promise.resolve(tool.execute({}, args));
}

describe("resolveWithin", () => {
  it("resolves relative paths against the workspace root", () => {
    expect(resolveWithin("/ws", "src/a.ts")).toBe(path.resolve("/ws/src/a.ts"));
  });

  it("refuses traversal outside the workspace root", () => {
    expect(resolveWithin("/ws", "../outside")).toBeUndefined();
    expect(resolveWithin("/ws", "/etc/passwd")).toBeUndefined();
  });

  it("accepts the workspace root itself", () => {
    expect(resolveWithin("/ws", ".")).toBe(path.resolve("/ws"));
  });
});

describe("coding tools", () => {
  it("registers the five tools with the expected classifications", () => {
    const tools = createCodingTools(tempWorkspace());
    expect([...tools.keys()].sort()).toEqual([
      "bash",
      "edit_file",
      "list_dir",
      "read_file",
      "write_file",
    ]);
    expect(tools.get("read_file")?.classification).toBe("read_only");
    expect(tools.get("bash")?.classification).toBe("execute_code");
    expect(tools.get("write_file")?.classification).toBe("write_low_risk");
  });

  it("writes then reads back a file inside the workspace", async () => {
    const ws = tempWorkspace();
    const tools = createCodingTools(ws);
    const written = await call(tools.get("write_file"), {
      path: "src/new.txt",
      content: "hello",
    });
    expect(written).toMatchObject({ status: "success" });
    const read = await call(tools.get("read_file"), { path: "src/new.txt" });
    expect(read).toMatchObject({ status: "success", content: "hello" });
  });

  it("refuses reads that escape the workspace", async () => {
    const tools = createCodingTools(tempWorkspace());
    const result = await call(tools.get("read_file"), {
      path: "../../etc/passwd",
    });
    expect(result).toMatchObject({
      status: "error",
      type: "outside_workspace",
    });
  });

  it("edits exactly one occurrence and refuses ambiguous matches", async () => {
    const ws = tempWorkspace();
    const tools = createCodingTools(ws);
    await call(tools.get("write_file"), {
      path: "f.txt",
      content: "a b b c",
    });
    const ambiguous = await call(tools.get("edit_file"), {
      path: "f.txt",
      oldText: "b",
      newText: "x",
    });
    expect(ambiguous).toMatchObject({
      status: "error",
      type: "ambiguous_match",
    });
    const ok = await call(tools.get("edit_file"), {
      path: "f.txt",
      oldText: "a b b",
      newText: "a x b",
    });
    expect(ok).toMatchObject({ status: "success" });
    const read = await call(tools.get("read_file"), { path: "f.txt" });
    expect(read).toMatchObject({ status: "success", content: "a x b c" });
  });

  it("runs bash inside the workspace root and reports exit codes as data", async () => {
    const ws = tempWorkspace();
    const tools = createCodingTools(ws);
    const pwd = await call(tools.get("bash"), { command: "pwd" });
    expect(pwd).toMatchObject({ status: "success", exitCode: 0 });
    expect(pwd).toHaveProperty("stdout", `${ws}\n`);
    const failing = await call(tools.get("bash"), { command: "exit 3" });
    expect(failing).toMatchObject({ status: "success", exitCode: 3 });
  });

  it("lists directory entries with a trailing slash for directories", async () => {
    const ws = tempWorkspace();
    const tools = createCodingTools(ws);
    await fs.mkdir(path.join(ws, "sub"));
    await fs.writeFile(path.join(ws, "file.txt"), "x", "utf8");
    const listing = await call(tools.get("list_dir"), {});
    expect(listing).toMatchObject({
      status: "success",
      entries: ["file.txt", "sub/"],
    });
  });
});
