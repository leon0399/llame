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
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";

import type {
  ActiveRunResponse,
  ChatLatestRunResponse,
} from "@/lib/api/generated/models";
import {
  activeRunsQueryKeys,
  syncRunHistory,
} from "@/lib/services/chat/active-runs";
import { chatQueryKeys } from "@/lib/services/chat/queries";
import { chatJobsQueryKeys } from "@/lib/services/jobs/queries";
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
  const {
    activeChatIds,
    runPhaseByChatId,
    runStatusByChatId,
    unseenRunOutcomes,
  } = useActiveRuns();

  return (
    <div>
      <span data-testid="completed">
        {String(unseenRunOutcomes.has(chatId))}
      </span>
      <span data-testid="processing">{String(activeChatIds.has(chatId))}</span>
      <span data-testid="phase">{runPhaseByChatId.get(chatId) ?? "none"}</span>
      <span data-testid="run-status">
        {runStatusByChatId.get(chatId) ?? "none"}
      </span>
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
  overrides: Partial<RunUpdatedMessage["run"]> = {},
): RunUpdatedMessage => ({
  type: "run.updated",
  run: {
    id: runId,
    chatId,
    messageId: null,
    kind: "turn",
    modelId: "m",
    permissionMode: "default",
    status,
    error: null,
    quotaWait: null,
    createdAt: "2026-10-16T12:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    ...overrides,
  },
});

