// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../api/client", () => ({
  api: { get },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import { exportChatAsMarkdown } from "./export";

// jsdom doesn't implement the Blob URL APIs at all — save whatever (if
// anything) was there before stubbing, so afterEach can restore the exact
// prior state instead of leaking the stub into sibling tests/files.
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  get.mockReset();
  vi.useRealTimers();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
});

describe("exportChatAsMarkdown", () => {
  it("downloads the full history as a Markdown file, deferring the object-URL revoke", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    get.mockReturnValue({
      json: () =>
        Promise.resolve({
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
        }),
    });

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
    get.mockImplementation((url: string) => ({
      json: () =>
        Promise.resolve(
          url.endsWith("/api/v1/models")
            ? {
                defaultModelId: "system:openai:gpt-4o",
                models: [
                  {
                    id: "system:openai:gpt-4o",
                    source: "system",
                    name: "GPT-4o",
                  },
                ],
              }
            : {
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
        ),
    }));
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

    expect(get).toHaveBeenCalledWith("http://api/api/v1/models");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    await expect(exportedBlob?.text()).resolves.toContain(
      "**Assistant** · GPT-4o",
    );

    await vi.runAllTimersAsync();
  });
});
