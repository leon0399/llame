import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { initializeNodeIdentity } from "./node-identity.js";

describe("personal Node transport identity", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("creates a distinct non-overwritable owner-only Ed25519 identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-node-identity-"));
    temporaryDirectories.push(directory);

    const identity = await initializeNodeIdentity(directory);

    expect(identity.privateKeyPath).toContain("/node-identity/");
    expect(await readFile(identity.publicKeyPath, "utf8")).toContain(
      "BEGIN PUBLIC KEY",
    );
    expect(await readFile(identity.privateKeyPath, "utf8")).toContain(
      "BEGIN PRIVATE KEY",
    );
    expect((await stat(identity.privateKeyPath)).mode & 0o777).toBe(0o600);
    await expect(initializeNodeIdentity(directory)).rejects.toMatchObject({
      code: "EEXIST",
    });
  });
});
