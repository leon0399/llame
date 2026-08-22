import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { loadProxyPeerManifest } from "./proxy-peer-manifest.js";

describe("proxy peer manifest", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  test("loads configured origins and credentials without persisting secrets in routes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-proxy-peers-"));
    directories.push(directory);
    await writeFile(
      join(directory, "workstation.credential"),
      "workstation-secret\n",
      { mode: 0o600 },
    );
    await writeFile(
      join(directory, "peers.json"),
      JSON.stringify({
        version: 1,
        peers: [
          {
            peerId: "workstation",
            origin: "https://workstation.example.test",
            credentialPath: "workstation.credential",
          },
        ],
      }),
    );

    expect(await loadProxyPeerManifest(join(directory, "peers.json"))).toEqual([
      {
        peerId: "workstation",
        peerUrl: "https://workstation.example.test",
        peerBearerToken: "workstation-secret",
      },
    ]);
  });

  test("refuses credentials readable by another OS user", async () => {
    const directory = await mkdtemp(join(tmpdir(), "llame-proxy-peers-"));
    directories.push(directory);
    const credentialPath = join(directory, "peer.credential");
    await writeFile(credentialPath, "peer-credential-secret\n", {
      mode: 0o600,
    });
    await chmod(credentialPath, 0o644);
    await writeFile(
      join(directory, "peers.json"),
      JSON.stringify({
        version: 1,
        peers: [
          {
            peerId: "peer",
            origin: "https://peer.example.test",
            credentialPath: "peer.credential",
          },
        ],
      }),
    );

    await expect(
      loadProxyPeerManifest(join(directory, "peers.json")),
    ).rejects.toThrowError("proxy peer credential must be owner-only");
  });
});
