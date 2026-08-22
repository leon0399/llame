import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { describeCliError } from "./cli-error.js";
import { parsePersonalNodeCommand, type PersonalNodeConfig } from "./config.js";
import {
  appendLocalMessage,
  appendSignedLocalMessage,
} from "./local-authoring.js";
import { createPersonalNodeServer } from "./node-server.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";
import { syncFromPeer } from "./sync-client.js";
import { initializeWriterIdentity } from "./writer-identity.js";

async function openStore(
  config: PersonalNodeConfig,
): Promise<SqlitePersonalRealmStore> {
  await mkdir(dirname(config.databasePath), { recursive: true });
  const trustedWriterKeys =
    config.trustedWriterKeyPaths === undefined
      ? undefined
      : Object.fromEntries(
          await Promise.all(
            Object.entries(config.trustedWriterKeyPaths).map(
              async ([writerStreamId, path]) => [
                writerStreamId,
                await readFile(path, "utf8"),
              ],
            ),
          ),
        );
  return new SqlitePersonalRealmStore({
    databasePath: config.databasePath,
    realmId: config.realmId,
    writerEpochs: config.writerEpochs,
    ...(trustedWriterKeys === undefined ? {} : { trustedWriterKeys }),
  });
}

async function run(): Promise<void> {
  const command = parsePersonalNodeCommand(process.argv.slice(2), process.env);
  if (command.kind === "init-identity") {
    const identity = await initializeWriterIdentity(command.directory);
    process.stdout.write(`${JSON.stringify(identity)}\n`);
    return;
  }
  const store = await openStore(command.node);
  if (command.kind === "sync") {
    try {
      const result = await syncFromPeer({
        store,
        peerUrl: command.peerUrl,
        bearerToken: command.peerBearerToken,
        mode: command.mode,
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
      const appendOptions = {
        store,
        writerStreamId: command.node.nodeId,
        writerEpoch,
        chatId: command.chatId,
        parentMessageId: command.parentMessageId,
        text: command.text,
      };
      const result =
        command.privateKeyPath === undefined
          ? appendLocalMessage(appendOptions)
          : appendSignedLocalMessage({
              ...appendOptions,
              privateKeyPem: await readFile(command.privateKeyPath, "utf8"),
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
  process.stderr.write(`${JSON.stringify(describeCliError(error))}\n`);
  process.exitCode = 1;
}
