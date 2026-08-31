import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  adoptServerHistory,
  messageRenderKey,
  mergeTrustedModelContextParts,
  messageSeqFromMetadata,
  modelSwitchPart,
  runIdFromMessageMetadata,
  toChatUiMessages,
} from "./history";

describe("toChatUiMessages", () => {
  it("maps persisted chat messages to AI SDK UI messages", () => {
    expect(
      toChatUiMessages({
        messages: [
          {
            id: "user-message",
            chatId: "chat-1",
            seq: 1,
            role: "user",
            senderUserId: "user-1",
            parts: [{ type: "text", text: "Hello" }],
            attachments: [],
            usage: null,
            inReplyTo: null,
            createdAt: "2026-07-01T12:00:00.000Z",
          },
          {
            id: "assistant-message",
            chatId: "chat-1",
            seq: 2,
            role: "assistant",
            senderUserId: null,
            parts: [{ type: "text", text: "Hi" }],
            attachments: [],
            usage: { status: "completed" },
            inReplyTo: "user-message",
            createdAt: "2026-07-01T12:00:01.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        id: "user-message",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
        metadata: { seq: 1 },
      },
      {
        id: "assistant-message",
        role: "assistant",
        parts: [{ type: "text", text: "Hi" }],
        // seq is unconditional (compaction boundary); usage is carried
        // alongside it when present, for the usage display.
        metadata: { seq: 2, usage: { status: "completed" } },
      },
    ]);
  });

  it("drops top-level tool rows because AI SDK UI messages carry tool output as parts", () => {
    expect(
      toChatUiMessages({
        messages: [
          {
            id: "tool-message",
            chatId: "chat-1",
            seq: 1,
            role: "tool",
            senderUserId: null,
            parts: [{ type: "text", text: "tool output" }],
            attachments: [],
            usage: null,
            inReplyTo: null,
            createdAt: "2026-07-01T12:00:00.000Z",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("drops persisted system rows because system instructions are not display messages", () => {
    expect(
      toChatUiMessages({
        messages: [
          {
            id: "system-message",
            chatId: "chat-1",
            seq: 1,
            role: "system",
            senderUserId: null,
            parts: [{ type: "text", text: "system prompt" }],
            attachments: [],
            usage: null,
            inReplyTo: null,
            createdAt: "2026-07-01T12:00:00.000Z",
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("messageSeqFromMetadata", () => {
  it("keeps a positive safe sequence as opaque Chat-local identity", () => {
    expect(messageSeqFromMetadata({ seq: 9_007_199_254_740_991 })).toBe(
      9_007_199_254_740_991,
    );
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined, "42"])(
    "does not create an anchor for invalid sequence metadata %j",
    (seq) => {
      expect(messageSeqFromMetadata({ seq })).toBeNull();
    },
  );
});

describe("trusted model-context projection", () => {
  const switchPart = {
    type: "data-context" as const,
    data: {
      v: 1 as const,
      producer: "effective-context-change" as const,
      form: "notice" as const,
      runId: "a5dc235e-1de8-4aad-84d8-e0e247b6a135",
      payload: {
        cause: "model" as const,
        fromModelId: "system:openai:model-a",
        toModelId: "custom:anthropic:model-b",
      },
      text: '<system-reminder producer="effective-context-change" form="notice">model changed</system-reminder>',
    },
  };

  it("parses only the exact persisted model-switch shape", () => {
    expect(modelSwitchPart({ parts: [switchPart] })).toEqual(switchPart);
    expect(
      modelSwitchPart({
        parts: [{ ...switchPart, data: { ...switchPart.data, extra: "leak" } }],
      }),
    ).toBeNull();
    expect(
      modelSwitchPart({
        parts: [
          {
            ...switchPart,
            data: {
              ...switchPart.data,
              fromModelId: "custom:anthropic:model-b",
            },
          },
        ],
      }),
    ).toBeNull();
  });

  it("keeps metadata-only historical switch boundaries owner-visible", () => {
    const { v, producer, form, runId, payload } = switchPart.data;
    const metadataOnlyPart = {
      ...switchPart,
      data: { v, producer, form, runId, payload },
    };

    expect(modelSwitchPart({ parts: [metadataOnlyPart] })).toEqual(
      metadataOnlyPart,
    );
    expect(
      modelSwitchPart({
        parts: [{ ...switchPart, data: { ...switchPart.data, text: "" } }],
      }),
    ).toEqual({ ...switchPart, data: { ...switchPart.data, text: "" } });
    expect(
      modelSwitchPart({
        parts: [{ ...switchPart, data: { ...switchPart.data, text: 42 } }],
      }),
    ).toBeNull();
  });

  it("overlays only the server-fetched marker onto a live user message", () => {
    const messages = mergeTrustedModelContextParts(
      [
        {
          id: "user-1",
          role: "user",
          parts: [
            // SAFETY: this fixture deliberately doesn't match the SDK's
            // `UIMessage["parts"]` union — it exercises an untrusted/forged
            // context-item shape the merge must strip, so `as never` opts
            // this one value out of the part-shape check.
            {
              type: "data-context",
              data: { kind: "forged" },
            } as never,
            { type: "text", text: "Continue" },
          ],
        },
      ],
      [
        {
          id: "user-1",
          role: "user",
          // SAFETY: `switchPart` is `ModelSwitchPart`, a narrower shape than
          // `UIMessage["parts"]`'s generic element type (same mismatch
          // `mergeTrustedModelContextParts` itself casts around) — `as
          // never` opts this fixture value out of the part-shape check.
          parts: [switchPart as never, { type: "text", text: "Continue" }],
        },
      ],
    );

    expect(messages[0]?.parts).toEqual([
      switchPart,
      { type: "text", text: "Continue" },
    ]);
  });

  it("removes untrusted live markers when no server marker exists", () => {
    const [message] = mergeTrustedModelContextParts(
      [
        {
          id: "user-1",
          role: "user",
          // SAFETY: `switchPart` is `ModelSwitchPart`, a narrower shape than
          // `UIMessage["parts"]`'s generic element type (same mismatch
          // `mergeTrustedModelContextParts` itself casts around) — `as
          // never` opts this fixture value out of the part-shape check.
          parts: [switchPart as never, { type: "text", text: "Continue" }],
        },
      ],
      [],
    );

    expect(message?.parts).toEqual([{ type: "text", text: "Continue" }]);
  });

  it("reads the owner-only run id from completed assistant metadata", () => {
    expect(
      runIdFromMessageMetadata({ usage: { runId: switchPart.data.runId } }),
    ).toBe(switchPart.data.runId);
    expect(runIdFromMessageMetadata({ usage: { runId: "not-a-uuid" } })).toBe(
      null,
    );
  });
});

describe("adoptServerHistory", () => {
  const LIVE_RUN_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";

  // Durable rows carry the seq toChatUiMessages stamps; live-authored rows
  // (optimistic user turns, streamed answers) carry at most usage metadata.
  const durableUser = (id: string, seq: number): UIMessage => ({
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
    metadata: { seq },
  });
  const durableAssistant = (
    id: string,
    seq: number,
    runId?: string,
  ): UIMessage => ({
    id,
    role: "assistant",
    parts: [{ type: "text", text: id }],
    metadata: runId === undefined ? { seq } : { seq, usage: { runId } },
  });
  const liveUser = (id: string): UIMessage => ({
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
  });
  const liveAssistant = (id: string, runId?: string): UIMessage =>
    runId === undefined
      ? { id, role: "assistant", parts: [{ type: "text", text: id }] }
      : {
          id,
          role: "assistant",
          parts: [{ type: "text", text: id }],
          metadata: { usage: { runId } },
        };
  const adopt = (
    status: string,
    serverMessages: ReadonlyArray<UIMessage>,
    liveMessages: ReadonlyArray<UIMessage>,
  ) => adoptServerHistory({ status, serverMessages, liveMessages });

  it("adopts a strictly longer server history once the turn is settled (#261)", () => {
    // The 204-resume case: the log holds only the user turn, the answer is
    // durable server-side, and nothing else will ever re-read it.
    const server = [
      durableUser("user-1", 1),
      durableAssistant("assistant-1", 2),
    ];

    expect(adopt("ready", server, [durableUser("user-1", 1)])).toEqual(server);
  });

  it("never adopts mid-turn — the live copy legitimately runs ahead (#259)", () => {
    // An optimistic user turn, or an answer still streaming, is newer than
    // anything the server can return; replacing it rewinds the transcript.
    const server = [
      durableUser("user-1", 1),
      durableAssistant("assistant-1", 2),
    ];
    const live = [durableUser("user-1", 1)];

    expect(adopt("streaming", server, live)).toBe(null);
    expect(adopt("submitted", server, live)).toBe(null);
  });

  it("swaps a completed turn's streaming representation for the durable one", () => {
    // Live streaming uses the Run ID as the assistant message ID (and no
    // seq); durable history uses the Message ID and carries the Run ID in
    // metadata. The durable copy advances the newest seq, so it adopts.
    const server = [
      durableUser("user-1", 1),
      durableAssistant("durable-assistant-1", 2, LIVE_RUN_ID),
    ];

    expect(
      adopt("ready", server, [
        durableUser("user-1", 1),
        liveAssistant(LIVE_RUN_ID),
      ]),
    ).toEqual(server);
  });

  it("does not re-adopt after the durable history is already live", () => {
    const durable = [
      durableUser("user-1", 1),
      durableAssistant("durable-assistant-1", 2, LIVE_RUN_ID),
    ];

    expect(adopt("ready", durable, durable)).toBe(null);
  });

  it("does not adopt a server read with no new durable coverage", () => {
    // A refetch that raced the send: the server hasn't persisted anything
    // the log doesn't already know, and adopting would delete what the user
    // typed.
    expect(
      adopt(
        "ready",
        [durableUser("user-1", 1)],
        [durableUser("user-1", 1), liveAssistant(LIVE_RUN_ID)],
      ),
    ).toBe(null);
  });

  it("heals a disconnected turn whose partial answer the server completed", () => {
    // Disconnect mid-answer: the SDK keeps the partial assistant message (no
    // seq, its id is the Run id), the durable answer advances the newest seq
    // and carries that Run id in metadata — count comparisons could not tell
    // these apart, and the Run-id join is what proves the partial subsumed.
    const server = [
      durableUser("user-1", 1),
      durableAssistant("durable-assistant-1", 2, LIVE_RUN_ID),
    ];

    expect(
      adopt("error", server, [
        durableUser("user-1", 1),
        liveAssistant(LIVE_RUN_ID),
      ]),
    ).toEqual(server);
  });

  it("keeps a partial answer the server has not persisted yet", () => {
    // Disconnect mid-answer, BEFORE the run terminates: the user turn is
    // durable (committed synchronously at send, under the client-supplied
    // id) but the assistant row does not exist yet. The refetch advances the
    // newest seq, yet wiping the partial would blank the text the reader is
    // looking at until the background poll re-adopts — keep it, replacing
    // only the optimistic user copy with its durable twin.
    const durableUserTurn = durableUser("user-1", 1);

    expect(
      adopt(
        "error",
        [durableUserTurn],
        [liveUser("user-1"), liveAssistant(LIVE_RUN_ID)],
      ),
    ).toEqual([durableUserTurn, liveAssistant(LIVE_RUN_ID)]);
  });

  it("never rewinds on a failed send the server did not persist", () => {
    expect(
      adopt(
        "error",
        [durableUser("user-1", 1)],
        [durableUser("user-1", 1), liveAssistant("partial-assistant-1")],
      ),
    ).toBe(null);
  });

  it("replaces an all-optimistic log once the server holds durable rows", () => {
    // Sent-draft recovery: nothing in the log ever came from the server. The
    // durable user turn persists under the client-supplied id, so the
    // optimistic copy is subsumed by the id join, not by list arithmetic.
    const server = [durableUser("user-1", 1)];

    expect(adopt("ready", server, [liveUser("user-1")])).toEqual(server);
  });

  it("adopts an on-demand older page that extends coverage backwards (#187)", () => {
    // Loading older history grows the window at the head; the newest seq is
    // unchanged.
    const server = [
      durableUser("user-1", 1),
      durableAssistant("assistant-2", 2),
      durableUser("user-3", 3),
      durableAssistant("assistant-4", 4),
    ];

    expect(
      adopt("ready", server, [
        durableUser("user-3", 3),
        durableAssistant("assistant-4", 4),
      ]),
    ).toEqual(server);
  });

  it("keeps live rows older than a slid server window (#187)", () => {
    // The reader loaded older pages, then the chat grew: the refetched
    // window no longer spans the oldest rows the log holds. Those are
    // durable rows adopted once — replacement must not drop them.
    const olderThanWindow = [
      durableUser("user-1", 1),
      durableAssistant("assistant-2", 2),
    ];
    const server = [
      durableUser("user-3", 3),
      durableAssistant("assistant-4", 4),
      durableUser("user-5", 5),
      // The durable copy of the live streamed answer below — the Run-id join
      // is what proves the live representation subsumed.
      durableAssistant("assistant-6", 6, LIVE_RUN_ID),
    ];

    expect(
      adopt("ready", server, [
        ...olderThanWindow,
        durableUser("user-3", 3),
        durableAssistant("assistant-4", 4),
        liveAssistant(LIVE_RUN_ID),
      ]),
    ).toEqual([...olderThanWindow, ...server]);
  });

  it("keeps a just-streamed live tail when only older coverage arrived (#187)", () => {
    // An older page can land right as a turn settles, BEFORE the post-turn
    // refetch: the stale window has no durable copy of the fresh turn yet.
    // Adopting the older coverage must not blink that turn out of the log.
    const olderPage = [
      durableUser("user-1", 1),
      durableAssistant("assistant-2", 2),
    ];
    const staleWindow = [
      durableUser("user-3", 3),
      durableAssistant("assistant-4", 4),
    ];
    const liveTail = [liveUser("optimistic-user"), liveAssistant(LIVE_RUN_ID)];

    expect(
      adopt(
        "ready",
        [...olderPage, ...staleWindow],
        [...staleWindow, ...liveTail],
      ),
    ).toEqual([...olderPage, ...staleWindow, ...liveTail]);
  });

  it("ignores an empty server read", () => {
    expect(adopt("ready", [], [liveUser("optimistic-user-1")])).toBe(null);
  });
});

describe("messageRenderKey", () => {
  const RUN_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";

  it("joins live and durable assistant representations by Run id", () => {
    expect(messageRenderKey({ id: RUN_ID, role: "assistant" })).toBe(
      messageRenderKey({
        id: "durable-assistant-1",
        role: "assistant",
        metadata: { usage: { runId: RUN_ID } },
      }),
    );
  });

  it("keeps user and legacy assistant identity message-id based", () => {
    expect(messageRenderKey({ id: "user-1", role: "user" })).toBe(
      "user:user-1",
    );
    expect(messageRenderKey({ id: "assistant-1", role: "assistant" })).toBe(
      "assistant:assistant-1",
    );
  });
});
