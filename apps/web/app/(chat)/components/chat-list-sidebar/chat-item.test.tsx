// @vitest-environment jsdom

/**
 * Render-level proof for the sidebar's "Fork" (clone-whole-chat) menu item:
 * it renders, and selecting it fires the fork mutation with NO anchor
 * (fromMessageId omitted), then navigates to the new chat — mirroring
 * message-fork-button.test.tsx's coverage of the per-message fork action.
 *
 * useForkChat, useFileChat, usePinItem/useUnpinItem, and useSetChatArchive/
 * useSetProjectArchive all run for real here against a stubbed
 * globalThis.fetch routed by pathname+method (POST forks, PATCH chats/:id,
 * PUT/DELETE pins/chat/:id) — a mutation is proved by the real request it
 * sends (and, for pin, the real optimistic cache write) rather than an
 * echoed mock-call. The activity-indicator suite runs the real
 * ActiveRunsProvider, reaching each state (processing/unread/both) through
 * the real trackRun + terminal-run cache write, the same technique
 * contexts/active-runs-context.test.tsx uses. Only next/navigation (no
 * in-process seam) is mocked.
 */

import * as React from "react";
import { useEffect } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Mock } from "vitest";
import { SidebarMenu, SidebarProvider } from "@workspace/ui/components/sidebar";

import type {
  ChatResponse as GeneratedChatResponse,
  RunResponse,
} from "@/lib/api/generated/models";
import {
  ActiveRunsProvider,
  useActiveRuns,
} from "@/contexts/active-runs-context";
import { activeRunsQueryKeys } from "@/lib/services/chat/active-runs";
import { pinQueryKeys } from "@/lib/services/pins/queries";
import type { PinnedItem } from "@/lib/services/pins/types";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";

const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: routerPushMock }),
}));

import { ChatItem } from "./chat-item";

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

/** Mounted alongside ChatItem, inside the real ActiveRunsProvider, to reach
 * an arbitrary processing/unread state through the real trackRun API
 * instead of a context mock. */
function TrackRun({
  runId,
  chatId,
  title,
}: {
  runId: string;
  chatId: string;
  title: string;
}) {
  const { trackRun } = useActiveRuns();
  useEffect(
    () => trackRun(runId, chatId, title),
    [runId, chatId, title, trackRun],
  );
  return null;
}

beforeAll(() => {
  // jsdom doesn't implement matchMedia — @workspace/ui's SidebarProvider
  // uses it (useIsMobile) to decide desktop vs. mobile chrome.
  window.matchMedia =
    window.matchMedia ??
    ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

  // jsdom doesn't implement the Pointer Events capture API Base UI's
  // DropdownMenu relies on for its open/close + focus handling.
  for (const method of [
    "hasPointerCapture",
    "setPointerCapture",
    "releasePointerCapture",
  ] as const) {
    if (!(method in Element.prototype)) {
      Object.defineProperty(Element.prototype, method, {
        value: () => false,
        writable: true,
      });
    }
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }

  // jsdom doesn't implement ResizeObserver — Base UI's Tooltip (rendered by the
  // pin action) instantiates one on mount.
  if (!("ResizeObserver" in globalThis)) {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverStub {
        constructor(_callback: ResizeObserverCallback) {}
        observe(_target: Element, _options?: ResizeObserverOptions): void {}
        unobserve(_target: Element): void {}
        disconnect(): void {}
      },
    );
  }
});

let fetchMock: Mock<typeof fetch>;
// Per-test-overridable pieces of the routed fetch stub.
let forkResponse: () => Promise<Response>;
let runStatusById: Record<string, RunResponse["status"]>;

