import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { WRITER_STREAM_ID_PATTERN } from "@workspace/federation-experiment";
import { z } from "zod";

import type { RunControlProxyPeer } from "./run-control-proxy.js";

const manifestSchema = z.strictObject({
  version: z.literal(1),
  peers: z
    .array(
      z.strictObject({
        peerId: z.string().regex(WRITER_STREAM_ID_PATTERN),
        origin: z.string().min(1),
        credentialPath: z.string().min(1),
      }),
    )
    .min(1),
});

async function readOwnerOnlyCredential(path: string): Promise<string> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error("proxy peer credential must be owner-only");
  }
  const credential = (await readFile(path, "utf8")).trim();
  if (credential.length < 16) {
    throw new Error(
      "proxy peer credential must contain at least 16 characters",
    );
  }
  return credential;
}

export async function loadProxyPeerManifest(
  manifestPath: string,
): Promise<readonly RunControlProxyPeer[]> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error("invalid proxy peer manifest");
  }
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid proxy peer manifest");
  const baseDirectory = dirname(manifestPath);
  return Promise.all(
    parsed.data.peers.map(async (peer) => ({
      peerId: peer.peerId,
      peerUrl: peer.origin,
      peerBearerToken: await readOwnerOnlyCredential(
        isAbsolute(peer.credentialPath)
          ? peer.credentialPath
          : resolve(baseDirectory, peer.credentialPath),
      ),
    })),
  );
}
