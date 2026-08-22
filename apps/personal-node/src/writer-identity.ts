import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generateWriterIdentity } from "@workspace/federation-experiment/batch-signature";

export interface InitializedWriterIdentity {
  readonly keyId: string;
  readonly publicKeyPath: string;
  readonly privateKeyPath: string;
}

export async function initializeEd25519Identity(
  parentDirectory: string,
  identityDirectoryName: string,
): Promise<InitializedWriterIdentity> {
  const identityDirectory = join(parentDirectory, identityDirectoryName);
  await mkdir(identityDirectory, { mode: 0o700 });
  const publicKeyPath = join(identityDirectory, "public.pem");
  const privateKeyPath = join(identityDirectory, "private.pem");
  try {
    const identity = generateWriterIdentity();
    await writeFile(privateKeyPath, identity.privateKeyPem, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(publicKeyPath, identity.publicKeyPem, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    return { keyId: identity.keyId, publicKeyPath, privateKeyPath };
  } catch (error) {
    await rm(identityDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function initializeWriterIdentity(
  parentDirectory: string,
): Promise<InitializedWriterIdentity> {
  return initializeEd25519Identity(parentDirectory, "writer-identity");
}
