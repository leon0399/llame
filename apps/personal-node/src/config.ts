export interface PersonalNodeConfig {
  readonly databasePath: string;
  readonly nodeId: string;
  readonly realmId: string;
  readonly bearerToken: string;
  readonly writerEpochs: Readonly<Record<string, number>>;
  readonly trustedWriterKeyPaths?: Readonly<Record<string, string>>;
}

export type PeerCredentialSource =
  | { readonly kind: "environment"; readonly value: string }
  | { readonly kind: "file"; readonly path: string };

export type PersonalNodeCommand =
  | {
      readonly kind: "init-identity";
      readonly directory: string;
    }
  | {
      readonly kind: "init-node-identity";
      readonly directory: string;
    }
  | {
      readonly kind: "serve";
      readonly node: PersonalNodeConfig;
      readonly host: string;
      readonly port: number;
    }
  | {
      readonly kind: "sync";
      readonly node: PersonalNodeConfig;
      readonly peerUrl: string;
      readonly peerCredential: PeerCredentialSource;
      readonly mode?: "signed";
    }
  | {
      readonly kind: "enroll";
      readonly node: PersonalNodeConfig;
      readonly peerUrl: string;
      readonly ownerBearerToken: string;
      readonly privateKeyPath: string;
      readonly credentialPath: string;
    }
  | {
      readonly kind: "append";
      readonly node: PersonalNodeConfig;
      readonly chatId: string;
      readonly parentMessageId: string | null;
      readonly text: string;
      readonly privateKeyPath?: string;
    };

type Environment = Readonly<Record<string, string | undefined>>;

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseWriterEpochs(
  input: string | undefined,
  nodeId: string,
): Readonly<Record<string, number>> {
  if (input === undefined) return { [nodeId]: 1 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("LLAME_WRITER_EPOCHS must be a JSON object");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("LLAME_WRITER_EPOCHS must be a JSON object");
  }
  const epochs: Record<string, number> = {};
  for (const [writerStreamId, epoch] of Object.entries(parsed)) {
    if (
      !WRITER_STREAM_ID_PATTERN.test(writerStreamId) ||
      typeof epoch !== "number" ||
      !Number.isInteger(epoch) ||
      epoch <= 0
    ) {
      throw new Error("LLAME_WRITER_EPOCHS contains an invalid writer epoch");
    }
    epochs[writerStreamId] = epoch;
  }
  if (epochs[nodeId] === undefined) {
    throw new Error("LLAME_WRITER_EPOCHS must authorize LLAME_NODE_ID");
  }
  return epochs;
}

function parseTrustedWriterKeyPaths(
  input: string | undefined,
): Readonly<Record<string, string>> | undefined {
  if (input === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("LLAME_TRUSTED_WRITER_KEYS must be a JSON object");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("LLAME_TRUSTED_WRITER_KEYS must be a JSON object");
  }
  const paths: Record<string, string> = {};
  for (const [writerAuthorization, path] of Object.entries(parsed)) {
    const separator = writerAuthorization.lastIndexOf(":");
    const writerStreamId = writerAuthorization.slice(0, separator);
    const writerEpoch = Number(writerAuthorization.slice(separator + 1));
    if (
      !WRITER_STREAM_ID_PATTERN.test(writerStreamId) ||
      !Number.isInteger(writerEpoch) ||
      writerEpoch <= 0 ||
      typeof path !== "string" ||
      path.length === 0
    ) {
      throw new Error("LLAME_TRUSTED_WRITER_KEYS contains an invalid key path");
    }
    paths[writerAuthorization] = path;
  }
  if (Object.keys(paths).length === 0) {
    throw new Error("LLAME_TRUSTED_WRITER_KEYS must not be empty");
  }
  return paths;
}

function parseNodeConfig(environment: Environment): PersonalNodeConfig {
  const nodeId = required(environment, "LLAME_NODE_ID");
  const bearerToken = required(environment, "LLAME_NODE_TOKEN");
  if (bearerToken.length < 16) {
    throw new Error("LLAME_NODE_TOKEN must contain at least 16 characters");
  }
  const trustedWriterKeyPaths = parseTrustedWriterKeyPaths(
    environment.LLAME_TRUSTED_WRITER_KEYS,
  );
  return {
    databasePath: required(environment, "LLAME_NODE_DB"),
    nodeId,
    realmId: required(environment, "LLAME_REALM_ID"),
    bearerToken,
    writerEpochs: parseWriterEpochs(environment.LLAME_WRITER_EPOCHS, nodeId),
    ...(trustedWriterKeyPaths === undefined ? {} : { trustedWriterKeyPaths }),
  };
}

