import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import type {
  ChatDeliveryResponse,
  ChatLatestRunResponse,
} from "../../api/generated/models";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";
import {
  changeDeliveryMode,
  deliveryFiles,
  deliveryText,
  firstPendingSteer,
  isAlreadyDelivered,
  isRunActive,
  sendDelivery,
  withdrawDelivery,
} from "./deliveries";

const CHAT_ID = "a5dc235e-1de8-4aad-84d8-e0e247b6a135";

function item(
  id: string,
  mode: ChatDeliveryResponse["mode"],
  parts: ChatDeliveryResponse["parts"] = [{ type: "text", text: id }],
): ChatDeliveryResponse {
  return {
    id,
    chatId: CHAT_ID,
    producer: "owner",
    mode,
    state: "pending",
    parts,
    modelId: "system:openai:model-one",
    permissionMode: "default",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function run(status: ChatLatestRunResponse["status"]): ChatLatestRunResponse {
  return {
    id: "run-1",
    messageId: "m1",
    status,
    followUpAction: null,
    modelId: "system:openai:model-one",
    effort: null,
    permissionMode: "default",
    error: null,
  };
}

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const REQUEST = {
  chatId: CHAT_ID,
  delivery: "steer" as const,
  message: { id: "m2", parts: [{ type: "text" as const, text: "also" }] },
  modelId: "system:openai:model-one",
  effort: "high",
  permissionMode: "default" as const,
};

describe("sendDelivery", () => {
  it("sends the message with its mode and reports the pending item of a 202", async () => {
    const pending = item("m2", "steer");
    fetchMock.mockResolvedValue(jsonResponse(pending, 202));

    await expect(sendDelivery(REQUEST)).resolves.toEqual({
      kind: "pending",
      item: pending,
    });

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe(
      `/api/v1/chats/${CHAT_ID}/messages`,
    );
    await expect(request.json()).resolves.toEqual({
      modelId: "system:openai:model-one",
      effort: "high",
      message: { id: "m2", parts: [{ type: "text", text: "also" }] },
      delivery: "steer",
    });
  });

  it("releases the stream of a send that started a Run", async () => {
    const cancelled = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream({ cancel: cancelled }), { status: 200 }),
    );

    await expect(sendDelivery(REQUEST)).resolves.toEqual({ kind: "started" });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("rejects a send the API refused", async () => {
    fetchMock.mockResolvedValue(
      new Response("model unavailable", { status: 422 }),
    );

    await expect(sendDelivery(REQUEST)).rejects.toThrow("model unavailable");
  });
});

describe("the actions on a pending item", () => {
  it("withdraws with DELETE and reads the parts back", async () => {
    const withdrawn = { ...item("m2", "queue"), state: "withdrawn" as const };
    fetchMock.mockResolvedValue(jsonResponse(withdrawn));

    await expect(withdrawDelivery(CHAT_ID, "m2")).resolves.toEqual(withdrawn);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe(
      `/api/v1/chats/${CHAT_ID}/deliveries/m2`,
    );
  });

  it("changes the mode with PATCH", async () => {
    fetchMock.mockResolvedValue(jsonResponse(item("m2", "interrupt")));

    await changeDeliveryMode(CHAT_ID, "m2", "interrupt");

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    await expect(request.json()).resolves.toEqual({ mode: "interrupt" });
  });

  it("reads a 409 as already delivered", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ statusCode: 409 }, 409));

    await expect(changeDeliveryMode(CHAT_ID, "m2", "steer")).rejects.toSatisfy(
      isAlreadyDelivered,
    );
    expect(isAlreadyDelivered(new Error("network"))).toBe(false);
  });
});

describe("isRunActive", () => {
  it("is true while a stream is in flight", () => {
    expect(isRunActive({ status: "streaming", latestRun: null })).toBe(true);
    expect(
      isRunActive({ status: "submitted", latestRun: run("completed") }),
    ).toBe(true);
  });

  it("is true between two segments, when only the newest Run says so", () => {
    expect(
      isRunActive({ status: "ready", latestRun: run("running_model") }),
    ).toBe(true);
  });

  it("is false once the newest Run ended, or when there is none", () => {
    for (const status of [
      "completed",
      "failed",
      "cancelled",
      "expired",
    ] as const) {
      expect(isRunActive({ status: "ready", latestRun: run(status) })).toBe(
        false,
      );
    }

    expect(isRunActive({ status: "ready", latestRun: null })).toBe(false);
  });
});

describe("firstPendingSteer", () => {
  it("skips queue and interrupt items", () => {
    const items = [
      item("a", "queue"),
      item("b", "interrupt"),
      item("c", "steer"),
    ];

    expect(firstPendingSteer(items)?.id).toBe("c");
    expect(firstPendingSteer(items.slice(0, 2))).toBeUndefined();
  });
});

describe("what an item carries", () => {
  it("joins its text parts and lists its files in order", () => {
    const withFile = item("a", "queue", [
      { type: "text", text: "look" },
      {
        type: "file",
        url: "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8b",
        mediaType: "image/png",
        filename: "shot.png",
      },
      { type: "text", text: "here" },
    ]);

    expect(deliveryText(withFile)).toBe("look\n\nhere");
    expect(deliveryFiles(withFile)).toEqual([
      {
        type: "file",
        url: "media://0192f4a8-7c1e-7d3a-9b2f-3c4d5e6f7a8b",
        mediaType: "image/png",
        filename: "shot.png",
      },
    ]);
  });
});
