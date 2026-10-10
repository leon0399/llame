import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  adoptServerHistory,
  isInstructionsPart,
  isPromptImportsPart,
  messageRenderKey,
  mergeTrustedModelContextParts,
  messageSeqFromMetadata,
  modelSwitchPart,
  normalizeChatMessagesResponse,
  runIdFromMessageMetadata,
  toChatUiMessages,
} from "./history";
import type { ChatMessageResponse as WireChatMessage } from "../../api/generated/models";

describe("normalizeChatMessagesResponse", () => {
  const wireRow = (
    id: string,
    seq: number,
    overrides: Partial<WireChatMessage> = {},
  ): WireChatMessage => ({
    id,
    chatId: "chat-1",
    seq,
    role: "user",
    senderUserId: null,
    parts: [],
    attachments: [],
    usage: null,
    inReplyTo: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });
  const checkpointRow = (
    seq: number,
    absorbedThroughSeq: number,
    overrides: Partial<WireChatMessage> = {},
  ) =>
    wireRow(`checkpoint-${absorbedThroughSeq}`, seq, {
      role: "checkpoint",
      absorbedThroughSeq,
      absorbedMessageCount: 2,
      summary: `through ${absorbedThroughSeq}`,
      stats: { beforeTokens: 10, afterTokens: 5, modelId: "m1" },
      ...overrides,
    });

  it("takes the newest checkpoint row on the page as the transcript boundary", () => {
    const response = normalizeChatMessagesResponse({
      messages: [
        wireRow("user-1", 1),
        checkpointRow(3, 2),
        wireRow("user-2", 4),
        checkpointRow(6, 5),
      ],
    });

    expect(response.compaction).toMatchObject({
      absorbedThroughSeq: 5,
      absorbedMessageCount: 2,
      summary: "through 5",
    });
    expect(response.messages.map(({ id }) => id)).toEqual([
      "user-1",
      "checkpoint-2",
      "user-2",
      "checkpoint-5",
    ]);
  });

  it.each([
    "absorbedThroughSeq",
    "absorbedMessageCount",
    "summary",
    "stats",
  ] as const)(
    "skips a newer checkpoint row missing %s and falls back to the earlier complete one",
    (field) => {
      const incomplete = checkpointRow(6, 5, { [field]: undefined });

      expect(
        normalizeChatMessagesResponse({
          messages: [checkpointRow(3, 2), incomplete],
        }).compaction,
      ).toMatchObject({ absorbedThroughSeq: 2 });
    },
  );

  it("reports no transcript boundary for a page without a checkpoint row", () => {
    expect(
      normalizeChatMessagesResponse({ messages: [wireRow("user-1", 1)] })
        .compaction,
    ).toBeNull();
  });
});

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
  it("drops checkpoint rows instead of rendering their rail text as messages", () => {
    expect(
      toChatUiMessages({
        messages: [
          {
            id: "checkpoint-message",
            chatId: "chat-1",
            seq: 3,
            role: "checkpoint",
            senderUserId: null,
            parts: [
              {
                type: "data-context",
                data: {
                  producer: "compaction",
                  form: "checkpoint",
                  text: "private summary",
                  payload: { v: 1, summary: "private summary" },
                },
              },
            ],
            attachments: [],
            usage: null,
            inReplyTo: null,
            createdAt: "2026-07-01T12:00:02.000Z",
            absorbedThroughSeq: 2,
            absorbedMessageCount: 2,
            summary: "private summary",
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

const instructionsItem = {
  type: "data-context" as const,
  data: {
    v: 1 as const,
    producer: "instructions" as const,
    form: "notice" as const,
    runId: "a5dc235e-1de8-4aad-84d8-e0e247b6a135",
    payload: {
      files: [
        {
          path: "/home/u/repo/apps/api/AGENTS.md",
          canonicalPath: "/home/u/repo/AGENTS.md",
          truncated: true,
        },
      ],
      denied: ["/srv/AGENTS.md"],
    },
    text: '<system-reminder producer="instructions" form="notice">loaded</system-reminder>',
  },
};

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

  it("overlays the server-fetched instructions item onto its user turn", () => {
    // The accepted-turn load stages its item on the triggering USER message
    // (design D5), a turn the rail may also have marked with a model switch —
    // both control parts are owner-visible and must survive the merge in the
    // order the server stored them.
    const messages = mergeTrustedModelContextParts(
      [
        {
          id: "user-1",
          role: "user",
          // SAFETY: this fixture deliberately doesn't match the SDK's
          // `UIMessage["parts"]` union — it exercises an untrusted/forged
          // context-item shape the merge must strip, so `as never` opts
          // this one value out of the part-shape check.
          parts: [
            {
              type: "data-context",
              data: { producer: "instructions", forged: true },
            } as never,
            { type: "text", text: "Continue" },
          ],
        },
      ],
      [
        {
          id: "user-1",
          role: "user",
          // SAFETY: `switchPart`/`instructionsItem` are this app's own
          // narrower `data-context` shapes — the same mismatch the merge
          // itself casts around.
          parts: [
            switchPart as never,
            instructionsItem as never,
            { type: "text", text: "Continue" },
          ],
        },
      ],
    );

    expect(messages[0]?.parts).toEqual([
      switchPart,
      instructionsItem,
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

describe("instructions context items", () => {
  /** The same item with one nested value replaced, so each rejection below
   *  differs from a valid part in exactly one way. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- test fixture: each case deliberately hands the parser a malformed payload it must reject, so there is no valid domain type to accept here.
  const withPayload = (payload: unknown) => ({
    ...instructionsItem,
    data: { ...instructionsItem.data, payload },
  });

  /** The read call of the step that loaded the files — an in-Run item is
   *  stored directly after the last tool part of that step. */
  const toolPart = {
    type: "dynamic-tool" as const,
    toolCallId: "call-read-instructions",
    toolName: "read",
    state: "output-available" as const,
    input: { path: "apps/api/src/x.ts" },
    output: { status: "success" },
  };

  it("accepts an importedBy link on a file entry", () => {
    expect(
      isInstructionsPart(
        withPayload({
          ...instructionsItem.data.payload,
          files: [
            {
              ...instructionsItem.data.payload.files[0],
              importedBy: "/home/u/repo/AGENTS.md",
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("parses only the exact persisted instructions shape", () => {
    expect(isInstructionsPart(instructionsItem)).toBe(true);
    expect(isInstructionsPart({ type: "text", text: "hello" })).toBe(false);
    expect(isInstructionsPart(null)).toBe(false);
  });

  it("keeps metadata-only historical items owner-visible", () => {
    const { v, producer, form, runId, payload } = instructionsItem.data;
    const metadataOnly = {
      ...instructionsItem,
      data: { v, producer, form, runId, payload },
    };

    expect(isInstructionsPart(metadataOnly)).toBe(true);
    expect(
      isInstructionsPart({
        ...instructionsItem,
        data: { ...instructionsItem.data, text: 42 },
      }),
    ).toBe(false);
  });

  it("rejects an extra key at every level rather than rendering an unknown shape", () => {
    expect(isInstructionsPart({ ...instructionsItem, extra: "leak" })).toBe(
      false,
    );
    expect(
      isInstructionsPart({
        ...instructionsItem,
        data: { ...instructionsItem.data, extra: "leak" },
      }),
    ).toBe(false);
    expect(
      isInstructionsPart(
        withPayload({ ...instructionsItem.data.payload, extra: "leak" }),
      ),
    ).toBe(false);
    expect(
      isInstructionsPart(
        withPayload({
          ...instructionsItem.data.payload,
          files: [
            {
              ...instructionsItem.data.payload.files[0],
              importedBy: "/home/u/repo/AGENTS.md",
              extra: "leak",
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      isInstructionsPart(
        withPayload({
          ...instructionsItem.data.payload,
          files: [{ ...instructionsItem.data.payload.files[0], extra: "leak" }],
        }),
      ),
    ).toBe(false);
  });

  it("rejects an empty importedBy value", () => {
    expect(
      isInstructionsPart(
        withPayload({
          ...instructionsItem.data.payload,
          files: [
            {
              ...instructionsItem.data.payload.files[0],
              importedBy: "   ",
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("rejects every other producer's data-context item", () => {
    expect(
      isInstructionsPart({
        ...instructionsItem,
        data: { ...instructionsItem.data, producer: "temporal" },
      }),
    ).toBe(false);
  });

  it("rejects payloads whose paths or flags are not trustworthy", () => {
    // Non-empty files is the api's own invariant (an item exists only for a
    // bundle that loaded something), and a malformed entry must not reach
    // the chip as if it were disclosure.
    expect(isInstructionsPart(withPayload({ files: [], denied: [] }))).toBe(
      false,
    );
    expect(
      isInstructionsPart(
        withPayload({
          files: [{ path: "/srv/AGENTS.md", truncated: false }],
          denied: [],
        }),
      ),
    ).toBe(false);
    expect(
      isInstructionsPart(
        withPayload({
          files: [
            {
              path: "/srv/AGENTS.md",
              canonicalPath: "/srv/AGENTS.md",
              truncated: "yes",
            },
          ],
          denied: [],
        }),
      ),
    ).toBe(false);
    expect(
      isInstructionsPart(
        withPayload({
          files: [
            {
              path: "   ",
              canonicalPath: "/srv/AGENTS.md",
              truncated: false,
            },
          ],
          denied: [],
        }),
      ),
    ).toBe(false);
    expect(
      isInstructionsPart(
        withPayload({
          files: [
            {
              path: "/srv/AGENTS.md",
              canonicalPath: "/srv/AGENTS.md",
              truncated: false,
            },
          ],
          denied: [""],
        }),
      ),
    ).toBe(false);
  });

  it("overlays the server-fetched item at the position the store kept it", () => {
    // The transcript always renders through the merge, so the item must
    // survive it: the live copy is replaced by the one the server vouches
    // for. An in-Run load stored its item AFTER the step's last tool part —
    // where the model actually received it — so the chip must render there
    // too, not at the top of the turn.
    const messages = mergeTrustedModelContextParts(
      [
        {
          id: "assistant-1",
          role: "assistant",
          // SAFETY: a forged/live-streamed context part is deliberately not
          // `UIMessage["parts"]`-shaped — it exercises what the merge must
          // strip, so `as never` opts this one value out of the part check.
          parts: [
            {
              type: "data-context",
              data: { producer: "instructions", forged: true },
            } as never,
            { type: "text", text: "Answer." },
            toolPart,
          ],
        },
      ],
      [
        {
          id: "assistant-1",
          role: "assistant",
          // SAFETY: `instructionsItem` is `InstructionsPart`, a narrower shape
          // than the SDK's generic `data-*` part — the same mismatch the
          // merge itself casts around.
          parts: [
            { type: "text", text: "Answer." },
            toolPart,
            instructionsItem as never,
          ],
        },
      ],
    );

    expect(messages[0]?.parts).toEqual([
      { type: "text", text: "Answer." },
      toolPart,
      instructionsItem,
    ]);
  });

  it("places each in-Run item between the parts the store put it between", () => {
    // Two loads on one turn, at two different positions: the first after the
    // opening text, the second at the end. A context item from a producer
    // this app drops occupies no index either — it is invisible in the merged
    // parts, so it must not push the first item one slot to the right.
    const secondItem = {
      ...instructionsItem,
      data: {
        ...instructionsItem.data,
        runId: "b7ea1c02-9f2d-4b7e-9b0e-1d2f3a4b5c6d",
      },
    };
    const messages = mergeTrustedModelContextParts(
      [
        {
          id: "assistant-1",
          role: "assistant",
          parts: [
            { type: "text", text: "Reading." },
            toolPart,
            { type: "text", text: "Applying." },
          ],
        },
      ],
      [
        {
          id: "assistant-1",
          role: "assistant",
          // SAFETY: as above — the app's own narrower `data-context` shapes.
          parts: [
            { type: "text", text: "Reading." },
            {
              type: "data-context",
              data: { producer: "digest", v: 1 },
            } as never,
            instructionsItem as never,
            toolPart,
            { type: "text", text: "Applying." },
            secondItem as never,
          ],
        },
      ],
    );

    expect(messages[0]?.parts).toEqual([
      { type: "text", text: "Reading." },
      instructionsItem,
      toolPart,
      { type: "text", text: "Applying." },
      secondItem,
    ]);
  });

  it("strips a live instructions copy no server message vouches for", () => {
    const [message] = mergeTrustedModelContextParts(
      [
        {
          id: "assistant-1",
          role: "assistant",
          // SAFETY: `instructionsItem` is `InstructionsPart`, narrower than
          // the SDK's generic `data-*` part shape the merge casts around.
          parts: [instructionsItem as never, { type: "text", text: "Answer." }],
        },
      ],
      [],
    );

    expect(message?.parts).toEqual([{ type: "text", text: "Answer." }]);
  });
});

describe("prompt-imports context items", () => {
  const promptImportsItem = {
    type: "data-context" as const,
    data: {
      v: 1 as const,
      producer: "prompt-imports" as const,
      form: "notice" as const,
      runId: "a5dc235e-1de8-4aad-84d8-e0e247b6a135",
      payload: {
        imports: [
          {
            locator: "docs/GUIDE.md",
            resolved: "/home/u/repo/docs/GUIDE.md",
            outcome: "imported" as const,
          },
          {
            locator: "~/long.md",
            outcome: "imported" as const,
            truncated: true,
          },
          { locator: "/srv/secret.md", outcome: "denied" as const },
          { locator: "missing.md", outcome: "failed" as const },
        ],
        omitted: ["extra.md"],
      },
    },
  };

  /** The same item with one nested value replaced, so each rejection below
   *  differs from a valid part in exactly one way. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- test fixture: each case deliberately hands the parser a malformed payload it must reject, so there is no valid domain type to accept here.
  const withPayload = (payload: unknown) => ({
    ...promptImportsItem,
    data: { ...promptImportsItem.data, payload },
  });

  it("accepts every outcome, the optional fields, and an omitted list", () => {
    expect(isPromptImportsPart(promptImportsItem)).toBe(true);
    expect(
      isPromptImportsPart(
        withPayload({ imports: [{ locator: "a.md", outcome: "imported" }] }),
      ),
    ).toBe(true);
    expect(
      isPromptImportsPart({
        ...promptImportsItem,
        data: { ...promptImportsItem.data, text: "imported 1 file" },
      }),
    ).toBe(true);
  });

  it("accepts an imported image entry carrying its media locator beside every other outcome", () => {
    const image = {
      locator: "shot.png",
      resolved: "/home/u/repo/shot.png",
      outcome: "imported" as const,
      media: "media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f",
    };
    const item = withPayload({
      imports: [image, ...promptImportsItem.data.payload.imports],
      omitted: ["extra.md"],
    });

    expect(isPromptImportsPart(item)).toBe(true);
    if (!isPromptImportsPart(item)) return;
    expect(item.data.payload.imports.map((entry) => entry.outcome)).toEqual([
      "imported",
      "imported",
      "imported",
      "denied",
      "failed",
    ]);
  });

  it("accepts empty imports only beside a non-empty omitted list", () => {
    expect(
      isPromptImportsPart(withPayload({ imports: [], omitted: ["a.md"] })),
    ).toBe(true);
    expect(isPromptImportsPart(withPayload({ imports: [] }))).toBe(false);
    expect(isPromptImportsPart(withPayload({ imports: [], omitted: [] }))).toBe(
      false,
    );
  });

  it("rejects an unknown outcome or an untrustworthy field", () => {
    const entry = { locator: "a.md", outcome: "imported" };
    for (const bad of [
      { ...entry, outcome: "skipped" },
      { ...entry, locator: "  " },
      { ...entry, resolved: "" },
      { ...entry, truncated: "yes" },
      { ...entry, media: "media://not-a-uuid" },
      { ...entry, media: "MEDIA://0190F5E2-7C1A-7B3E-9D4F-2A6B8C0D1E2F" },
      {
        ...entry,
        outcome: "failed",
        media: "media://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f",
      },
    ]) {
      expect(isPromptImportsPart(withPayload({ imports: [bad] }))).toBe(false);
    }
    expect(
      isPromptImportsPart(withPayload({ imports: [entry], omitted: [""] })),
    ).toBe(false);
  });

  it("rejects an extra key in payload or entries rather than rendering an unknown shape", () => {
    const entry = { locator: "a.md", outcome: "imported" };
    expect(
      isPromptImportsPart(withPayload({ imports: [entry], extra: "leak" })),
    ).toBe(false);
    expect(
      isPromptImportsPart(
        withPayload({ imports: [{ ...entry, extra: "leak" }] }),
      ),
    ).toBe(false);
  });

  it("rejects every other producer's data-context item", () => {
    expect(
      isPromptImportsPart({
        ...promptImportsItem,
        data: { ...promptImportsItem.data, producer: "instructions" },
      }),
    ).toBe(false);
    expect(isPromptImportsPart(null)).toBe(false);
  });

  it("overlays the server-fetched item on a user turn and drops it from an assistant one", () => {
    const live = (id: string, role: "user" | "assistant"): UIMessage => ({
      id,
      role,
      parts: [{ type: "text", text: "Read @docs/GUIDE.md" }],
    });
    const stored = (id: string, role: "user" | "assistant"): UIMessage => ({
      id,
      role,
      // SAFETY: `promptImportsItem` is `PromptImportsPart`, narrower than the
      // SDK's generic `data-*` part — the same mismatch the merge casts
      // around.
      parts: [promptImportsItem as never, ...live(id, role).parts],
    });

    const messages = mergeTrustedModelContextParts(
      [live("user-1", "user"), live("assistant-1", "assistant")],
      [stored("user-1", "user"), stored("assistant-1", "assistant")],
    );

    expect(messages[0]?.parts).toEqual(stored("user-1", "user").parts);
    expect(messages[1]?.parts).toEqual(live("assistant-1", "assistant").parts);
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
