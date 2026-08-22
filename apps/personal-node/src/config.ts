export interface PersonalNodeConfig {
  readonly databasePath: string;
  readonly nodeId: string;
  readonly realmId: string;
  readonly bearerToken: string;
  readonly writerEpochs: Readonly<Record<string, number>>;
}

export type PersonalNodeCommand =
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
      readonly peerBearerToken: string;
    }
  | {
      readonly kind: "append";
      readonly node: PersonalNodeConfig;
      readonly chatId: string;
      readonly parentMessageId: string | null;
      readonly text: string;
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
      writerStreamId.length === 0 ||
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

function parseNodeConfig(environment: Environment): PersonalNodeConfig {
  const nodeId = required(environment, "LLAME_NODE_ID");
  const bearerToken = required(environment, "LLAME_NODE_TOKEN");
  if (bearerToken.length < 16) {
    throw new Error("LLAME_NODE_TOKEN must contain at least 16 characters");
  }
  return {
    databasePath: required(environment, "LLAME_NODE_DB"),
    nodeId,
    realmId: required(environment, "LLAME_REALM_ID"),
    bearerToken,
    writerEpochs: parseWriterEpochs(environment.LLAME_WRITER_EPOCHS, nodeId),
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
  const node = parseNodeConfig(environment);
  const command = arguments_[0] ?? "serve";
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
    return {
      kind: "sync",
      node,
      peerUrl,
      peerBearerToken: required(environment, "LLAME_PEER_TOKEN"),
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
    return {
      kind: "append",
      node,
      chatId,
      parentMessageId: encodedParent === "-" ? null : encodedParent,
      text,
    };
  }
  throw new Error(`unsupported personal Node command: ${command}`);
}
