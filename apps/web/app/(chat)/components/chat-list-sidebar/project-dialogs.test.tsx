// @vitest-environment jsdom

/**
 * DOM-level coverage for the project create/rename/delete dialogs and the
 * chat-filing create flow (CreateProjectForChatDialog). Every mutation hook
 * runs for real against a stubbed globalThis.fetch — a click is proved by
 * the actual request it sends.
 */

import type { ReactElement } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Mock } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  emptyResponse,
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";

import {
  CreateProjectForChatDialog,
  DeleteProjectDialog,
  NewProjectDialog,
  RenameProjectDialog,
} from "./project-dialogs";

let fetchMock: Mock<typeof fetch>;
let queryClient: QueryClient;

const project = { id: "p1", name: "Acme relaunch" };

beforeAll(() => {
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
});

beforeEach(() => {
  fetchMock = stubFetch();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function nameFieldValue(): string {
  // SAFETY: resolved via getByLabelText on the dialog's own <Input>, always
  // an HTMLInputElement.
  return (screen.getByLabelText("Project name") as HTMLInputElement).value;
}

function renderWithClient(node: ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

describe("NewProjectDialog", () => {
  it("resets the name field each time it opens, then POSTs on submit", async () => {
    fetchMock.mockResolvedValue(jsonResponse(project));
    const onOpenChange = vi.fn();
    const { rerender } = renderWithClient(
      <NewProjectDialog open={false} onOpenChange={onOpenChange} />,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <NewProjectDialog open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    expect(nameFieldValue()).toBe("");

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "New Co" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects");
    await expect(request.clone().json()).resolves.toEqual({ name: "New Co" });
  });

  it("blank/whitespace-only name never triggers a mutation, even via Enter", () => {
    renderWithClient(<NewProjectDialog open onOpenChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "   " },
    });
    fireEvent.keyDown(screen.getByLabelText("Project name"), { key: "Enter" });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CreateProjectForChatDialog", () => {
  it("opens only when chatId is non-null, and files the chat into the created project", async () => {
    fetchMock.mockImplementation(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const { pathname } = new URL(request.url);
      if (pathname === "/api/v1/projects") return jsonResponse(project);
      if (pathname === "/api/v1/chats/c1") return emptyResponse();
      throw new Error(`unrouted fetch: ${pathname}`);
    });

    const { rerender } = renderWithClient(
      <CreateProjectForChatDialog chatId={null} onClose={vi.fn()} />,
    );
    expect(screen.queryByText("New project")).toBeNull();

    rerender(
      <QueryClientProvider client={queryClient}>
        <CreateProjectForChatDialog chatId="c1" onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("New project")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "New Co" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([req]) =>
            req instanceof Request &&
            req.method === "PATCH" &&
            new URL(req.url).pathname === "/api/v1/chats/c1",
        ),
      ).toBe(true),
    );
    const fileRequest = fetchMock.mock.calls
      .map(([req]) => req)
      .find(
        (req): req is Request =>
          req instanceof Request && req.method === "PATCH",
      )!;
    await expect(fileRequest.clone().json()).resolves.toEqual({
      projectId: "p1",
    });
  });

  it("calls onClose when the dialog is dismissed without creating", () => {
    const onClose = vi.fn();
    renderWithClient(
      <CreateProjectForChatDialog chatId="c1" onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe("RenameProjectDialog", () => {
  it("Save with an unchanged name closes without a mutation", () => {
    const onOpenChange = vi.fn();
    renderWithClient(
      <RenameProjectDialog
        project={project}
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Save with a changed name PATCHes and closes on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...project, name: "Renamed" }));
    const onOpenChange = vi.fn();
    renderWithClient(
      <RenameProjectDialog
        project={project}
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects/p1");
  });

  it("resets the field to the CURRENT project name each time it reopens", () => {
    const { rerender } = renderWithClient(
      <RenameProjectDialog
        project={project}
        open={false}
        onOpenChange={vi.fn()}
      />,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <RenameProjectDialog
          project={{ ...project, name: "Updated elsewhere" }}
          open
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(nameFieldValue()).toBe("Updated elsewhere");
  });
});

describe("DeleteProjectDialog", () => {
  it("confirming deletion DELETEs the project and closes on success", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    const onOpenChange = vi.fn();
    renderWithClient(
      <DeleteProjectDialog
        project={project}
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects/p1");
  });
});
