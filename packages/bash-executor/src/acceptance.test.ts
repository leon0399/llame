import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editFile, readFile } from "@workspace/native-file-tools";
import { BashProcessLimiter, executeManagedBash } from "./index";
import type { BashExecutorContext } from "./types";

let limiter = new BashProcessLimiter(1);

const execute: typeof executeManagedBash = (input, context, options) =>
  executeManagedBash(input, context, { limiter, ...options });

function context(directory: string): BashExecutorContext {
  return {
    workingDirectory: directory,
    secretBoundary: true,
    processIsolation: true,
    outputBound: 512,
    inputBound: 512,
    durationMs: 3000,
    maxProcesses: 1,
  };
}

describe("alpha acceptance workflow", () => {
  let directory: string;

  beforeEach(async () => {
    limiter = new BashProcessLimiter(1);
    directory = await mkdtemp(join(tmpdir(), "bash-accept-"));
  });

  afterEach(async () => {
    limiter = new BashProcessLimiter(1);
    await rm(directory, { recursive: true, force: true });
  });

  it("reads, greps, edits, rereads, and returns bounded output on one path", async () => {
    const path = join(directory, "alpha.json");
    await writeFile(path, '{"name":"alpha","status":"draft"}\n');

    const initial = await readFile({ path });
    expect(initial).toMatchObject({ status: "success" });

    if (initial.status !== "success" || initial.kind !== "file") return;
    expect(initial.content).toContain("draft");

    const grep = await execute(
      { command: "grep", args: ["-n", "draft", "alpha.json"] },
      context(directory),
    );

    expect(grep).toMatchObject({ status: "success" });

    if (!("stdout" in grep)) return;
    expect(grep.stdout).toContain("draft");
    expect(grep.truncated).toBe(false);

    const edited = await editFile({
      path,
      oldText: '"status":"draft"',
      newText: '"status":"ready"',
    });

    expect(edited).toMatchObject({ status: "success" });

    const reread = await readFile({ path });
    expect(reread).toMatchObject({ status: "success" });

    if (reread.status !== "success" || reread.kind !== "file") return;
    expect(reread.content).toContain("ready");
    expect(reread.content).not.toContain("draft");

    const python = await execute(
      {
        command: "python3",
        args: [
          "-c",
          "import json; print(json.load(open('alpha.json'))['status'])",
        ],
      },
      context(directory),
    );

    expect(python).toMatchObject({ status: "success", stdout: "ready\n" });
  });
});
