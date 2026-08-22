import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { describeCliError } from "./cli-error.js";
import {
  parsePersonalNodeCommand,
  type PeerCredentialSource,
  type PersonalNodeConfig,
} from "./config.js";
import { createCredentialFile } from "./credential-file.js";
import { DockerCliContainerEngine } from "./docker-cli-container-engine.js";
import { enrollWithPeer } from "./enrollment-client.js";
import {
  appendLocalMessage,
  appendSignedLocalMessage,
} from "./local-authoring.js";
import { SqliteEnrollmentRegistry } from "./enrollment-registry.js";
import { createPersonalNodeServer } from "./node-server.js";
import { initializeNodeIdentity } from "./node-identity.js";
import { loadProxyPeerManifest } from "./proxy-peer-manifest.js";
import { PeerSyncSupervisor } from "./peer-sync-supervisor.js";
import { GitWorktreeManager } from "./git-worktree-manager.js";
import { SignedRealmRunAuthor } from "./realm-run-author.js";
import { createRunControlProxyServer } from "./run-control-proxy.js";
import { SqliteRunControlProxyCache } from "./run-control-proxy-cache.js";
import { createRunControlProxyRouterServer } from "./run-control-proxy-router.js";
import { SqliteRunControlStore } from "./run-control-store.js";
import { DurableSandboxCommandExecutor } from "./sandbox-command-coordinator.js";
import { SqliteSandboxCommandStore } from "./sandbox-command-store.js";
import { SqliteRunRouteRegistry } from "./run-route-registry.js";
import { SqlitePersonalRealmStore } from "./sqlite-replica.js";
import { DockerSandboxLifecycle } from "./sandbox-container-lifecycle.js";
import { syncFromPeer } from "./sync-client.js";
import { initializeWriterIdentity } from "./writer-identity.js";
import { loadWorkspaceManifest } from "./workspace-manifest.js";
import { WorkspaceRegistry } from "./workspace-registry.js";

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
    ...(config.runControlGrants === undefined
      ? {}
      : { runControlGrants: config.runControlGrants }),
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
  const command = parsePersonalNodeCommand(
    process.argv.slice(2),
    process.env,
    process.env.INIT_CWD ?? process.cwd(),
  );
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
    const peerBearerToken = await readPeerCredential(command.peerCredential);
    if (command.cacheDatabasePath !== undefined) {
      await mkdir(dirname(command.cacheDatabasePath), {
        recursive: true,
        mode: 0o700,
      });
    }
    const cache =
      command.cacheDatabasePath === undefined
        ? undefined
        : new SqliteRunControlProxyCache({
            databasePath: command.cacheDatabasePath,
          });
    let server: ReturnType<typeof createRunControlProxyServer>;
    try {
      server = createRunControlProxyServer({
        localBearerToken: command.localBearerToken,
        peerUrl: command.peerUrl,
        peerBearerToken,
        ...(cache === undefined ? {} : { cache }),
      });
    } catch (error) {
      cache?.close();
      throw error;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(command.port, command.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      cache?.close();
      throw error;
    }
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
      server.close(() => cache?.close());
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    return;
  }
  if (command.kind === "proxy-router") {
    await mkdir(dirname(command.routesDatabasePath), {
      recursive: true,
      mode: 0o700,
    });
    if (command.cacheDatabasePath !== undefined) {
      await mkdir(dirname(command.cacheDatabasePath), {
        recursive: true,
        mode: 0o700,
      });
    }
    const routes = new SqliteRunRouteRegistry({
      databasePath: command.routesDatabasePath,
    });
    const cache =
      command.cacheDatabasePath === undefined
        ? undefined
        : new SqliteRunControlProxyCache({
            databasePath: command.cacheDatabasePath,
          });
    let server: ReturnType<typeof createRunControlProxyRouterServer>;
    try {
      server = createRunControlProxyRouterServer({
        localBearerToken: command.localBearerToken,
        peers: await loadProxyPeerManifest(command.peerManifestPath),
        routes,
        ...(cache === undefined ? {} : { cache }),
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(command.port, command.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
    } catch (error) {
      cache?.close();
      routes.close();
      throw error;
    }
    process.stdout.write(
      `${JSON.stringify({
        status: "routing",
        origin: `http://${command.host}:${command.port}`,
      })}\n`,
    );
    let closing = false;
    const close = (): void => {
      if (closing) return;
      closing = true;
      server.close(() => {
        cache?.close();
        routes.close();
      });
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    return;
  }
  const store = await openStore(command.node);
  if (
    command.kind === "run-create" ||
    command.kind === "run-status" ||
    command.kind === "run-steer" ||
    command.kind === "run-transfer"
  ) {
    try {
      const writerEpoch = command.node.writerEpochs[command.writerStreamId];
      if (writerEpoch === undefined) {
        throw new Error("local writer is not authorized");
      }
      const author = new SignedRealmRunAuthor({
        store,
        writerStreamId: command.writerStreamId,
        writerEpoch,
        privateKeyPem: await readFile(command.privateKeyPath, "utf8"),
      });
      const signed =
        command.kind === "run-create"
          ? author.createRun({
              runId: command.runId,
              executorNodeId: command.executorNodeId,
            })
          : command.kind === "run-status"
            ? author.appendStatus({
                runId: command.runId,
                status: command.status,
              })
            : command.kind === "run-steer"
              ? author.steer({ runId: command.runId, text: command.text })
              : author.transferTo({
                  runId: command.runId,
                  targetExecutorNodeId: command.targetExecutorNodeId,
                  reason: command.reason,
                });
      process.stdout.write(
        `${JSON.stringify({
          status: "authored",
          operation: command.kind,
          runId: command.runId,
          batchRef: `${signed.batch.writerStreamId}:${signed.batch.sequence}`,
          frontier: store.frontier(),
        })}\n`,
      );
    } finally {
      store.close();
    }
    return;
  }
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

  const journalRunWriter = command.node.journalRunWriter;
  let journalRunAuthor: SignedRealmRunAuthor | undefined;
  try {
    if (journalRunWriter !== undefined) {
      const writerEpoch =
        command.node.writerEpochs[journalRunWriter.writerStreamId];
      if (writerEpoch === undefined) {
        throw new Error("journal Run writer is not authorized");
      }
      journalRunAuthor = new SignedRealmRunAuthor({
        store,
        writerStreamId: journalRunWriter.writerStreamId,
        writerEpoch,
        privateKeyPem: await readFile(journalRunWriter.privateKeyPath, "utf8"),
      });
    }
  } catch (error) {
    store.close();
    throw error;
  }
  const enrollmentRegistry = new SqliteEnrollmentRegistry({
    databasePath: command.node.databasePath,
    realmId: command.node.realmId,
  });
  const runControlStore = new SqliteRunControlStore({
    databasePath: command.node.databasePath,
    realmId: command.node.realmId,
  });
  const peerSyncConfig = command.peerSync;
  const syncPeers =
    command.peerSyncManifest === undefined
      ? peerSyncConfig === undefined
        ? []
        : [
            {
              peerId: peerSyncConfig.peerId,
              peerUrl: peerSyncConfig.peerUrl,
              peerBearerToken: await readPeerCredential(
                peerSyncConfig.peerCredential,
              ),
              intervalMilliseconds: peerSyncConfig.intervalMilliseconds,
            },
          ]
      : (await loadProxyPeerManifest(command.peerSyncManifest.path)).map(
          (peer) => ({
            ...peer,
            intervalMilliseconds:
              command.peerSyncManifest?.intervalMilliseconds ?? 5_000,
          }),
        );
  const peerSyncs = syncPeers.map(
    (peer) =>
      new PeerSyncSupervisor({
        peerId: peer.peerId,
        intervalMilliseconds: peer.intervalMilliseconds,
        sync: () =>
          syncFromPeer({
            store,
            peerUrl: peer.peerUrl,
            bearerToken: peer.peerBearerToken,
            mode: "signed",
          }),
      }),
  );
  const workspaceRegistry =
    command.workspaceDefinitions !== undefined
      ? new WorkspaceRegistry(command.workspaceDefinitions, {
          databasePath: command.node.databasePath,
        })
      : command.workspaceManifestPath === undefined
        ? undefined
        : new WorkspaceRegistry(
            await loadWorkspaceManifest(command.workspaceManifestPath),
            { databasePath: command.node.databasePath },
          );
  const gitWorktreeManager =
    command.gitWorktreeRoot === undefined
      ? undefined
      : new GitWorktreeManager({
          worktreeRoot: command.gitWorktreeRoot,
          databasePath: command.node.databasePath,
        });
  await gitWorktreeManager?.recoverPending();
  const sandboxEngine =
    command.sandbox === undefined ? undefined : new DockerCliContainerEngine();
  if (command.sandbox !== undefined && sandboxEngine !== undefined) {
    await sandboxEngine.assertImageAvailable(command.sandbox.image);
  }
  const sandboxLifecycle =
    sandboxEngine === undefined
      ? undefined
      : new DockerSandboxLifecycle(sandboxEngine);
  const sandboxCommandStore =
    command.sandbox === undefined
      ? undefined
      : new SqliteSandboxCommandStore({
          databasePath: command.node.databasePath,
          realmId: command.node.realmId,
        });
  const server = createPersonalNodeServer({
    nodeId: command.node.nodeId,
    bearerToken: command.node.bearerToken,
    store,
    enrollmentRegistry,
    runControlStore,
    journalRunProjection: command.node.journalRunMode !== undefined,
    ...(journalRunAuthor === undefined ? {} : { journalRunAuthor }),
    ...(peerSyncs.length === 0
      ? {}
      : { peerSyncStatus: () => peerSyncs.map((peer) => peer.snapshot()) }),
    ...(workspaceRegistry === undefined ? {} : { workspaceRegistry }),
    ...(gitWorktreeManager === undefined ? {} : { gitWorktreeManager }),
    ...(command.sandbox === undefined || sandboxLifecycle === undefined
      ? {}
      : {
          sandbox: {
            lifecycle: sandboxLifecycle,
            ...(sandboxCommandStore === undefined
              ? {}
              : {
                  commands: new DurableSandboxCommandExecutor(
                    sandboxLifecycle,
                    sandboxCommandStore,
                  ),
                }),
            image: command.sandbox.image,
            user: command.sandbox.user,
          },
        }),
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
    sandboxCommandStore?.close();
    gitWorktreeManager?.close();
    workspaceRegistry?.close();
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
  for (const peerSync of peerSyncs) peerSync.start();

  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    server.close(() => {
      const closeStores = (): void => {
        sandboxCommandStore?.close();
        gitWorktreeManager?.close();
        workspaceRegistry?.close();
        runControlStore.close();
        enrollmentRegistry.close();
        store.close();
      };
      if (peerSyncs.length === 0) closeStores();
      else
        void Promise.all(peerSyncs.map((peer) => peer.stop())).then(
          closeStores,
        );
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
