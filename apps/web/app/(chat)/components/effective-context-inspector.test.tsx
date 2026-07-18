// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useReceipt = vi.fn();
vi.mock("@/lib/services/chat/runs", () => ({
  useRunContextReceipt: (...args: unknown[]) => useReceipt(...args),
}));

import { EffectiveContextInspector } from "./effective-context-inspector";

afterEach(() => {
  cleanup();
  useReceipt.mockReset();
});

describe("EffectiveContextInspector", () => {
  it("shows the complete safe owner receipt without a host path", () => {
    useReceipt.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        modelId: "custom:anthropic:sonnet",
        promptSource: "model_override",
        systemPrompt: "You are the complete model-specific prompt.",
        tools: [
          {
            id: "search_conversations",
            description: "Search the owner's conversations.",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
        ],
        contentHash: "7f07b813",
        createdAt: "2026-07-18T12:34:56.000Z",
      },
    });

    render(
      <EffectiveContextInspector
        runId="a5dc235e-1de8-4aad-84d8-e0e247b6a135"
        open
        onOpenChange={() => undefined}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Effective context" }),
    ).toBeTruthy();
    expect(screen.getByText("Model-specific override")).toBeTruthy();
    expect(
      screen.getByText("You are the complete model-specific prompt."),
    ).toBeTruthy();
    expect(screen.getByText("search_conversations")).toBeTruthy();
    expect(screen.getByText(/"query"/)).toBeTruthy();
    expect(screen.getByText("7f07b813")).toBeTruthy();
    expect(
      screen.queryByText(/\/etc\/|systemPromptFile|host path/i),
    ).toBeNull();
    expect(useReceipt).toHaveBeenCalledWith(
      "a5dc235e-1de8-4aad-84d8-e0e247b6a135",
      true,
    );
  });
});
