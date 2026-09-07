import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFile, editFile, readFile } from "@workspace/native-file-tools";
import { assertSharedWorkingDirectory, executeManagedBash } from "./index";
import type { BashExecutorContext } from "./types";

function context(
  directory: string,
  overrides: Partial<BashExecutorContext> = {},
): BashExecutorContext {
  return {
    workingDirectory: directory,
    fileToolsWorkingDirectory: directory,
    secretBoundary: true,
    processIsolation: true,
    outputBound: 1024,
    inputBound: 512,
    durationMs: 3000,
    maxProcesses: 1,
    ...overrides,
  };
}

describe("file-context handoff", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "bash-files-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("lets bash observe a native edit in the same directory", async () => {
    const path = join(directory, "note.txt");
    await writeFile(path, "before\n");
    const edited = await editFile({
      path,
      oldText: "before\n",
      newText: "after-edit\n",
    });
    expect(edited).toMatchObject({ status: "success" });

    const bash = await executeManagedBash(
      { command: "bash", args: ["-c", "cat note.txt"] },
      context(directory),
    );
    expect(bash).toMatchObject({
      status: "success",
      executor: "managed",
      stdout: "after-edit\n",
    });
  });

  it("lets native read observe a known bash mutation", async () => {
    const path = join(directory, "note.txt");
    await writeFile(path, "seed\n");
    const bash = await executeManagedBash(
      {
        command: "bash",
        args: ["-c", String.raw`printf 'from-bash\n' > note.txt`],
      },
      context(directory),
    );
    expect(bash).toMatchObject({ status: "success", executor: "managed" });

    const read = await readFile({ path });
    expect(read).toMatchObject({ status: "success" });
    if (read.status !== "success") return;
    expect(read.content).toContain("from-bash");
  });

  it("runs create, bash inspect, edit, and reread on one path", async () => {
    const path = join(directory, "alpha.txt");
    const created = await createFile({ path, content: "line-one\n" });
    expect(created).toMatchObject({ status: "success", operation: "write" });

    const listed = await executeManagedBash(
      { command: "bash", args: ["-c", "cat alpha.txt"] },
      context(directory),
    );
    expect(listed).toMatchObject({ status: "success", stdout: "line-one\n" });

    const edited = await editFile({
      path,
      oldText: "line-one\n",
      newText: "line-two\n",
    });
    expect(edited).toMatchObject({ status: "success" });

    const reread = await readFile({ path });
    expect(reread).toMatchObject({ status: "success" });
    if (reread.status !== "success") return;
    expect(reread.content).toContain("line-two");
  });

  it("refuses concurrent processes when the managed limit is one", async () => {
    const controller = new AbortController();
    const first = executeManagedBash(
      {
        command: "bash",
        args: ["-c", "while true; do printf x; sleep 0.05; done"],
      },
      context(directory, { durationMs: 5000 }),
      { signal: controller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await executeManagedBash(
      { command: "bash", args: ["-c", "printf race"] },
      context(directory),
    );
    expect(second).toMatchObject({ type: "unavailable" });
    controller.abort();
    expect(await first).toMatchObject({ type: "cancelled" });
  });

  it("fails closed when bash and native directories diverge", () => {
    expect(
      assertSharedWorkingDirectory(
        context(directory, {
          fileToolsWorkingDirectory: join(directory, "missing-sibling"),
        }),
      ),
    ).toMatchObject({ type: "workspace_mismatch" });
  });
});
