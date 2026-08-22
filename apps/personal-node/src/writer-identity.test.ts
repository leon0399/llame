import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { initializeWriterIdentity } from "./writer-identity.js";

describe("personal Node writer identity", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("creates a non-overwritable owner-only Ed25519 identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-writer-identity-"));
    temporaryDirectories.push(directory);

    const identity = await initializeWriterIdentity(directory);

    expect(identity.keyId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await readFile(identity.publicKeyPath, "utf8")).toContain(
      "BEGIN PUBLIC KEY",
    );
    expect(await readFile(identity.privateKeyPath, "utf8")).toContain(
      "BEGIN PRIVATE KEY",
    );
    expect((await stat(identity.privateKeyPath)).mode & 0o777).toBe(0o600);
    expect((await stat(identity.publicKeyPath)).mode & 0o777).toBe(0o644);
    await expect(initializeWriterIdentity(directory)).rejects.toMatchObject({
      code: "EEXIST",
    });
  });
});
