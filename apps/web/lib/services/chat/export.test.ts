// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("../../api/client", () => ({
  api: { get },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import { exportChatAsMarkdown } from "./export";

afterEach(() => {
  get.mockReset();
  vi.useRealTimers();
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

    // jsdom doesn't implement the Blob URL APIs — stub them directly.
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
});
