// @vitest-environment jsdom

/**
 * Integration-level proof for the REAL ActiveRunsProvider (React Query
 * refactor): unlike chat-item.test.tsx / chat-page.compaction.test.tsx,
 * which mock this context away, these tests exercise the actual
 * useQuery/useQueries wiring against a real QueryClient. The network layer
 * (GET /me/runs, GET /runs/:id) is a stubbed globalThis.fetch routed by
 * pathname — fetchActiveRuns/fetchRun run for real against it — and toast
 * notifications render through the real @workspace/ui Toaster, so a
 * "Reply ready" assertion proves the actual DOM sonner renders rather than
 * an echoed spy call. Only next/navigation (no in-process seam for a Server
 * Component's router) is mocked.
 */

import { useEffect } from "react";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Mock } from "vitest";

import type {
  ActiveRunResponse,
  RunResponse,
} from "@/lib/api/generated/models";
import { activeRunsQueryKeys } from "@/lib/services/chat/active-runs";
import { chatQueryKeys } from "@/lib/services/chat/queries";
import { Toaster } from "@workspace/ui/components/sonner";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

import { ActiveRunsProvider, useActiveRuns } from "./active-runs-context";

function runResponseFixture(
  overrides: Pick<RunResponse, "id" | "status"> & Partial<RunResponse>,
): RunResponse {
  return {
    chatId: "chat-fixture",
    messageId: null,
    modelId: "system:openai:gpt-5.4-mini",
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

let fetchMock: Mock<typeof fetch>;
// Per-test-overridable handlers for the two endpoints this provider polls —
// letting a test hold GET /me/runs open (the rehydration race) or answer
// GET /runs/:id with the requested id, the way the real API would.
let activeRunsHandler: () => Promise<Response>;
let runHandler: (runId: string) => Promise<Response>;

function stubActiveRunsNetwork() {
  fetchMock = stubFetch();
  activeRunsHandler = () =>
    Promise.resolve(jsonResponse<Array<ActiveRunResponse>>([]));
  runHandler = () => Promise.resolve(new Response(null, { status: 404 }));
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") return activeRunsHandler();
    const runMatch = /^\/api\/v1\/runs\/(.+)$/.exec(pathname);
    if (runMatch) return runHandler(runMatch[1]!);
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
}

function Probe({
  chatId,
  viewedChatId,
}: {
  chatId: string;
  viewedChatId?: string;
}) {
  const { activeChatIds, completedChats, trackRun, untrackChat, markChatSeen } =
    useActiveRuns();
  return (
    <div>
      {viewedChatId ? <ViewedChatRegistration chatId={viewedChatId} /> : null}
      <span data-testid="processing">{String(activeChatIds.has(chatId))}</span>
      <span data-testid="unread">{String(completedChats.has(chatId))}</span>
      <button
        type="button"
        onClick={() => trackRun("run-track", chatId, "Tracked chat")}
      >
        track
      </button>
      <button type="button" onClick={() => untrackChat(chatId)}>
        untrack
      </button>
      <button type="button" onClick={() => markChatSeen(chatId)}>
        mark seen
      </button>
    </div>
  );
}

function ViewedChatRegistration({ chatId }: { chatId: string }) {
  const { registerViewedChat } = useActiveRuns();
  useEffect(() => registerViewedChat(chatId), [chatId, registerViewedChat]);
  return null;
}

function renderProbe(
  chatId: string,
  { viewedChatId }: { viewedChatId?: string } = {},
) {
  const queryClient = new QueryClient();
  const tree = (nextChatId: string, nextViewedChatId?: string) => (
    <QueryClientProvider client={queryClient}>
      <ActiveRunsProvider>
        <Toaster />
        <Probe chatId={nextChatId} viewedChatId={nextViewedChatId} />
      </ActiveRunsProvider>
    </QueryClientProvider>
  );
  const rendered = render(tree(chatId, viewedChatId));
  return {
    queryClient,
    rerenderProbe: (nextChatId: string, nextViewedChatId?: string) =>
      rendered.rerender(tree(nextChatId, nextViewedChatId)),
  };
}

beforeAll(() => {
  // jsdom declares window.matchMedia but leaves it "Not implemented"; sonner's
  // real Toaster reads it for the reduced-motion/system-theme queries.
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    configurable: true,
  });
});

afterEach(() => {
  routerPushMock.mockReset();
  vi.unstubAllGlobals();
  cleanup();
});

describe("ActiveRunsProvider — mount re-hydration (GET /me/runs?status=active)", () => {
  it("tracks a run returned by fetchActiveRuns, marking its chat as processing", async () => {
    stubActiveRunsNetwork();
    activeRunsHandler = () =>
      Promise.resolve(
        jsonResponse<Array<ActiveRunResponse>>([
          {
            runId: "run-rehydrated",
            chatId: "chat-a",
            chatTitle: "Walk-away chat",
            status: "running_model",
            createdAt: "2026-07-06T00:00:00.000Z",
          },
        ]),
      );
    runHandler = (runId) =>
      Promise.resolve(
        jsonResponse(
          runResponseFixture({ id: runId, status: "running_model" }),
        ),
      );

    renderProbe("chat-a");

    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("true"),
    );
    expect(screen.getByTestId("unread").textContent).toBe("false");
  });

  it("does not act on a stale cached snapshot before THIS mount's own fetch resolves (isFetchedAfterMount)", async () => {
    stubActiveRunsNetwork();
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

    let resolveFetch!: (response: Response) => void;
    activeRunsHandler = () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    runHandler = (runId) =>
      Promise.resolve(
        jsonResponse(
          runResponseFixture({ id: runId, status: "running_model" }),
        ),
      );

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
    resolveFetch(jsonResponse<Array<ActiveRunResponse>>([]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("processing").textContent).toBe("false");
  });
});

