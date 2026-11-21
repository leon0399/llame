import { mkdtempSync, rmSync } from "node:fs";
import {
  arch,
  availableParallelism,
  platform,
  release,
  tmpdir,
  totalmem,
} from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { machineFacts } from "./facts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "llame-facts-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("machine facts", () => {
  it("reports the host and one disk entry per root in order", () => {
    const missing = join(root, "missing");
    const facts = machineFacts([root, missing]);

    expect(facts).toMatchObject({
      os: platform(),
      arch: arch(),
      kernel: release(),
      cpuCount: availableParallelism(),
      totalMemoryBytes: totalmem(),
    });
    expect(facts.rootDisks.map((disk) => disk.root)).toEqual([root, missing]);
    const [rootDisk, missingDisk] = facts.rootDisks;
    expect(rootDisk).toBeDefined();
    expect(missingDisk).toBeDefined();

    if (rootDisk === undefined || missingDisk === undefined)
      throw new Error("expected one disk entry per root");

    expect(rootDisk.totalBytes).toBeGreaterThan(0);
    expect(missingDisk.totalBytes).toBeNull();
  });
});
