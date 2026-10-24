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

  it("kills a running git when the caller aborts the call", async () => {
    const previousPath = process.env["PATH"];
    blockingGitOnPath();
    try {
      const controller = new AbortController();
      const call = runGitProcess(["--version"], {
        timeoutMs: 30_000,
        signal: controller.signal,
      });
      controller.abort();

      await expect(call).resolves.toMatchObject({ status: "timed_out" });
    } finally {
      process.env["PATH"] = previousPath;
    }
  });

  it("starts git with the sanitized environment and nothing else", async () => {
    // "Credential prompt cannot block the daemon": no `GIT_*` variable the
    // caller's process exported reaches git, and the prompt is off.
    const previousPath = process.env["PATH"];
    const directory = mkdtempSync(join(tmpdir(), "git-executor-env-"));
    created.push(directory);
    writeFileSync(join(directory, "git"), "#!/bin/sh\nenv\n", {
      mode: 0o755,
    });
    process.env["PATH"] = `${directory}:${previousPath ?? ""}`;
    try {
      const result = await runGitProcess([], { timeoutMs: 5000 });

      if (result.status !== "ok") {
        throw new Error(`expected a clean call, got ${result.status}`);
      }
      expect(result.stdout).toMatch(/^GIT_TERMINAL_PROMPT=0$/mu);
      expect(result.stdout).toMatch(/^LC_ALL=C$/mu);
      expect(result.stdout).toMatch(/^GIT_OPTIONAL_LOCKS=0$/mu);
      expect(result.stdout).not.toMatch(/^GIT_DIR=/mu);
    } finally {
      process.env["PATH"] = previousPath;
    }
  });

  it("starts no git for a call that is already aborted", async () => {
    const result = await runGitProcess(["--version"], {
      timeoutMs: 5000,
      signal: AbortSignal.abort(),
    });

    expect(result).toEqual({ status: "timed_out", stdout: "", stderr: "" });
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
