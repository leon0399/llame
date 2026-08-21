// @vitest-environment jsdom

/**
 * Mutation-hook-level coverage: a failed create/rename/delete/file must
 * surface a toast, not fail silently — same convention as
 * ../chat/management-mutations.test.tsx.
 */

import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const createProjectEndpoint = vi.hoisted(() => vi.fn());
const updateProjectEndpoint = vi.hoisted(() => vi.fn());
const deleteProjectEndpoint = vi.hoisted(() => vi.fn());
const updateChatEndpoint = vi.hoisted(() => vi.fn());
const authenticatedFetch = vi.hoisted(() => vi.fn());
const createAuthenticatedBrowserFetch = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock("../../api/generated/projects/projects", () => ({
  createProject: createProjectEndpoint,
  updateProject: updateProjectEndpoint,
  deleteProject: deleteProjectEndpoint,
}));
vi.mock("../../api/generated/chats/chats", () => ({
  updateChat: updateChatEndpoint,
}));
vi.mock("../../api/fetch", () => ({
  createAuthenticatedBrowserFetch,
}));
vi.mock("@workspace/ui/components/sonner", () => ({
  toast: { error: toastError },
}));

import {
  useCreateProject,
  useDeleteProject,
  useFileChat,
  useUpdateProject,
} from "./mutations";

createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
  createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
});

describe("useCreateProject", () => {
  it("toasts on failure instead of failing silently", async () => {
    createProjectEndpoint.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useCreateProject(), { wrapper });

    result.current.mutate("Acme");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't create the project.");
    expect(createProjectEndpoint).toHaveBeenCalledWith(
      { name: "Acme" },
      undefined,
      authenticatedFetch,
    );
  });
});

describe("useUpdateProject", () => {
  it("toasts on failure instead of failing silently", async () => {
    updateProjectEndpoint.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useUpdateProject(), { wrapper });

    result.current.mutate({ id: "p1", name: "Renamed" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't rename the project.");
    expect(updateProjectEndpoint).toHaveBeenCalledWith(
      "p1",
      { name: "Renamed" },
      undefined,
      authenticatedFetch,
    );
  });
});

describe("useDeleteProject", () => {
  it("toasts on failure instead of failing silently", async () => {
    deleteProjectEndpoint.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useDeleteProject(), { wrapper });

    result.current.mutate("p1");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't delete the project.");
    expect(deleteProjectEndpoint).toHaveBeenCalledWith(
      "p1",
      undefined,
      authenticatedFetch,
    );
  });
});

describe("useFileChat", () => {
  it("toasts a move-specific message when filing into a project fails", async () => {
    updateChatEndpoint.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useFileChat(), { wrapper });

    result.current.mutate({ chatId: "c1", projectId: "p1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't move the chat.");
    expect(updateChatEndpoint).toHaveBeenCalledWith(
      "c1",
      { projectId: "p1" },
      undefined,
      authenticatedFetch,
    );
  });

  it("toasts a remove-specific message when unfiling fails", async () => {
    updateChatEndpoint.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useFileChat(), { wrapper });

    result.current.mutate({ chatId: "c1", projectId: null });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't remove the chat from its project.",
    );
    expect(updateChatEndpoint).toHaveBeenCalledWith(
      "c1",
      { projectId: null },
      undefined,
      authenticatedFetch,
    );
  });
});
