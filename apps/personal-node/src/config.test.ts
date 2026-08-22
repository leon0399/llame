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