const latestRunFixture = (
  overrides: Partial<ChatLatestRunResponse> = {},
): ChatLatestRunResponse => ({
  kind: "turn",
  id: runId,
  messageId: null,
  status: "running_model",
  followUpAction: null,
  modelId: "m",
  effort: null,
  permissionMode: "default",
  error: null,
  errorCode: null,
  errorResetsAt: null,
  quotaWait: null,
  ...overrides,
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
      return jsonResponse(runUpdated("running_model").run);
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

  it("writes a pushed chat record into the detail cache", () => {
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
          runningJobs: 0,
        },
      }),
    );

    expect(
      queryClient.getQueryData(chatQueryKeys.detail(chatId)),
    ).toMatchObject({ title: "Pushed" });
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: chatJobsQueryKeys.chat(chatId),
      exact: true,
    });
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
    expect(screen.getByTestId("run-status").textContent).toBe("running_model");

    latestSocket().serverSend(JSON.stringify(runUpdated("awaiting_jobs")));
    await waitFor(() =>
      expect(screen.getByTestId("run-status").textContent).toBe(
        "awaiting_jobs",
      ),
    );

    latestSocket().serverSend(JSON.stringify(runUpdated("completed")));
    expect(screen.getByTestId("phase").textContent).toBe("none");
    await waitFor(() =>
      expect(screen.getByTestId("processing").textContent).toBe("false"),
    );
  });
  it("updates the cached latest run through quota wait, wake, and failure", () => {
    const { queryClient } = renderLive(
      <ActiveRunsProvider>
        <RunsProbe />
      </ActiveRunsProvider>,
    );

    const latestRun: ChatLatestRunResponse = {
      kind: "turn",
      id: runId,
      messageId: null,
      status: "running_model",
      followUpAction: null,
      modelId: "m",
      effort: null,
      permissionMode: "default",
      error: null,
      errorCode: null,
      errorResetsAt: null,
      quotaWait: null,
    };

    queryClient.setQueryData(chatQueryKeys.messages(chatId), {
      pages: [{ messages: [], compaction: null, latestRun }],
      pageParams: [null],
    });
    const targetKey = chatQueryKeys.targetMessages(chatId, 17);
    queryClient.setQueryData(
      targetKey,
      queryClient.getQueryData(chatQueryKeys.messages(chatId)),
    );

    const latest = () =>
      queryClient.getQueryData<{
        pages: Array<{ latestRun: ChatLatestRunResponse }>;
      }>(chatQueryKeys.messages(chatId))?.pages[0]?.latestRun;

    latestSocket().serverOpen();
    latestSocket().serverSend(
      JSON.stringify(
        runUpdated("awaiting_quota", {
          quotaWait: {
            failureClass: "quota_exhausted",
            resetsAt: "2026-11-20T12:00:00.000Z",
            wakeAt: "2026-11-20T12:01:00.000Z",
          },
        }),
      ),
    );
    expect(
      queryClient.getQueryData(activeRunsQueryKeys.run(runId)),
    ).toMatchObject({
      status: "awaiting_quota",
      quotaWait: { failureClass: "quota_exhausted" },
    });
    expect(latest()).toMatchObject({
      status: "awaiting_quota",
      quotaWait: { failureClass: "quota_exhausted" },
      errorCode: null,
      errorResetsAt: null,
    });
    expect(queryClient.getQueryData(targetKey)).toEqual(
      queryClient.getQueryData(chatQueryKeys.messages(chatId)),
    );

    latestSocket().serverSend(JSON.stringify(runUpdated("queued")));
    expect(
      queryClient.getQueryData(activeRunsQueryKeys.run(runId)),
    ).toMatchObject({ status: "queued", quotaWait: null });
    expect(latest()).toMatchObject({
      status: "queued",
      quotaWait: null,
      errorCode: null,
      errorResetsAt: null,
    });
    latestSocket().serverSend(
      JSON.stringify(
        runUpdated("failed", {
          chatId: "33333333-3333-4333-8333-333333333333",
          error: { code: "other", resetsAt: 1_900_000_000_001 },
        }),
      ),
    );
    expect(latest()).toMatchObject({
      status: "queued",
      quotaWait: null,
      errorCode: null,
      errorResetsAt: null,
    });

    latestSocket().serverSend(
      JSON.stringify(
        runUpdated("failed", {
          error: {
            code: "quota_exhausted",
            message: "The provider's weekly usage limit was reached.",
            resetsAt: 1_900_000_000_000,
          },
        }),
      ),
    );
    expect(
      queryClient.getQueryData(activeRunsQueryKeys.run(runId)),
    ).toMatchObject({ status: "failed", quotaWait: null });
    expect(latest()).toMatchObject({
      status: "failed",
      quotaWait: null,
      error: "The provider's weekly usage limit was reached.",
      errorCode: "quota_exhausted",
      errorResetsAt: 1_900_000_000_000,
    });
    expect(queryClient.getQueryData(targetKey)).toEqual(
      queryClient.getQueryData(chatQueryKeys.messages(chatId)),
    );
  });
  it.each([false, true])(
    "keeps a newer quota update after a late history read (previous Run: %s)",
    async (returnsPreviousRun) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      const key = chatQueryKeys.messages(chatId);

      const oldHistory = {
        pages: [
          {
            messages: [],
            compaction: null,
            latestRun: latestRunFixture({
              id: "previous",
              status: "completed",
            }),
          },
        ],
        pageParams: [null],
      };

      const queuedHistory = {
        ...oldHistory,
        pages: [
          {
            messages: [],
            compaction: null,
            latestRun: latestRunFixture({ status: "queued" }),
          },
        ],
      };

      let resolveSnapshot!: (value: typeof queuedHistory) => void;

      const snapshot = new Promise<typeof queuedHistory>((resolve) => {
        resolveSnapshot = resolve;
      });

      queryClient.setQueryData(key, oldHistory);

      let reads = 0;

      const observer = new QueryObserver(queryClient, {
        queryKey: key,
        queryFn: () =>
          ++reads === 1 ? snapshot : Promise.resolve(queuedHistory),
        staleTime: Infinity,
      });

      const unsubscribe = observer.subscribe(() => undefined);

      const quotaWait: NonNullable<ChatLatestRunResponse["quotaWait"]> = {
        failureClass: "quota_exhausted",
        resetsAt: "2026-11-20T12:00:00.000Z",
        wakeAt: "2026-11-20T12:01:00.000Z",
      };

      try {
        const update = runUpdated("awaiting_quota", { quotaWait }).run;

        queryClient.setQueryData(activeRunsQueryKeys.run(runId), update);
        syncRunHistory(queryClient, chatId, update);
        resolveSnapshot(returnsPreviousRun ? oldHistory : queuedHistory);
        await waitFor(() =>
          expect(queryClient.getQueryData(key)).toMatchObject({
            pages: [
              { latestRun: { id: runId, status: "awaiting_quota", quotaWait } },
            ],
          }),
        );
      } finally {
        resolveSnapshot(queuedHistory);
        unsubscribe();
      }
    },
  );

  it.each([
    [
      "a completed Run",
      latestRunFixture({
        id: "55555555-5555-4555-8555-555555555555",
        status: "completed",
      }),
    ],
    ["no latest Run", null],
  ] as const)(
    "invalidates history for a live Run replacing %s",
    (_label, latestRun) => {
      const { queryClient } = renderLive(
        <ActiveRunsProvider>
          <RunsProbe />
        </ActiveRunsProvider>,
      );

      const messagesKey = chatQueryKeys.messages(chatId);
      const targetKey = chatQueryKeys.targetMessages(chatId, 17);
      latestSocket().serverOpen();

      const history = {
        pages: [
          {
            messages: [],
            compaction: null,
            latestRun,
          },
        ],
        pageParams: [null],
      };

      queryClient.setQueryData(messagesKey, history);
      queryClient.setQueryData(targetKey, history);

      latestSocket().serverSend(
        JSON.stringify(
          runUpdated("awaiting_quota", {
            quotaWait: {
              failureClass: "quota_exhausted",
              resetsAt: "2026-11-20T12:00:00.000Z",
              wakeAt: "2026-11-20T12:01:00.000Z",
            },
          }),
        ),
      );

      expect(
        queryClient.getQueryData(activeRunsQueryKeys.run(runId)),
      ).toMatchObject({ status: "awaiting_quota" });
      expect(queryClient.getQueryState(messagesKey)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(targetKey)?.isInvalidated).toBe(true);
      // The live frame is not a complete latest-history record: keep the cached
      // content until the authoritative refetch resolves, rather than writing
      // an incomplete Run over it.
      expect(queryClient.getQueryData(messagesKey)).toBe(history);
      expect(queryClient.getQueryData(targetKey)).toBe(history);
    },
  );

  it("clears a live quota wait when the run completes without queuing", () => {
    const { queryClient } = renderLive(
      <ActiveRunsProvider>
        <RunsProbe />
      </ActiveRunsProvider>,
    );

    const completedChatId = "33333333-3333-4333-8333-333333333333";
    const completedRunId = "44444444-4444-4444-8444-444444444444";
    queryClient.setQueryData(chatQueryKeys.messages(completedChatId), {
      pages: [
        {
          messages: [],
          compaction: null,
          latestRun: {
            kind: "turn",
            id: completedRunId,
            messageId: null,
            status: "running_model",
            followUpAction: null,
            modelId: "m",
            effort: null,
            permissionMode: "default",
            error: null,
            errorCode: null,
            errorResetsAt: null,
            quotaWait: null,
          },
        },
      ],
      pageParams: [null],
    });

    const latest = () =>
      queryClient.getQueryData<{
        pages: Array<{ latestRun: ChatLatestRunResponse }>;
      }>(chatQueryKeys.messages(completedChatId))?.pages[0]?.latestRun;

    latestSocket().serverOpen();
    latestSocket().serverSend(
      JSON.stringify(
        runUpdated("awaiting_quota", {
          id: completedRunId,
          chatId: completedChatId,
          quotaWait: {
            failureClass: "rate_limited",
            resetsAt: "2026-11-20T12:00:00.000Z",
            wakeAt: "2026-11-20T12:01:00.000Z",
          },
        }),
      ),
    );
    latestSocket().serverSend(
      JSON.stringify(
        runUpdated("completed", {
          id: completedRunId,
          chatId: completedChatId,
        }),
      ),
    );
    expect(
      queryClient.getQueryData(activeRunsQueryKeys.run(completedRunId)),
    ).toMatchObject({ status: "completed", quotaWait: null });

    expect(latest()).toMatchObject({
      status: "completed",
      quotaWait: null,
      errorCode: null,
      errorResetsAt: null,
    });
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

  it("does not restore a phase from before the disconnect after reconnecting", async () => {
    renderLive(
      <ActiveRunsProvider>
        <RunsProbe />
      </ActiveRunsProvider>,
    );
    latestSocket().serverOpen();
    latestSocket().serverSend(JSON.stringify(runProgress({ phase: "tool" })));
    latestSocket().serverClose();
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2), {
      timeout: 2000,
    });

    latestSocket().serverOpen();
    expect(screen.getByTestId("phase").textContent).toBe("none");
  });

  it("notifies the completion of a run whose first message is already terminal", async () => {
    renderLive(
      <ActiveRunsProvider>
        <RunsProbe />
      </ActiveRunsProvider>,
    );
    latestSocket().serverOpen();

    latestSocket().serverSend(JSON.stringify(runUpdated("completed")));

    await waitFor(() =>
      expect(screen.getByTestId("completed").textContent).toBe("true"),
    );
    expect(screen.getByTestId("processing").textContent).toBe("false");
  });
});