describe("ActiveRunsProvider — poll-to-completion (useQueries)", () => {
  it("marks the chat processing while the run is non-terminal, then unread + notifies once it completes", async () => {
    stubActiveRunsNetwork();
    runHandler = (runId) =>
      Promise.resolve(
        jsonResponse(
          runResponseFixture({ id: runId, status: "running_model" }),
        ),
      );

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
    await waitFor(() =>
      expect(screen.getAllByText("Reply ready — Tracked chat")).toHaveLength(1),
    );
  });

  it("suppresses a visible chat's completion before its session content loads", async () => {
    stubActiveRunsNetwork();
    runHandler = (runId) =>
      Promise.resolve(
        jsonResponse(
          runResponseFixture({ id: runId, status: "running_model" }),
        ),
      );

    // The rendered chat is authoritative even before a draft adopts its
    // `/chat/:id` URL. A pathname guess would misclassify that visible draft
    // as background and emit a stale "Reply ready" toast over its composer.
    const { queryClient } = renderProbe("chat-viewed", {
      viewedChatId: "chat-viewed",
    });
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
    expect(screen.queryByText(/Reply ready/)).toBeNull();
    expect(screen.getByTestId("unread").textContent).toBe("false");
  });

  it("stops suppressing completion after the viewer moves to another chat", async () => {
    stubActiveRunsNetwork();
    runHandler = (runId) =>
      Promise.resolve(
        jsonResponse(
          runResponseFixture({ id: runId, status: "running_model" }),
        ),
      );

    const { queryClient, rerenderProbe } = renderProbe("chat-viewed", {
      viewedChatId: "chat-viewed",
    });
    screen.getByText("track").click();
    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("true"),
    );

    rerenderProbe("chat-other", "chat-other");
    queryClient.setQueryData(activeRunsQueryKeys.run("run-track"), {
      id: "run-track",
      status: "completed",
    });

    await waitFor(() =>
      expect(screen.getByText("Reply ready — Tracked chat")).toBeTruthy(),
    );
  });

  it("does not notify twice for the same run (handledRunIds guard)", async () => {
    stubActiveRunsNetwork();
    runHandler = (runId) =>
      Promise.resolve(
        jsonResponse(
          runResponseFixture({ id: runId, status: "running_model" }),
        ),
      );

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
    expect(screen.getAllByText("Reply ready — Tracked chat")).toHaveLength(1);
  });
});

describe("ActiveRunsProvider — failed/expired runs", () => {
  it("surfaces a failure toast (not a completion toast) and still sets the badge", async () => {
    stubActiveRunsNetwork();
    runHandler = (runId) =>
      Promise.resolve(
        jsonResponse(
          runResponseFixture({ id: runId, status: "running_model" }),
        ),
      );

    const { queryClient } = renderProbe("chat-fail");
    screen.getByText("track").click();
    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("true"),
    );

    queryClient.setQueryData(activeRunsQueryKeys.run("run-track"), {
      id: "run-track",
      status: "failed",
    });

    await waitFor(() =>
      expect(screen.getByTestId("unread").textContent).toBe("true"),
    );
    expect(screen.getByText("Run failed — Tracked chat")).toBeTruthy();
    expect(screen.queryByText(/Reply ready/)).toBeNull();
  });
});

describe("ActiveRunsProvider — untrackChat / markChatSeen", () => {
  it("untrackChat drops that chat's tracked run (removeChatRuns' matching branch)", async () => {
    stubActiveRunsNetwork();
    runHandler = (runId) =>
      Promise.resolve(
        jsonResponse(
          runResponseFixture({ id: runId, status: "running_model" }),
        ),
      );

    renderProbe("chat-untrack");
    screen.getByText("track").click();
    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("true"),
    );

    screen.getByText("untrack").click();
    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("false"),
    );
  });

  it("markChatSeen clears the unread badge (clearSeenChat's matching branch)", async () => {
    stubActiveRunsNetwork();
    runHandler = (runId) =>
      Promise.resolve(
        jsonResponse(
          runResponseFixture({ id: runId, status: "running_model" }),
        ),
      );

    const { queryClient } = renderProbe("chat-seen");
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

    screen.getByText("mark seen").click();
    await waitFor(() =>
      expect(screen.getByTestId("unread").textContent).toBe("false"),
    );
  });
});

describe("ActiveRunsProvider — trackRun idempotence", () => {
  it("re-tracking the same run for the same chat is a no-op (addTrackedRun's idempotent branch)", async () => {
    stubActiveRunsNetwork();
    runHandler = (runId) =>
      Promise.resolve(
        jsonResponse(
          runResponseFixture({ id: runId, status: "running_model" }),
        ),
      );

    renderProbe("chat-idempotent");
    screen.getByText("track").click();
    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("true"),
    );

    // Second click with the identical (runId, chatId) must not throw or
    // change the observable state.
    screen.getByText("track").click();
    expect(screen.getByTestId("processing").textContent).toBe("true");
  });
});
