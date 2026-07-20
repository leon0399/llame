import { beforeEach, describe, expect, test, vi } from "vitest";

const handlers = new Map<string, (payload: unknown) => void>();

vi.mock("storybook/preview-api", () => ({
  addons: {
    getChannel: () => ({
      on: (event: string, handler: (payload: unknown) => void) =>
        handlers.set(event, handler),
    }),
  },
}));

await import("../src/preview.js");

describe("visual preview readiness", () => {
  const report = vi.fn();

  beforeEach(() => {
    report.mockReset();
    globalThis.__LLAME_VISUAL_TESTS__ = {
      report,
      wait: vi.fn(),
      get: vi.fn(),
    };
  });

  test("does not fail visual readiness for another reporter's failure", () => {
    handlers.get("storyFinished")?.({
      storyId: "button--with-select",
      status: "error",
      reporters: [{ type: "a11y", status: "failed" }],
    });

    expect(report).toHaveBeenCalledWith({
      storyId: "button--with-select",
      status: "success",
    });
  });

  test("keeps an actual story execution failure terminal", () => {
    handlers.get("storyFinished")?.({
      storyId: "button--broken",
      status: "error",
      reporters: [],
    });

    expect(report).toHaveBeenCalledWith({
      storyId: "button--broken",
      status: "error",
    });
  });
});
