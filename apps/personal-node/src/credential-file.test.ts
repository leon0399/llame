import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { createCredentialFile } from "./credential-file.js";

describe("node credential persistence", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  test("reserves the destination before issuing and persists owner-only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-credential-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "nested", "peer.credential");

    const result = await createCredentialFile(path, async () => ({
      credential: "new-secret-credential",
      nodeId: "desktop",
    }));

    expect(result.nodeId).toBe("desktop");
    expect(await readFile(path, "utf8")).toBe("new-secret-credential\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("does not issue when the destination already exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-credential-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "peer.credential");
    await writeFile(path, "existing\n", { mode: 0o600 });
    const issue = vi.fn(async () => ({ credential: "lost-secret" }));

    await expect(createCredentialFile(path, issue)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(issue).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe("existing\n");
  });

  test("removes its reservation when issuance fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-credential-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "peer.credential");

    await expect(
      createCredentialFile(path, async () => {
        throw new Error("enrollment rejected");
      }),
    ).rejects.toThrowError("enrollment rejected");
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
