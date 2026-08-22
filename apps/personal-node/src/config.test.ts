import { describe, expect, test } from "vitest";

import { parsePersonalNodeCommand } from "./config.js";

const baseEnvironment = {
  LLAME_NODE_DB: "/tmp/llame-personal-node.sqlite",
  LLAME_NODE_ID: "desktop",
  LLAME_NODE_TOKEN: "local-node-secret",
  LLAME_REALM_ID: "realm-personal",
} as const;

describe("personal Node command configuration", () => {
  test("initializes a writer identity before Realm configuration exists", () => {
    expect(
      parsePersonalNodeCommand(["init-identity", "/tmp/personal-node"], {}),
    ).toEqual({
      kind: "init-identity",
      directory: "/tmp/personal-node",
    });
  });

  test("initializes a node identity separately from its writer identity", () => {
    expect(
      parsePersonalNodeCommand(
        ["init-node-identity", "/tmp/personal-node"],
        {},
      ),
    ).toEqual({
      kind: "init-node-identity",
      directory: "/tmp/personal-node",
    });
  });

  test("parses a lightweight Run-control proxy without local Realm storage", () => {
    expect(
      parsePersonalNodeCommand(["proxy", "https://worker.example.test"], {
        LLAME_NODE_TOKEN: "phone-facing-secret",
        LLAME_PEER_CREDENTIAL_PATH: "/keys/worker.credential",
        LLAME_PROXY_CACHE_DB: "/state/run-proxy-cache.sqlite",
      }),
    ).toEqual({
      kind: "proxy",
      localBearerToken: "phone-facing-secret",
      peerUrl: "https://worker.example.test",
      peerCredential: {
        kind: "file",
        path: "/keys/worker.credential",
      },
      host: "127.0.0.1",
      port: 4370,
      cacheDatabasePath: "/state/run-proxy-cache.sqlite",
    });
  });

  test("parses a multi-peer router without local Realm storage", () => {
    expect(
      parsePersonalNodeCommand(["proxy-router", "/config/peers.json"], {
        LLAME_NODE_TOKEN: "phone-facing-secret",
        LLAME_PROXY_ROUTES_DB: "/state/run-routes.sqlite",
        LLAME_PROXY_CACHE_DB: "/state/run-proxy-cache.sqlite",
      }),
    ).toEqual({
      kind: "proxy-router",
      localBearerToken: "phone-facing-secret",
      peerManifestPath: "/config/peers.json",
      routesDatabasePath: "/state/run-routes.sqlite",
      cacheDatabasePath: "/state/run-proxy-cache.sqlite",
      host: "127.0.0.1",
      port: 4370,
    });
  });

  test("keeps local Run writer identity separate from node identity", () => {
    expect(
      parsePersonalNodeCommand(["run-create", "run-1", "node-workstation"], {
        ...baseEnvironment,
        LLAME_WRITER_STREAM_ID: "controller-writer",
        LLAME_WRITER_EPOCHS: '{"desktop":1,"controller-writer":1}',
        LLAME_WRITER_PRIVATE_KEY: "/keys/controller-private.pem",
        LLAME_TRUSTED_WRITER_KEYS:
          '{"controller-writer:1":"/keys/controller-public.pem"}',
        LLAME_RUN_CONTROL_WRITER_GRANTS:
          '{"controller-writer":{"scopes":["run.control"]}}',
      }),
    ).toMatchObject({
      kind: "run-create",
      writerStreamId: "controller-writer",
      privateKeyPath: "/keys/controller-private.pem",
      runId: "run-1",
      executorNodeId: "node-workstation",
      node: { nodeId: "desktop" },
    });
  });

  test("parses local signed Run steering without accepting an implicit writer", () => {
    const environment = {
      ...baseEnvironment,
      LLAME_WRITER_STREAM_ID: "controller-writer",
      LLAME_WRITER_EPOCHS: '{"desktop":1,"controller-writer":1}',
      LLAME_WRITER_PRIVATE_KEY: "/keys/controller-private.pem",
    };
    expect(
      parsePersonalNodeCommand(
        ["run-steer", "run-1", "Continue", "from", "the", "cursor"],
        environment,
      ),
    ).toMatchObject({
      kind: "run-steer",
      writerStreamId: "controller-writer",
      runId: "run-1",
      text: "Continue from the cursor",
    });
    expect(() =>
      parsePersonalNodeCommand(["run-steer", "run-1", "Continue"], {
        ...baseEnvironment,
        LLAME_WRITER_PRIVATE_KEY: "/keys/controller-private.pem",
      }),
    ).toThrowError("LLAME_WRITER_STREAM_ID is required");
  });

  test("defaults serve to a loopback-only listener and this node's writer", () => {
    expect(parsePersonalNodeCommand(["serve"], baseEnvironment)).toEqual({
      kind: "serve",
      node: {
        databasePath: "/tmp/llame-personal-node.sqlite",
        nodeId: "desktop",
        realmId: "realm-personal",
        bearerToken: "local-node-secret",
        writerEpochs: { desktop: 1 },
      },
      host: "127.0.0.1",
      port: 4370,
    });
  });

  test("configures continuous signed reconciliation without exposing owner credentials", () => {
    expect(
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_SYNC_PEER_ID: "home",
        LLAME_SYNC_PEER_URL: "https://personal.example.test",
        LLAME_PEER_CREDENTIAL_PATH: "/keys/home.credential",
        LLAME_SYNC_INTERVAL_MS: "3000",
        LLAME_TRUSTED_WRITER_KEYS: '{"desktop:1":"/keys/desktop.pem"}',
      }),
    ).toMatchObject({
      kind: "serve",
      peerSync: {
        peerId: "home",
        peerUrl: "https://personal.example.test",
        peerCredential: { kind: "file", path: "/keys/home.credential" },
        intervalMilliseconds: 3000,
      },
    });
  });

  test("configures multiple continuous peers through one explicit manifest", () => {
    expect(
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_SYNC_PEER_MANIFEST: "/etc/llame/sync-peers.json",
        LLAME_SYNC_INTERVAL_MS: "3000",
        LLAME_TRUSTED_WRITER_KEYS: '{"desktop:1":"/keys/desktop.pem"}',
      }),
    ).toMatchObject({
      kind: "serve",
      peerSyncManifest: {
        path: "/etc/llame/sync-peers.json",
        intervalMilliseconds: 3000,
      },
    });
    expect(() =>
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_SYNC_PEER_MANIFEST: "/etc/llame/sync-peers.json",
        LLAME_SYNC_PEER_ID: "home",
        LLAME_SYNC_PEER_URL: "https://personal.example.test",
        LLAME_PEER_TOKEN: "remote-peer-secret",
        LLAME_TRUSTED_WRITER_KEYS: '{"desktop:1":"/keys/desktop.pem"}',
      }),
    ).toThrowError(
      "continuous sync accepts either one peer or a peer manifest",
    );
  });

  test("loads only an explicitly configured Workspace manifest", () => {
    expect(
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_WORKSPACE_MANIFEST: "/etc/llame/workspaces.json",
      }),
    ).toMatchObject({
      kind: "serve",
      workspaceManifestPath: "/etc/llame/workspaces.json",
    });
  });

  test("enables executor-local Git worktrees only with an explicit root", () => {
    expect(
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_GIT_WORKTREE_ROOT: "/var/lib/llame/worktrees",
        LLAME_WORKSPACE_MANIFEST: "/etc/llame/workspaces.json",
      }),
    ).toMatchObject({
      kind: "serve",
      gitWorktreeRoot: "/var/lib/llame/worktrees",
    });
    expect(() =>
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_GIT_WORKTREE_ROOT: "relative/worktrees",
      }),
    ).toThrowError("LLAME_GIT_WORKTREE_ROOT must be absolute");
    expect(() =>
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_GIT_WORKTREE_ROOT: "/var/lib/llame/worktrees",
      }),
    ).toThrowError("Git worktrees require a registered Workspace");
  });

  test("advertises only the CLI current directory in serve-here mode", () => {
    expect(
      parsePersonalNodeCommand(["serve-here"], baseEnvironment, "/work/llame"),
    ).toMatchObject({
      kind: "serve",
      workspaceDefinitions: [
        {
          id: "current-directory",
          label: "llame",
          rootPath: "/work/llame",
          entryPolicy: "auto-approve",
          recoveryPolicy: "ask",
        },
      ],
    });
  });

  test("refuses a directly reachable listener in favor of a secure tunnel", () => {
    expect(() =>
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_NODE_HOST: "0.0.0.0",
      }),
    ).toThrowError(
      "personal Node must bind loopback; expose it through a secure tunnel",
    );
  });

  test("parses peer sync without treating the peer as the local owner", () => {
    expect(
      parsePersonalNodeCommand(["sync", "https://personal.example.test"], {
        ...baseEnvironment,
        LLAME_PEER_TOKEN: "remote-peer-secret",
        LLAME_WRITER_EPOCHS: '{"desktop":1,"phone":2}',
      }),
    ).toEqual({
      kind: "sync",
      node: {
        databasePath: "/tmp/llame-personal-node.sqlite",
        nodeId: "desktop",
        realmId: "realm-personal",
        bearerToken: "local-node-secret",
        writerEpochs: { desktop: 1, phone: 2 },
      },
      peerUrl: "https://personal.example.test",
      peerCredential: {
        kind: "environment",
        value: "remote-peer-secret",
      },
    });
  });

  test("uses a persisted enrolled credential for later synchronization", () => {
    expect(
      parsePersonalNodeCommand(["sync", "https://personal.example.test"], {
        ...baseEnvironment,
        LLAME_PEER_CREDENTIAL_PATH: "/keys/personal-node.credential",
      }),
    ).toMatchObject({
      kind: "sync",
      peerCredential: {
        kind: "file",
        path: "/keys/personal-node.credential",
      },
    });
  });

  test("parses fail-closed writer grants for reconciled Run operations", () => {
    expect(
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_RUN_CONTROL_WRITER_GRANTS: JSON.stringify({
          desktop: {
            scopes: ["run.control", "run.execute"],
            executorNodeIds: ["node-desktop"],
          },
        }),
      }),
    ).toMatchObject({
      node: {
        runControlGrants: {
          desktop: {
            scopes: ["run.control", "run.execute"],
            executorNodeIds: ["node-desktop"],
          },
        },
      },
    });
  });

  test("enables journal-backed Run API only with a complete local writer", () => {
    expect(
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_RUN_CONTROL_MODE: "journal",
        LLAME_WRITER_STREAM_ID: "controller",
        LLAME_WRITER_EPOCHS: '{"desktop":1,"controller":1}',
        LLAME_WRITER_PRIVATE_KEY: "/keys/controller-private.pem",
        LLAME_TRUSTED_WRITER_KEYS:
          '{"controller:1":"/keys/controller-public.pem"}',
        LLAME_RUN_CONTROL_WRITER_GRANTS:
          '{"controller":{"scopes":["run.control","run.steer"]}}',
      }),
    ).toMatchObject({
      node: {
        journalRunWriter: {
          writerStreamId: "controller",
          privateKeyPath: "/keys/controller-private.pem",
        },
      },
    });
    expect(() =>
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_RUN_CONTROL_MODE: "journal",
        LLAME_WRITER_STREAM_ID: "controller",
        LLAME_WRITER_PRIVATE_KEY: "/keys/controller-private.pem",
      }),
    ).toThrowError(
      "journal Run writer requires its epoch, trusted key, and operation grant",
    );

    expect(
      parsePersonalNodeCommand(["serve"], {
        ...baseEnvironment,
        LLAME_RUN_CONTROL_MODE: "journal-read-only",
      }),
    ).toMatchObject({
      node: { journalRunMode: "read-only" },
    });
  });

  test("parses enrollment with a separate node identity", () => {
    expect(
      parsePersonalNodeCommand(["enroll", "https://personal.example.test"], {
        ...baseEnvironment,
        LLAME_NODE_PRIVATE_KEY: "/keys/node-private.pem",
        LLAME_PEER_TOKEN: "remote-owner-secret",
        LLAME_PEER_CREDENTIAL_PATH: "/keys/personal-node.credential",
        LLAME_NODE_SCOPES: '["run.observe","run.steer"]',
      }),
    ).toMatchObject({
      kind: "enroll",
      peerUrl: "https://personal.example.test",
      ownerBearerToken: "remote-owner-secret",
      privateKeyPath: "/keys/node-private.pem",
      credentialPath: "/keys/personal-node.credential",
      scopes: ["run.observe", "run.steer"],
    });
  });

  test("requires explicit trusted writer keys for signed peer sync", () => {
    expect(
      parsePersonalNodeCommand(["sync", "https://personal.example.test"], {
        ...baseEnvironment,
        LLAME_PEER_TOKEN: "remote-peer-secret",
        LLAME_SYNC_MODE: "signed",
        LLAME_TRUSTED_WRITER_KEYS: '{"desktop:1":"/keys/desktop-public.pem"}',
      }),
    ).toEqual({
      kind: "sync",
      node: {
        databasePath: "/tmp/llame-personal-node.sqlite",
        nodeId: "desktop",
        realmId: "realm-personal",
        bearerToken: "local-node-secret",
        writerEpochs: { desktop: 1 },
        trustedWriterKeyPaths: {
          "desktop:1": "/keys/desktop-public.pem",
        },
      },
      peerUrl: "https://personal.example.test",
      peerCredential: {
        kind: "environment",
        value: "remote-peer-secret",
      },
      mode: "signed",
    });

    expect(() =>
      parsePersonalNodeCommand(["sync", "https://personal.example.test"], {
        ...baseEnvironment,
        LLAME_PEER_TOKEN: "remote-peer-secret",
        LLAME_SYNC_MODE: "signed",
      }),
    ).toThrowError("signed sync requires LLAME_TRUSTED_WRITER_KEYS");
  });

  test("parses an offline append with an explicit parent", () => {
    expect(
      parsePersonalNodeCommand(
        ["append", "chat-1", "message-parent", "Continue offline"],
        baseEnvironment,
      ),
    ).toMatchObject({
      kind: "append",
      chatId: "chat-1",
      parentMessageId: "message-parent",
      text: "Continue offline",
    });
  });

  test("enables signed offline append only with the local private and trusted public keys", () => {
    expect(
      parsePersonalNodeCommand(["append", "chat-1", "-", "Signed offline"], {
        ...baseEnvironment,
        LLAME_TRUSTED_WRITER_KEYS: '{"desktop:1":"/keys/desktop-public.pem"}',
        LLAME_WRITER_PRIVATE_KEY: "/keys/desktop-private.pem",
      }),
    ).toMatchObject({
      kind: "append",
      privateKeyPath: "/keys/desktop-private.pem",
    });

    expect(() =>
      parsePersonalNodeCommand(["append", "chat-1", "-", "Signed offline"], {
        ...baseEnvironment,
        LLAME_WRITER_PRIVATE_KEY: "/keys/desktop-private.pem",
      }),
    ).toThrowError("signed append requires LLAME_TRUSTED_WRITER_KEYS");
  });
});
