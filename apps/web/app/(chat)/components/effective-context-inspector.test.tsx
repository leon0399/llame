// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import * as runs from "@/lib/services/chat/runs";
import type { RunContextReceipt } from "@/lib/services/chat/runs";
import { EffectiveContextInspector } from "./effective-context-inspector";

const useRunContextReceiptMock = vi.mocked(
  vi.spyOn(runs, "useRunContextReceipt"),
  { partial: true },
);

const baseReceipt: RunContextReceipt = {
  modelId: "system:test",
  effort: undefined,
  activeAttemptId: "attempt-1",
  completedAttemptId: "attempt-1",
  state: "prepared" as const,
  receipts: [
    {
      attemptId: "attempt-1",
      promptSource: "project_default" as const,
      systemPrompt: "Complete prompt",
      promptHash: "prompt-hash",
      createdAt: "2026-09-27T00:00:00.000Z",
    },
  ],
  addedTools: [],
  createdAt: "2026-09-27T00:00:00.000Z",
};

function renderReceipt(addedTools: typeof baseReceipt.addedTools) {
  useRunContextReceiptMock.mockReturnValue({
    isPending: false,
    isError: false,
    data: { ...baseReceipt, addedTools },
  });
  render(
    <EffectiveContextInspector
      runId="run-1"
      open
      onOpenChange={() => undefined}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EffectiveContextInspector added tools", () => {
  beforeEach(() => {
    useRunContextReceiptMock.mockReset();
  });

  it("renders added tool ids with source, server, and step provenance", () => {
    renderReceipt([
      {
        id: "mcp__workspace__search",
        source: "workspace-mcp",
        server: "project",
        step: 3,
      },
    ]);

    expect(screen.getByText("Tools added")).toBeTruthy();
    expect(screen.getByText("mcp__workspace__search")).toBeTruthy();
    expect(screen.getByText("(workspace-mcp, project, step 3)")).toBeTruthy();
    expect(screen.queryByText(/inputSchema|description|endpoint/i)).toBeNull();
  });

  it("omits the row when the Run added no tools", () => {
    renderReceipt([]);

    expect(screen.queryByText("Tools added")).toBeNull();
  });
});
