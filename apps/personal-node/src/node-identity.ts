import {
  initializeEd25519Identity,
  type InitializedWriterIdentity,
} from "./writer-identity.js";

export type InitializedNodeIdentity = InitializedWriterIdentity;

export function initializeNodeIdentity(
  parentDirectory: string,
): Promise<InitializedNodeIdentity> {
  return initializeEd25519Identity(parentDirectory, "node-identity");
}