function parsePort(input: string | undefined): number {
  if (input === undefined) return 4370;
  const port = Number(input);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("LLAME_NODE_PORT must be an integer from 1 to 65535");
  }
  return port;
}

export function parsePersonalNodeCommand(
  arguments_: readonly string[],
  environment: Environment,
): PersonalNodeCommand {
  const command = arguments_[0] ?? "serve";
  if (command === "init-identity") {
    const directory = arguments_[1];
    if (directory === undefined || directory.length === 0) {
      throw new Error("init-identity requires a directory");
    }
    return { kind: "init-identity", directory };
  }
  if (command === "init-node-identity") {
    const directory = arguments_[1];
    if (directory === undefined || directory.length === 0) {
      throw new Error("init-node-identity requires a directory");
    }
    return { kind: "init-node-identity", directory };
  }
  const node = parseNodeConfig(environment);
  if (command === "serve") {
    const host = environment.LLAME_NODE_HOST ?? "127.0.0.1";
    if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
      throw new Error(
        "personal Node must bind loopback; expose it through a secure tunnel",
      );
    }
    return {
      kind: "serve",
      node,
      host,
      port: parsePort(environment.LLAME_NODE_PORT),
    };
  }
  if (command === "sync") {
    const peerUrl = arguments_[1];
    if (peerUrl === undefined) throw new Error("sync requires a peer URL");
    const mode = environment.LLAME_SYNC_MODE;
    if (mode !== undefined && mode !== "unsigned" && mode !== "signed") {
      throw new Error("LLAME_SYNC_MODE must be unsigned or signed");
    }
    if (mode === "signed" && node.trustedWriterKeyPaths === undefined) {
      throw new Error("signed sync requires LLAME_TRUSTED_WRITER_KEYS");
    }
    const credentialPath = environment.LLAME_PEER_CREDENTIAL_PATH;
    const peerCredential: PeerCredentialSource =
      credentialPath === undefined
        ? {
            kind: "environment",
            value: required(environment, "LLAME_PEER_TOKEN"),
          }
        : { kind: "file", path: credentialPath };
    return {
      kind: "sync",
      node,
      peerUrl,
      peerCredential,
      ...(mode === "signed" ? { mode } : {}),
    };
  }
  if (command === "enroll") {
    const peerUrl = arguments_[1];
    if (peerUrl === undefined) throw new Error("enroll requires a peer URL");
    return {
      kind: "enroll",
      node,
      peerUrl,
      ownerBearerToken: required(environment, "LLAME_PEER_TOKEN"),
      privateKeyPath: required(environment, "LLAME_NODE_PRIVATE_KEY"),
      credentialPath: required(environment, "LLAME_PEER_CREDENTIAL_PATH"),
    };
  }
  if (command === "append") {
    const chatId = arguments_[1];
    const encodedParent = arguments_[2];
    const text = arguments_.slice(3).join(" ");
    if (
      chatId === undefined ||
      encodedParent === undefined ||
      text.length === 0
    ) {
      throw new Error("append requires CHAT_ID PARENT_MESSAGE_ID_OR_DASH TEXT");
    }
    const privateKeyPath = environment.LLAME_WRITER_PRIVATE_KEY;
    if (
      privateKeyPath !== undefined &&
      node.trustedWriterKeyPaths === undefined
    ) {
      throw new Error("signed append requires LLAME_TRUSTED_WRITER_KEYS");
    }
    return {
      kind: "append",
      node,
      chatId,
      parentMessageId: encodedParent === "-" ? null : encodedParent,
      text,
      ...(privateKeyPath === undefined ? {} : { privateKeyPath }),
    };
  }
  throw new Error(`unsupported personal Node command: ${command}`);
}
import { WRITER_STREAM_ID_PATTERN } from "@workspace/federation-experiment";
