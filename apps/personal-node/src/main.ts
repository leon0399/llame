import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { parsePersonalNodeCommand, type PersonalNodeConfig } from "./config.js";
import { appendLocalMessage } from "./local-authoring.js";
import { createPersonalNodeServer } from "./node-server.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";
import { syncFromPeer } from "./sync-client.js";

async function openStore(
  config: PersonalNodeConfig,
): Promise<SqlitePersonalRealmStore> {
  await mkdir(dirname(config.databasePath), { recursive: true });
  return new SqlitePersonalRealmStore({
    databasePath: config.databasePath,
    realmId: config.realmId,
    writerEpochs: config.writerEpochs,
  });
}

async function run(): Promise<void> {
  const command = parsePersonalNodeCommand(process.argv.slice(2), process.env);
  const store = await openStore(command.node);
  if (command.kind === "sync") {
    try {
      const result = await syncFromPeer({
        store,
        peerUrl: command.peerUrl,
        bearerToken: command.peerBearerToken,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
      store.close();
    }
    return;
  }
  if (command.kind === "append") {
    try {
      const writerEpoch = command.node.writerEpochs[command.node.nodeId];
      if (writerEpoch === undefined) {
        throw new Error("local writer is not authorized");
      }
      const result = appendLocalMessage({
        store,
        writerStreamId: command.node.nodeId,
        writerEpoch,
        chatId: command.chatId,
        parentMessageId: command.parentMessageId,
        text: command.text,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
      store.close();
    }
    return;
  }

  const server = createPersonalNodeServer({
    nodeId: command.node.nodeId,
    bearerToken: command.node.bearerToken,
    store,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(command.port, command.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    store.close();
    throw error;
  }
  process.stdout.write(
    `${JSON.stringify({
      status: "listening",
      nodeId: command.node.nodeId,
      realmId: command.node.realmId,
      origin: `http://${command.host}:${command.port}`,
    })}\n`,
  );

  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    server.close(() => {
      store.close();
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`personal Node failed: ${message}\n`);
  process.exitCode = 1;
}
