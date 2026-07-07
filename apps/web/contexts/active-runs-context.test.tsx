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
import { chatQueryKeys } from "@/lib/services/chat/queries";

const { routerPushMock, toastMock, fetchActiveRunsMock, fetchRunMock } =
  vi.hoisted(() => ({
    routerPushMock: vi.fn(),
    toastMock: vi.fn(),
    fetchActiveRunsMock: vi.fn<() => Promise<ActiveRun[]>>(),
    fetchRunMock: vi.fn<(runId: string) => Promise<Run | null>>(),
  }));

// Mutable so a test can put the "viewer" on a specific chat's route (the
// invalidate-on-terminal test below needs viewingThisChat === true).
let mockPathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
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
  mockPathname = "/";
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

  it("does not act on a stale cached snapshot before THIS mount's own fetch resolves (isFetchedAfterMount)", async () => {
    const queryClient = new QueryClient();
    // Simulate a leftover cache entry from an EARLIER provider mount (e.g.
    // before navigating out of (chat) and back within gcTime) that still
    // lists a run — one that, in reality, has since completed and was
    // already notified about in that earlier mount's own (now-gone) state.
    queryClient.setQueryData(activeRunsQueryKeys.list(), [
      {
        runId: "run-stale",
        chatId: "chat-e",
        chatTitle: "Stale snapshot chat",
        status: "running_model",
        createdAt: "2026-07-06T00:00:00.000Z",
      },
    ]);

    let resolveFetch!: (runs: ActiveRun[]) => void;
    fetchActiveRunsMock.mockReturnValue(
      new Promise<ActiveRun[]>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    fetchRunMock.mockResolvedValue({
      id: "run-stale",
      status: "running_model",
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ActiveRunsProvider>
          <Probe chatId="chat-e" />
        </ActiveRunsProvider>
      </QueryClientProvider>,
    );

    // While this mount's own forced refetch is still in flight, the stale
    // cached snapshot must NOT have been tracked yet.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("processing").textContent).toBe("false");

    // The real, current state is that run-stale already finished — resolve
    // with an empty active-run list, as the server would report.
    resolveFetch([]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("processing").textContent).toBe("false");
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

  it("invalidates the chat's messages on ANY terminal completion, even when the toast/badge is suppressed", async () => {
    fetchActiveRunsMock.mockResolvedValue([]);
    fetchRunMock.mockResolvedValue({
      id: "run-track",
      status: "running_model",
    });

    // Viewing this exact chat — resolveTerminalRun suppresses the toast/badge
    // (the same-visible-chat case this fix targets: e.g. a transient stream
    // error kept the run tracked instead of untracking it, so no onFinish
    // ever refreshes this chat for its real, eventual completion).
    mockPathname = "/chat/chat-viewed";

    const { queryClient } = renderProbe("chat-viewed");
    queryClient.setQueryData(chatQueryKeys.messages("chat-viewed"), {
      messages: [],
      compaction: null,
    });

    screen.getByText("track").click();
    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("true"),
    );

    queryClient.setQueryData(activeRunsQueryKeys.run("run-track"), {
      id: "run-track",
      status: "completed",
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryState(chatQueryKeys.messages("chat-viewed"))
          ?.isInvalidated,
      ).toBe(true),
    );
    // Suppressed as already-visible: no toast, no unread badge — but the
    // messages cache is still invalidated so the visible chat's content
    // catches up to the true server state.
    expect(toastMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("unread").textContent).toBe("false");
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
