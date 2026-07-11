// @vitest-environment jsdom

/**
 * Render-level proof for the sidebar's "Fork" (clone-whole-chat) menu item:
 * it renders, and selecting it fires the fork mutation with NO anchor
 * (fromMessageId omitted), then navigates to the new chat — mirroring
 * message-fork-button.test.tsx's coverage of the per-message fork action.
 */

import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SidebarMenu, SidebarProvider } from "@workspace/ui/components/sidebar";

const mutateMock = vi.fn();
const routerPushMock = vi.fn();
const fileChatMutateMock = vi.fn();

vi.mock("@/lib/services/chat/fork", () => ({
  useForkChat: () => ({ mutate: mutateMock, isPending: false }),
}));
vi.mock("@/lib/services/project/mutations", () => ({
  useFileChat: () => ({ mutate: fileChatMutateMock, isPending: false }),
  // Pulled in by the submenu's NewProjectDialog; not exercised beyond render.
  useCreateProject: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: routerPushMock }),
}));
// ChatItem reads completedChats/activeChatIds (the activity indicator) from
// this context; isolate the test from ActiveRunsProvider's real
// polling/fetch effects, matching this file's existing hook-mocking
// convention. Mutable so individual tests can vary which chats are
// unread/processing.
let mockCompletedChats = new Set<string>();
let mockActiveChatIds = new Set<string>();
vi.mock("@/contexts/active-runs-context", () => ({
  useActiveRuns: () => ({
    completedChats: mockCompletedChats,
    activeChatIds: mockActiveChatIds,
  }),
}));

import { ChatItem } from "./chat-item";

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

  // jsdom doesn't implement the Pointer Events capture API Radix's
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
});

function renderChatItem({
  projectId = null,
  projects,
}: {
  projectId?: string | null;
  projects?: { id: string; name: string }[];
} = {}) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <SidebarMenu>
          <ChatItem
            chat={{
              id: "chat-1",
              title: "My chat",
              lastMessage: null,
              visibility: "private",
              pinnedAt: null,
              projectId,
            }}
            onSelect={vi.fn()}
            // Only id/name are read by the submenu; cast keeps the fixture
            // free of ProjectResponse's timestamp noise.
            projects={
              projects as React.ComponentProps<typeof ChatItem>["projects"]
            }
          />
        </SidebarMenu>
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mutateMock.mockReset();
  routerPushMock.mockReset();
  fileChatMutateMock.mockReset();
  mockCompletedChats = new Set();
  mockActiveChatIds = new Set();
  cleanup();
});

describe("ChatItem row menu — Fork (clone whole chat)", () => {
  it("opens the row menu and renders a Fork item", async () => {
    const user = userEvent.setup();
    renderChatItem();

    await user.click(screen.getByRole("button", { name: /more/i }));

    expect(await screen.findByRole("menuitem", { name: "Fork" })).toBeTruthy();
  });

  it("fires the fork mutation with NO fromMessageId and navigates on success", async () => {
    const user = userEvent.setup();
    renderChatItem();

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.click(await screen.findByRole("menuitem", { name: "Fork" }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const [args, opts] = mutateMock.mock.calls[0] as [
      { chatId: string; fromMessageId?: string },
      { onSuccess: (forked: { id: string }) => void },
    ];
    expect(args).toEqual({ chatId: "chat-1" });
    expect("fromMessageId" in args).toBe(false);

    opts.onSuccess({ id: "cloned-chat-9" });
    expect(routerPushMock).toHaveBeenCalledWith("/chat/cloned-chat-9");
  });
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
    // re-triggers Radix's submenu hover tracking under jsdom's zero-geometry
    // and closes the submenu before pointerup lands (same workaround as
    // message-fork-button.test.tsx).
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Research" }),
    );

    expect(fileChatMutateMock).toHaveBeenCalledWith({
      chatId: "chat-1",
      projectId: "proj-2",
    });
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

    expect(fileChatMutateMock).toHaveBeenCalledWith({
      chatId: "chat-1",
      projectId: null,
    });
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

  it('offers a "New project" item below the list that opens the create dialog', async () => {
    const user = userEvent.setup();
    renderChatItem({ projectId: null, projects: PROJECTS });

    await user.click(screen.getByRole("button", { name: /more/i }));
    await user.hover(
      await screen.findByRole("menuitem", { name: "Add to project" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New project" }),
    );

    // Deferred open (setTimeout 0), same as the Rename dialog.
    expect(
      await screen.findByRole("heading", { name: "New project" }),
    ).toBeTruthy();
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

    expect(fileChatMutateMock).toHaveBeenCalledWith({
      chatId: "chat-1",
      projectId: "proj-2",
    });
  });
});

describe("ChatItem — activity indicator (design's chatStatusEl)", () => {
  it("renders the unread badge when the chat has an unseen background completion", () => {
    mockCompletedChats = new Set(["chat-1"]);
    renderChatItem();

    expect(screen.getByLabelText("Unread reply")).toBeTruthy();
    expect(screen.queryByLabelText("Generating response")).toBeNull();
  });

  it("renders the processing badge while a run is active for the chat", () => {
    mockActiveChatIds = new Set(["chat-1"]);
    renderChatItem();

    expect(screen.getByLabelText("Generating response")).toBeTruthy();
    expect(screen.queryByLabelText("Unread reply")).toBeNull();
  });

  it("renders no badge for an idle chat (neither unread nor processing)", () => {
    renderChatItem();

    expect(screen.queryByLabelText("Unread reply")).toBeNull();
    expect(screen.queryByLabelText("Generating response")).toBeNull();
  });

  it("prefers processing over unread when both are true for the same chat", () => {
    mockCompletedChats = new Set(["chat-1"]);
    mockActiveChatIds = new Set(["chat-1"]);
    renderChatItem();

    expect(screen.getByLabelText("Generating response")).toBeTruthy();
    expect(screen.queryByLabelText("Unread reply")).toBeNull();
  });
});
