import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { redactCredentials, runGitProcess } from "./run";

describe("redactCredentials", () => {
  it("removes a token carried in a clone URL userinfo part", () => {
    expect(
      redactCredentials(
        "fatal: unable to access 'https://ghp_secret@github.com/leon0399/llame/'",
      ),
    ).toBe("fatal: unable to access 'https://github.com/leon0399/llame/'");
    expect(redactCredentials("https://user:password@host/owner/repo")).toBe(
      "https://host/owner/repo",
    );
  });

  it("keeps the scp-style git user, which carries no password", () => {
    expect(redactCredentials("git@github.com:leon0399/llame.git")).toBe(
      "git@github.com:leon0399/llame.git",
    );
  });
});

describe("runGitProcess", () => {
  const created: Array<string> = [];

  /** A `git` that blocks, so the deadline is what ends the call. */
  function blockingGitOnPath(): void {
    const directory = mkdtempSync(join(tmpdir(), "git-executor-shim-"));
    created.push(directory);
    // `exec`, so the killed process is the sleeper itself and not a shell
    // whose child would keep the pipes (and the `close` event) alive.
    writeFileSync(join(directory, "git"), "#!/bin/sh\nexec sleep 30\n", {
      mode: 0o755,
    });
    chmodSync(join(directory, "git"), 0o755);
    process.env["PATH"] = `${directory}:${process.env["PATH"] ?? ""}`;
  }

  afterEach(() => {
    for (const directory of created.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("kills a running git at the deadline and reports a typed timeout", async () => {
    const previousPath = process.env["PATH"];
    blockingGitOnPath();
    try {
      const started = Date.now();
      const result = await runGitProcess(["--version"], { timeoutMs: 200 });

      expect(result).toMatchObject({ status: "timed_out" });
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      process.env["PATH"] = previousPath;
    }
  });

  it("decodes a multi-byte character split across two chunks", async () => {
    const shim = mkdtempSync(join(tmpdir(), "git-executor-split-"));
    created.push(shim);
    // The three bytes of one character are written as two chunks, with a pause
    // so the pipe cannot merge them: decoding each chunk on its own answers
    // replacement characters, which is what a path or a remote would then be
    // stored as.
    writeFileSync(
      join(shim, "git"),
      Buffer.concat([
        Buffer.from("#!/bin/sh\nprintf '"),
        Buffer.from([0xe4, 0xb8]),
        Buffer.from("'\nsleep 0.2\nprintf '"),
        Buffer.from([0x96]),
        Buffer.from("\\n'\n"),
      ]),
      { mode: 0o755 },
    );
    const previousPath = process.env["PATH"];
    process.env["PATH"] = `${shim}:${previousPath ?? ""}`;
    try {
      const result = await runGitProcess(["--version"], { timeoutMs: 5000 });

      expect(result.status).toBe("ok");
      expect(result.stdout).toBe("世\n");
    } finally {
      process.env["PATH"] = previousPath;
    }
  });

  it("reports a non-zero exit as a typed failure with git's own text", async () => {
    const result = await runGitProcess(["--definitely-not-a-flag"], {
      timeoutMs: 5000,
    });

    if (result.status !== "failed") {
      throw new Error(`expected a failed call, got ${result.status}`);
    }
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unknown option");
  });
});
