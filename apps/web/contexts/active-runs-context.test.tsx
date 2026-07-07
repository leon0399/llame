// @vitest-environment jsdom

/**
 * Integration-level proof for the REAL ActiveRunsProvider (React Query
 * refactor): unlike chat-item.test.tsx / chat-page.compaction.test.tsx,
 * which mock this context away, these tests exercise the actual
 * useQuery/useQueries wiring against a real QueryClient — only the network
 * layer (fetchActiveRuns/fetchRun) and next/navigation are mocked.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { ActiveRun, Run } from "@/lib/services/chat/active-runs";
import { activeRunsQueryKeys } from "@/lib/services/chat/active-runs";

const { routerPushMock, toastMock, fetchActiveRunsMock, fetchRunMock } =
  vi.hoisted(() => ({
    routerPushMock: vi.fn(),
    toastMock: vi.fn(),
    fetchActiveRunsMock: vi.fn<() => Promise<ActiveRun[]>>(),
    fetchRunMock: vi.fn<(runId: string) => Promise<Run | null>>(),
  }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: routerPushMock }),
}));

vi.mock("@workspace/ui/components/sonner", () => ({
  toast: Object.assign(toastMock, { error: vi.fn(), success: vi.fn() }),
}));

vi.mock("@/lib/services/chat/active-runs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/chat/active-runs")>();
  return {
    ...actual,
    fetchActiveRuns: () => fetchActiveRunsMock(),
    fetchRun: (runId: string) => fetchRunMock(runId),
  };
});

import { ActiveRunsProvider, useActiveRuns } from "./active-runs-context";

function Probe({ chatId }: { chatId: string }) {
  const { activeChatIds, completedChats, trackRun } = useActiveRuns();
  return (
    <div>
      <span data-testid="processing">{String(activeChatIds.has(chatId))}</span>
      <span data-testid="unread">{String(completedChats.has(chatId))}</span>
      <button onClick={() => trackRun("run-track", chatId, "Tracked chat")}>
        track
      </button>
    </div>
  );
}

function renderProbe(chatId: string) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <ActiveRunsProvider>
        <Probe chatId={chatId} />
      </ActiveRunsProvider>
    </QueryClientProvider>,
  );
  return { queryClient };
}

afterEach(() => {
  fetchActiveRunsMock.mockReset();
  fetchRunMock.mockReset();
  toastMock.mockReset();
  routerPushMock.mockReset();
  cleanup();
});

describe("ActiveRunsProvider — mount re-hydration (GET /me/runs?status=active)", () => {
  it("tracks a run returned by fetchActiveRuns, marking its chat as processing", async () => {
    fetchActiveRunsMock.mockResolvedValue([
      {
        runId: "run-rehydrated",
        chatId: "chat-a",
        chatTitle: "Walk-away chat",
        status: "running_model",
        createdAt: "2026-07-06T00:00:00.000Z",
      },
    ]);
    fetchRunMock.mockResolvedValue({
      id: "run-rehydrated",
      status: "running_model",
    });

    renderProbe("chat-a");

    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("true"),
    );
    expect(screen.getByTestId("unread").textContent).toBe("false");
  });
});

describe("ActiveRunsProvider — poll-to-completion (useQueries)", () => {
  it("marks the chat processing while the run is non-terminal, then unread + notifies once it completes", async () => {
    fetchActiveRunsMock.mockResolvedValue([]);
    fetchRunMock.mockResolvedValue({
      id: "run-track",
      status: "running_model",
    });

    const { queryClient } = renderProbe("chat-b");

    screen.getByText("track").click();

    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("true"),
    );
    expect(screen.getByTestId("unread").textContent).toBe("false");

    // Simulate the run reaching a terminal status without waiting on the real
    // POLL_MS interval — write directly into the SAME QueryClient cache
    // useQueries reads from, which is exactly how a real refetch's result
    // would land.
    queryClient.setQueryData(activeRunsQueryKeys.run("run-track"), {
      id: "run-track",
      status: "completed",
    });

    await waitFor(() =>
      expect(screen.getByTestId("unread").textContent).toBe("true"),
    );
    expect(screen.getByTestId("processing").textContent).toBe("false");
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0]?.[0]).toContain("Reply ready");
  });

  it("does not notify twice for the same run (handledRunIds guard)", async () => {
    fetchActiveRunsMock.mockResolvedValue([]);
    fetchRunMock.mockResolvedValue({
      id: "run-track",
      status: "running_model",
    });

    const { queryClient } = renderProbe("chat-c");
    screen.getByText("track").click();
    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("true"),
    );

    queryClient.setQueryData(activeRunsQueryKeys.run("run-track"), {
      id: "run-track",
      status: "completed",
    });
    await waitFor(() =>
      expect(screen.getByTestId("unread").textContent).toBe("true"),
    );

    // A redundant cache write for the same (already-dropped) run must not
    // fire a second toast.
    queryClient.setQueryData(activeRunsQueryKeys.run("run-track"), {
      id: "run-track",
      status: "completed",
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(toastMock).toHaveBeenCalledTimes(1);
  });
});
