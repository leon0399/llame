// @vitest-environment jsdom

/**
 * The real LiveUpdatesProvider and its ActiveRunsProvider integration against
 * a fake WebSocket: connection state, batched invalidations, run progress
 * fan-out, reconnect after a close, and teardown on unmount. The network
 * behind ActiveRunsProvider is a stubbed fetch routed by pathname.
 */

import { useEffect, useState } from "react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { ActiveRunResponse } from "@/lib/api/generated/models";
import { activeRunsQueryKeys } from "@/lib/services/chat/active-runs";
import { chatQueryKeys } from "@/lib/services/chat/queries";
import type {
  RunMessage,
  RunProgressMessage,
  RunUpdatedMessage,
} from "@/lib/services/live/live-messages";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ActiveRunsProvider, useActiveRuns } from "./active-runs-context";
import {
  LiveUpdatesProvider,
  useOptionalLiveUpdates,
} from "./live-updates-context";

const chatId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

/** Minimal WebSocket stand-in the provider drives through its handlers. */
class FakeWebSocket {
  static instances: Array<FakeWebSocket> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  serverOpen() {
    act(() => this.onopen?.());
  }

  serverSend(frame: string) {
    act(() => this.onmessage?.({ data: frame }));
  }

  serverClose(code = 1006) {
    act(() => this.onclose?.({ code }));
  }
}

const latestSocket = () => {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("no socket opened");
  return socket;
};

function ConnectionProbe() {
  const live = useOptionalLiveUpdates();
  const [received, setReceived] = useState<Array<RunMessage>>([]);
  const subscribe = live?.subscribeRunMessages;
  useEffect(
    () => subscribe?.((message) => setReceived((all) => [...all, message])),
    [subscribe],
  );
  return (
    <div>
      <span data-testid="connected">{String(live?.connected)}</span>
      <span data-testid="progress">
        {received
          .map((m) =>
            m.type === "run.progress" ? `${m.phase}:${m.step}` : m.run.status,
          )
          .join(",")}
      </span>
    </div>
  );
}

function RunsProbe() {
  const { activeChatIds, runPhaseByChatId } = useActiveRuns();
  return (
    <div>
      <span data-testid="processing">{String(activeChatIds.has(chatId))}</span>
      <span data-testid="phase">{runPhaseByChatId.get(chatId) ?? "none"}</span>
    </div>
  );
}

function renderLive(
  children: React.ReactNode,
  onSessionEnded: () => void = () => undefined,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LiveUpdatesProvider onSessionEnded={onSessionEnded}>
        {children}
      </LiveUpdatesProvider>
    </QueryClientProvider>,
  );
  return { queryClient, invalidate, view };
}

const runProgress = (
  overrides: Partial<RunProgressMessage>,
): RunProgressMessage => ({
  type: "run.progress",
  runId,
  chatId,
  phase: "thinking",
  step: 1,
  ...overrides,
});

const runUpdated = (
  status: RunUpdatedMessage["run"]["status"],
): RunUpdatedMessage => ({
  type: "run.updated",
  run: {
    id: runId,
    chatId,
    messageId: null,
    modelId: "m",
    permissionMode: "default",
    status,
    error: null,
    createdAt: "2026-10-16T12:00:00.000Z",
    startedAt: null,
    finishedAt: null,
  },
});

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  const fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") {
      return jsonResponse<Array<ActiveRunResponse>>([]);
    }
    if (pathname.startsWith("/api/v1/runs/")) {
      return jsonResponse({ id: runId, status: "running_model" });
    }
    throw new Error(`unrouted fetch in test: ${pathname}`);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LiveUpdatesProvider", () => {
  it("connects to the live endpoint and refetches owner lists on open", async () => {
    const { invalidate } = renderLive(<ConnectionProbe />);
    expect(latestSocket().url).toMatch(/^ws:\/\/.+\/api\/v1\/live$/);
    expect(screen.getByTestId("connected").textContent).toBe("false");

    latestSocket().serverOpen();

    expect(screen.getByTestId("connected").textContent).toBe("true");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: activeRunsQueryKeys.all,
    });
  });

  it("writes a pushed chat record into the caches without refetching", () => {
    const { queryClient, invalidate } = renderLive(<ConnectionProbe />);
    latestSocket().serverOpen();
    invalidate.mockClear();
    queryClient.setQueryData(chatQueryKeys.infinite(), {
      pages: [[]],
      pageParams: [undefined],
    });

    latestSocket().serverSend(
      JSON.stringify({
        type: "chat.upserted",
        chat: {
          id: chatId,
          ownerUserId: "user-a",
          title: "Pushed",
          visibility: "private",
          createdAt: "2026-10-16T12:00:00.000Z",
          updatedAt: "2026-10-16T12:00:00.000Z",
          archivedAt: null,
          projectId: null,
          workspaceRoot: null,
          lastMessage: "hello",
        },
      }),
    );

    expect(
      queryClient.getQueryData(chatQueryKeys.detail(chatId)),
    ).toMatchObject({ title: "Pushed" });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("fans run progress out to subscribers and ignores malformed frames", () => {
    renderLive(<ConnectionProbe />);
    latestSocket().serverOpen();

    latestSocket().serverSend("{not json");
    latestSocket().serverSend(JSON.stringify({ type: "run.progress", runId }));
    latestSocket().serverSend(
      JSON.stringify(runProgress({ phase: "tool", step: 2 })),
    );
    latestSocket().serverSend(JSON.stringify(runUpdated("completed")));

    expect(screen.getByTestId("progress").textContent).toBe("tool:2,completed");
  });

  it("reconnects after the socket closes and stops on unmount", async () => {
    const { view } = renderLive(<ConnectionProbe />);
    latestSocket().serverOpen();

    latestSocket().serverClose();
    expect(screen.getByTestId("connected").textContent).toBe("false");
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2), {
      timeout: 2000,
    });

    view.unmount();
    expect(latestSocket().closed).toBe(true);
  });
});

describe("ActiveRunsProvider with live updates", () => {
  it("signs in again instead of reconnecting when the session ended", async () => {
    const onSessionEnded = vi.fn();
    renderLive(<ConnectionProbe />, onSessionEnded);
    latestSocket().serverOpen();

    latestSocket().serverClose(4401);
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("tracks a run started elsewhere, shows its phase, and clears it at a terminal status", async () => {
    renderLive(
      <ActiveRunsProvider>
        <RunsProbe />
      </ActiveRunsProvider>,
    );
    latestSocket().serverOpen();

    latestSocket().serverSend(JSON.stringify(runUpdated("running_model")));
    latestSocket().serverSend(
      JSON.stringify(runProgress({ phase: "writing" })),
    );
    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("true"),
    );
    expect(screen.getByTestId("phase").textContent).toBe("writing");

    latestSocket().serverSend(JSON.stringify(runUpdated("completed")));
    expect(screen.getByTestId("phase").textContent).toBe("none");
    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("false"),
    );
  });

  it("drops live phases while disconnected", () => {
    renderLive(
      <ActiveRunsProvider>
        <RunsProbe />
      </ActiveRunsProvider>,
    );
    latestSocket().serverOpen();
    latestSocket().serverSend(JSON.stringify(runProgress({ phase: "tool" })));
    expect(screen.getByTestId("phase").textContent).toBe("tool");

    latestSocket().serverClose();
    expect(screen.getByTestId("phase").textContent).toBe("none");
  });
});
