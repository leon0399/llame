import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { describeCliError } from "./cli-error.js";
import {
  parsePersonalNodeCommand,
  type PeerCredentialSource,
  type PersonalNodeConfig,
} from "./config.js";
import { createCredentialFile } from "./credential-file.js";
import { enrollWithPeer } from "./enrollment-client.js";
import {
  appendLocalMessage,
  appendSignedLocalMessage,
} from "./local-authoring.js";
import { SqliteEnrollmentRegistry } from "./enrollment-registry.js";
import { createPersonalNodeServer } from "./node-server.js";
import { initializeNodeIdentity } from "./node-identity.js";
import { createRunControlProxyServer } from "./run-control-proxy.js";
import { SqliteRunControlStore } from "./run-control-store.js";
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

async function readPeerCredential(
  source: PeerCredentialSource,
): Promise<string> {
  return source.kind === "environment"
    ? source.value
    : (await readFile(source.path, "utf8")).trim();
}

async function run(): Promise<void> {
  const command = parsePersonalNodeCommand(process.argv.slice(2), process.env);
  if (command.kind === "init-identity") {
    const identity = await initializeWriterIdentity(command.directory);
    process.stdout.write(`${JSON.stringify(identity)}\n`);
    return;
  }
  if (command.kind === "init-node-identity") {
    const identity = await initializeNodeIdentity(command.directory);
    process.stdout.write(`${JSON.stringify(identity)}\n`);
    return;
  }
  if (command.kind === "enroll") {
    const grant = await createCredentialFile(command.credentialPath, async () =>
      enrollWithPeer({
        peerUrl: command.peerUrl,
        ownerBearerToken: command.ownerBearerToken,
        nodeId: command.node.nodeId,
        realmId: command.node.realmId,
        privateKeyPem: await readFile(command.privateKeyPath, "utf8"),
        scopes: command.scopes,
      }),
    );
    process.stdout.write(
      `${JSON.stringify({
        status: "enrolled",
        nodeId: grant.nodeId,
        keyId: grant.keyId,
        credentialPath: command.credentialPath,
      })}\n`,
    );
    return;
  }
  if (command.kind === "proxy") {
    const server = createRunControlProxyServer({
      localBearerToken: command.localBearerToken,
      peerUrl: command.peerUrl,
      peerBearerToken: await readPeerCredential(command.peerCredential),
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(command.port, command.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    process.stdout.write(
      `${JSON.stringify({
        status: "proxying",
        peerOrigin: command.peerUrl,
        origin: `http://${command.host}:${command.port}`,
      })}\n`,
    );
    let closing = false;
    const close = (): void => {
      if (closing) return;
      closing = true;
      server.close();
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    return;
  }
  const store = await openStore(command.node);
  if (command.kind === "sync") {
    try {
      const peerBearerToken = await readPeerCredential(command.peerCredential);
      const result = await syncFromPeer({
        store,
        peerUrl: command.peerUrl,
        bearerToken: peerBearerToken,
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

  const enrollmentRegistry = new SqliteEnrollmentRegistry({
    databasePath: command.node.databasePath,
    realmId: command.node.realmId,
  });
  const runControlStore = new SqliteRunControlStore({
    databasePath: command.node.databasePath,
    realmId: command.node.realmId,
  });
  const server = createPersonalNodeServer({
    nodeId: command.node.nodeId,
    bearerToken: command.node.bearerToken,
    store,
    enrollmentRegistry,
    runControlStore,
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
    runControlStore.close();
    enrollmentRegistry.close();
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
      runControlStore.close();
      enrollmentRegistry.close();
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
