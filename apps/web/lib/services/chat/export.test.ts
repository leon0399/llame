// @vitest-environment jsdom

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { exportChatAsMarkdown } from "./export";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
  type JsonValue,
} from "../../test-support/fetch-stub";

// jsdom doesn't implement the Blob URL APIs at all — save whatever (if
// anything) was there before stubbing, so afterEach can restore the exact
// prior state instead of leaking the stub into sibling tests/files.
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
});

/** Route the stubbed fetch by real path: /chats/:id/messages vs. /models. */
function routeFetch(
  messagesResponse: JsonValue,
  modelsStatus: { ok: true; body: JsonValue } | { ok: false },
) {
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/models") {
      return modelsStatus.ok
        ? jsonResponse(modelsStatus.body)
        : jsonResponse({ message: "models unavailable" }, 503);
    }
    if (pathname.endsWith("/messages")) {
      return jsonResponse(messagesResponse);
    }
    throw new Error(`unexpected fetch to ${pathname}`);
  });
}

describe("exportChatAsMarkdown", () => {
  it("downloads the full history as a Markdown file, deferring the object-URL revoke", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    routeFetch(
      {
        messages: [
          {
            id: "m1",
            chatId: "c1",
            seq: 1,
            role: "user",
            senderUserId: "u1",
            parts: [{ type: "text", text: "Hi" }],
            attachments: [],
            usage: null,
            inReplyTo: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      { ok: false },
    );

    const createObjectURL = vi.fn(() => "blob:fake-url");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await exportChatAsMarkdown("chat-1", "My Chat");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Not revoked synchronously — would race the browser's async download
    // handoff and can cancel the save (notably in Firefox).
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });

  it("resolves assistant model names from /models when exporting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    routeFetch(
      {
        messages: [
          {
            id: "m1",
            chatId: "c1",
            seq: 1,
            role: "assistant",
            senderUserId: null,
            parts: [{ type: "text", text: "Hi" }],
            attachments: [],
            usage: { modelId: "system:openai:gpt-4o" },
            inReplyTo: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      {
        ok: true,
        body: {
          defaultModelId: "system:openai:gpt-4o",
          models: [
            {
              id: "system:openai:gpt-4o",
              source: "system",
              name: "GPT-4o",
              contextWindowTokens: 128_000,
            },
          ],
        },
      },
    );
    let exportedBlob: Blob | undefined;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      exportedBlob = blob;
      return "blob:fake-url";
    });
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    await exportChatAsMarkdown("chat-1", "My Chat");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const requestedPaths = fetchMock.mock.calls.map(
      (_, index) => new URL(requestFromCall(fetchMock, index).url).pathname,
    );
    expect(requestedPaths).toContain("/api/v1/models");
    await expect(exportedBlob?.text()).resolves.toContain(
      "**Assistant** · GPT-4o",
    );

    await vi.runAllTimersAsync();
  });
});
