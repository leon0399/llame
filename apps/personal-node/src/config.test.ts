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
      peerBearerToken: "remote-peer-secret",
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
      peerBearerToken: "remote-peer-secret",
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
