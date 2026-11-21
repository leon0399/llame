import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdOf, currentBuildId } from "./build-id";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "llame-build-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("build id", () => {
  it("hashes the script's bytes to twelve hex characters", () => {
    const script = join(directory, "llame-machine.cjs");
    const content = "#!/usr/bin/env node\nconsole.log('hi');\n";
    writeFileSync(script, content);

    expect(buildIdOf(script)).toBe(
      createHash("sha256").update(content).digest("hex").slice(0, 12),
    );
  });

  it("is unknown when the script is missing or unreadable", () => {
    expect(buildIdOf(join(directory, "absent"))).toBe("unknown");
    expect(buildIdOf(undefined)).toBe("unknown");
    expect(currentBuildId()).toMatch(/^(?:[0-9a-f]{12}|unknown)$/);
  });
});
