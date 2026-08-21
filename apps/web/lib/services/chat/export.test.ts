// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const { getChatMessages, fetchModels } = vi.hoisted(() => ({
  getChatMessages: vi.fn(),
  fetchModels: vi.fn(),
}));

vi.mock("../../api/generated/chats/chats", () => ({
  getChatMessages,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch: () => vi.fn(),
}));
vi.mock("../models/queries", () => ({
  fetchModels,
  modelDisplayName: (
    modelId: string,
    models?: readonly { id: string; name?: string }[],
  ) => models?.find((model) => model.id === modelId)?.name ?? modelId,
}));

import { exportChatAsMarkdown } from "./export";

// jsdom doesn't implement the Blob URL APIs at all — save whatever (if
// anything) was there before stubbing, so afterEach can restore the exact
// prior state instead of leaking the stub into sibling tests/files.
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  getChatMessages.mockReset();
  fetchModels.mockReset();
  vi.useRealTimers();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
});

describe("exportChatAsMarkdown", () => {
  it("downloads the full history as a Markdown file, deferring the object-URL revoke", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    getChatMessages.mockResolvedValue({
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
    });
    fetchModels.mockRejectedValue(new Error("models unavailable"));

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
    getChatMessages.mockResolvedValue({
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
    });
    fetchModels.mockResolvedValue({
      defaultModelId: "system:openai:gpt-4o",
      models: [
        {
          id: "system:openai:gpt-4o",
          source: "system",
          name: "GPT-4o",
          contextWindowTokens: 128_000,
        },
      ],
    });
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

    expect(fetchModels).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    await expect(exportedBlob?.text()).resolves.toContain(
      "**Assistant** · GPT-4o",
    );

    await vi.runAllTimersAsync();
  });
});