function stubChatItemNetwork() {
  fetchMock = stubFetch();
  forkResponse = () =>
    Promise.resolve(
      jsonResponse<GeneratedChatResponse>({
        id: "cloned-chat-9",
        ownerUserId: "user-1",
        title: "My chat",
        visibility: "private",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        archivedAt: null,
        projectId: null,
      }),
    );
  runStatusById = {};
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/v1/me/runs") return jsonResponse([]);
    const runMatch = /^\/api\/v1\/runs\/(.+)$/.exec(pathname);
    if (runMatch) {
      const runId = runMatch[1]!;
      return jsonResponse(
        runResponseFixture({
          id: runId,
          status: runStatusById[runId] ?? "running_model",
        }),
      );
    }
    if (
      pathname === "/api/v1/chats/chat-1/forks" &&
      request.method === "POST"
    ) {
      return forkResponse();
    }
    if (pathname === "/api/v1/chats/chat-1" && request.method === "PATCH") {
      return jsonResponse({ id: "chat-1" });
    }
    const pinMatch = /^\/api\/v1\/pins\/chat\/(.+)$/.exec(pathname);
    if (pinMatch && request.method === "PUT") {
      const itemId = pinMatch[1]!;
      return jsonResponse({
        itemType: "chat",
        itemId,
        pinnedAt: "2026-01-01T00:00:00.000Z",
        item: { id: itemId, title: "My chat", archivedAt: null },
      });
    }
    if (pinMatch && request.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unrouted fetch in test: ${request.method} ${pathname}`);
  });
}

type TrackedRun = { runId: string; chatId: string; title: string };

function renderChatItem({
  projectId = null,
  projects,
  onNewProject,
  isPinned = false,
  trackedRuns = [],
}: {
  projectId?: string | null;
  projects?: Array<{ id: string; name: string }>;
  onNewProject?: () => void;
  /** Pins is the sole source of pin state (design D5) — not a chat field. */
  isPinned?: boolean;
  /** Runs to track via the real ActiveRunsProvider before ChatItem mounts. */
  trackedRuns?: Array<TrackedRun>;
} = {}) {
  const queryClient = new QueryClient();
  const tree = (runs: Array<TrackedRun>) => (
    <QueryClientProvider client={queryClient}>
      <ActiveRunsProvider>
        {runs.map((run) => (
          <TrackRun key={run.runId} {...run} />
        ))}
        <SidebarProvider>
          <SidebarMenu>
            <ChatItem
              chat={{
                id: "chat-1",
                title: "My chat",
                lastMessage: null,
                visibility: "private",
                projectId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                archivedAt: null,
              }}
              // SAFETY: only id/name are read by the submenu; cast keeps the
              // fixture free of ProjectResponse's timestamp noise.
              projects={
                projects as React.ComponentProps<typeof ChatItem>["projects"]
              }
              onNewProject={onNewProject}
              isPinned={isPinned}
            />
          </SidebarMenu>
        </SidebarProvider>
      </ActiveRunsProvider>
    </QueryClientProvider>
  );
  const rendered = render(tree(trackedRuns));
  return {
    queryClient,
    // Rerenders the SAME React tree (ActiveRunsProvider/QueryClient stay
    // mounted) with an expanded tracked-run list — the only real way to
    // track a second run after the initial render, mirroring
    // contexts/active-runs-context.test.tsx's rerenderProbe.
    rerenderTrackedRuns: (runs: Array<TrackedRun>) =>
      rendered.rerender(tree(runs)),
    ...rendered,
  };
}

beforeEach(() => {
  stubChatItemNetwork();
});

afterEach(() => {
  routerPushMock.mockReset();
  // NOT vi.unstubAllGlobals() — beforeAll's ResizeObserver/pointer-capture
  // stubs must survive across tests; beforeEach's stubFetch() already
  // replaces fetch fresh each test.
  cleanup();
});

/** Wait for and return the first stubbed-fetch Request sent to `pathname`
 * with `method` — distinguishes a mutation from the ActiveRunsProvider's
 * own GET /api/v1/me/runs already in flight from mount. */
async function findRequest(
  mock: Mock<typeof fetch>,
  method: string,
  pathname: string,
): Promise<Request> {
  const matches = (req: unknown): req is Request =>
    req instanceof Request &&
    req.method === method &&
    new URL(req.url).pathname === pathname;
  await waitFor(() =>
    expect(mock.mock.calls.some(([req]) => matches(req))).toBe(true),
  );
  return mock.mock.calls.map(([req]) => req).find(matches)!;
}

describe("ChatItem — pin toggle (unified /api/v1/pins resource)", () => {
  it("unpinned row: clicking the pin action pins the chat with a synthesized card", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderChatItem({ isPinned: false });

    await user.click(screen.getByRole("button", { name: "Pin" }));

    // The optimistic write real usePinItem's onMutate makes into the pins
    // cache, synthesizing the card from the row the owner clicked on.
    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<PinnedItem>>(pinQueryKeys.list()),
      ).toMatchObject([
        {
          itemType: "chat",
          itemId: "chat-1",
          item: { id: "chat-1", title: "My chat", archivedAt: null },
        },
      ]),
    );
    await findRequest(fetchMock, "PUT", "/api/v1/pins/chat/chat-1");
  });

  it("pinned row: clicking the pin action unpins the chat", async () => {
    const user = userEvent.setup();
    renderChatItem({ isPinned: true });

    await user.click(screen.getByRole("button", { name: "Unpin" }));

    await findRequest(fetchMock, "DELETE", "/api/v1/pins/chat/chat-1");
  });

  it("the row menu's Pin/Unpin item mirrors the quick-toggle action's label and behavior", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderChatItem({ isPinned: false });

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Pin" }));

    await waitFor(() =>
      expect(
        queryClient.getQueryData<Array<PinnedItem>>(pinQueryKeys.list()),
      ).toMatchObject([
        {
          itemType: "chat",
          itemId: "chat-1",
          item: { id: "chat-1", title: "My chat", archivedAt: null },
        },
      ]),
    );
    await findRequest(fetchMock, "PUT", "/api/v1/pins/chat/chat-1");
  });
});

describe("ChatItem row menu — Fork (clone whole chat)", () => {
  // userEvent's pointer sequences against the Base UI menu are slow under
  // contended local runs — repeatedly observed blowing vitest's 5s default
  // locally (never in CI); see #179's side note.
  it(
    "opens the row menu and renders a Fork item",
    { timeout: 15_000 },
    async () => {
      const user = userEvent.setup();
      renderChatItem();

      await user.click(screen.getByRole("button", { name: /more/i }));

      expect(
        await screen.findByRole("menuitem", { name: "Fork" }),
      ).toBeTruthy();
    },
  );

  it(
    "fires the fork mutation with NO fromMessageId and navigates on success",
    { timeout: 15_000 },
    async () => {
      const user = userEvent.setup();
      renderChatItem();

      await user.click(screen.getByRole("button", { name: /more/i }));
      await user.click(await screen.findByRole("menuitem", { name: "Fork" }));

      const request = await findRequest(
        fetchMock,
        "POST",
        "/api/v1/chats/chat-1/forks",
      );
      // No anchor: JSON.stringify({ fromMessageId: undefined }) drops the
      // key entirely, proving the whole-chat clone (not a per-message fork).
      await expect(request.json()).resolves.toEqual({});

      // The real onSuccess navigates using the id our stub's POST response
      // returned (cloned-chat-9), not a hand-fed callback argument.
      await waitFor(() =>
        expect(routerPushMock).toHaveBeenCalledWith("/chat/cloned-chat-9"),
      );
    },
  );
});

describe("ChatItem row menu — project submenu (select-like radio group)", () => {
  const PROJECTS = [
    { id: "proj-1", name: "Work" },
    { id: "proj-2", name: "Research" },
  ];

  it('unfiled chat: trigger says "Add to project" and there is no "Remove from project" item', async () => {
    const user = userEvent.setup();
    renderChatItem({ projectId: null, projects: PROJECTS });

    await user.click(screen.getByRole("button", { name: /more/i }));
    const trigger = await screen.findByRole("menuitem", {
      name: "Add to project",
    });
    await user.hover(trigger);

    expect(
      await screen.findByRole("menuitemradio", { name: "Work" }),
    ).toBeTruthy();
    expect(screen.queryByText("Remove from project")).toBeNull();
    expect(screen.queryByText("Change project")).toBeNull();
  });

  it("unfiled chat: picking a project files the chat into it", async () => {
    const user = userEvent.setup();
    renderChatItem({ projectId: null, projects: PROJECTS });

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.hover(
      await screen.findByRole("menuitem", { name: "Add to project" }),
    );
    // fireEvent, not user.click: userEvent's simulated pointer travel
    // re-triggers Base UI's submenu hover tracking under jsdom's zero-geometry
    // and closes the submenu before pointerup lands (same workaround as
    // message-fork-button.test.tsx).
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Research" }),
    );

    const request = await findRequest(
      fetchMock,
      "PATCH",
      "/api/v1/chats/chat-1",
    );
    await expect(request.json()).resolves.toEqual({ projectId: "proj-2" });
  });

  it('filed chat: trigger says "Change project" and the current project is the checked radio item', async () => {
    const user = userEvent.setup();
    renderChatItem({ projectId: "proj-1", projects: PROJECTS });

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.hover(
      await screen.findByRole("menuitem", { name: "Change project" }),
    );

    const current = await screen.findByRole("menuitemradio", { name: "Work" });
    expect(current.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("menuitemradio", { name: "Research" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.queryByText("Remove from project")).toBeNull();
  });

  it("filed chat: re-picking the checked project unfiles the chat (toggle-off)", async () => {
    const user = userEvent.setup();
    renderChatItem({ projectId: "proj-1", projects: PROJECTS });

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.hover(
      await screen.findByRole("menuitem", { name: "Change project" }),
    );
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Work" }));

    const request = await findRequest(
      fetchMock,
      "PATCH",
      "/api/v1/chats/chat-1",
    );
    await expect(request.json()).resolves.toEqual({ projectId: null });
  });

  it("typing in the filter narrows the project list; clearing restores it", async () => {
    const user = userEvent.setup();
    renderChatItem({ projectId: null, projects: PROJECTS });

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.hover(
      await screen.findByRole("menuitem", { name: "Add to project" }),
    );
    const input = await screen.findByPlaceholderText("Search projects…");

    fireEvent.change(input, { target: { value: "res" } });
    expect(
      await screen.findByRole("menuitemradio", { name: "Research" }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitemradio", { name: "Work" })).toBeNull();

    fireEvent.change(input, { target: { value: "zzz" } });
    expect(await screen.findByText("No projects found")).toBeTruthy();

    // The trailing "x" clears the filter and restores the full list.
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(
      await screen.findByRole("menuitemradio", { name: "Work" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
  });

  it('offers a "New project" item that asks the caller to open the shared dialog', async () => {
    const user = userEvent.setup();
    const onNewProject = vi.fn();
    renderChatItem({ projectId: null, projects: PROJECTS, onNewProject });

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.hover(
      await screen.findByRole("menuitem", { name: "Add to project" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New project" }),
    );

    // Deferred invoke (setTimeout 0), same as the Rename dialog; the caller
    // owns ONE shared dialog and files this chat into the created project.
    await vi.waitFor(() => expect(onNewProject).toHaveBeenCalledTimes(1));
  });

  it('renders "New project" disabled when no handler is provided (never a dead click)', async () => {
    const user = userEvent.setup();
    renderChatItem({ projectId: null, projects: PROJECTS });

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.hover(
      await screen.findByRole("menuitem", { name: "Add to project" }),
    );

    const item = await screen.findByRole("menuitem", { name: "New project" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
  });

  it("filed chat: picking a different project refiles the chat", async () => {
    const user = userEvent.setup();
    renderChatItem({ projectId: "proj-1", projects: PROJECTS });

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.hover(
      await screen.findByRole("menuitem", { name: "Change project" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Research" }),
    );

    const request = await findRequest(
      fetchMock,
      "PATCH",
      "/api/v1/chats/chat-1",
    );
    await expect(request.json()).resolves.toEqual({ projectId: "proj-2" });
  });
});

describe("ChatItem — activity indicator (design's chatStatusEl)", () => {
  it("renders the unread badge when the chat has an unseen background completion", async () => {
    const { queryClient } = renderChatItem({
      trackedRuns: [{ runId: "run-1", chatId: "chat-1", title: "My chat" }],
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Generating response")).toBeTruthy(),
    );

    queryClient.setQueryData(activeRunsQueryKeys.run("run-1"), {
      id: "run-1",
      status: "completed",
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Unread reply")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Generating response")).toBeNull();
  });

  it("renders the processing badge while a run is active for the chat", async () => {
    renderChatItem({
      trackedRuns: [{ runId: "run-1", chatId: "chat-1", title: "My chat" }],
    });

    expect(await screen.findByLabelText("Generating response")).toBeTruthy();
    expect(screen.queryByLabelText("Unread reply")).toBeNull();
  });

  it("renders no badge for an idle chat (neither unread nor processing)", () => {
    renderChatItem();

    expect(screen.queryByLabelText("Unread reply")).toBeNull();
    expect(screen.queryByLabelText("Generating response")).toBeNull();
  });

  it("prefers processing over unread when both are true for the same chat", async () => {
    const run1 = { runId: "run-1", chatId: "chat-1", title: "My chat" };
    const { queryClient, rerenderTrackedRuns } = renderChatItem({
      trackedRuns: [run1],
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Generating response")).toBeTruthy(),
    );

    // run-1 finishes (unseen completion, chat-1 -> completedChats)...
    queryClient.setQueryData(activeRunsQueryKeys.run("run-1"), {
      id: "run-1",
      status: "completed",
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Unread reply")).toBeTruthy(),
    );

    // ...while a second, still-generating run starts on the SAME chat (the
    // owner sent another message before reading the first reply) — real
    // ActiveRunsProvider semantics let a chat be in both sets at once.
    const run2 = { runId: "run-2", chatId: "chat-1", title: "My chat" };
    runStatusById["run-2"] = "running_model";
    rerenderTrackedRuns([run1, run2]);

    await waitFor(() =>
      expect(screen.getByLabelText("Generating response")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Unread reply")).toBeNull();
  });
});
