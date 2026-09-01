// @vitest-environment jsdom

/**
 * Mutation-hook-level coverage: a failed create/rename/delete/file must
 * surface a toast, not fail silently — same convention as
 * ../chat/management-mutations.test.tsx.
 */

import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "@workspace/ui/components/sonner";

import {
  useCreateProject,
  useDeleteProject,
  useFileChat,
  useSetProjectArchive,
  useUpdateProject,
} from "./mutations";
import { projectQueryKeys } from "./queries";
import { chatQueryKeys } from "../chat/queries";
import { pinQueryKeys } from "../pins/queries";
import {
  emptyResponse,
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "../../test-support/query-client";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCreateProject", () => {
  it("toasts on failure instead of failing silently", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useCreateProject(), { wrapper });

    result.current.mutate("Acme");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith("Couldn't create the project.");
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects");
    await expect(request.clone().json()).resolves.toEqual({ name: "Acme" });
  });

  it("invalidates the project list on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "p1" }));
    const queryClient = newTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateProject(), {
      wrapper: wrapperWithClient(queryClient),
    });

    result.current.mutate("Acme");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.lists(),
    });
  });
});

describe("useUpdateProject", () => {
  it("toasts on failure instead of failing silently", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useUpdateProject(), { wrapper });

    result.current.mutate({ id: "p1", name: "Renamed" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith("Couldn't rename the project.");
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects/p1");
    await expect(request.clone().json()).resolves.toEqual({
      name: "Renamed",
    });
  });

  it("invalidates the project list and pins list on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "p1" }));
    const queryClient = newTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateProject(), {
      wrapper: wrapperWithClient(queryClient),
    });

    result.current.mutate({ id: "p1", name: "Renamed" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.lists(),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: pinQueryKeys.list(),
    });
  });
});

describe("useSetProjectArchive", () => {
  it("invalidates the project list and pins list on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "p1" }));
    const queryClient = newTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSetProjectArchive(), {
      wrapper: wrapperWithClient(queryClient),
    });

    result.current.mutate({ id: "p1", archived: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.lists(),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: pinQueryKeys.list(),
    });
  });

  it("toasts an archive-specific message on failure", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useSetProjectArchive(), { wrapper });

    result.current.mutate({ id: "p1", archived: true });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith("Couldn't archive the project.");
  });

  it("toasts an unarchive-specific message on failure", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useSetProjectArchive(), { wrapper });

    result.current.mutate({ id: "p1", archived: false });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Couldn't unarchive the project.",
    );
  });
});

describe("useDeleteProject", () => {
  it("toasts on failure instead of failing silently", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useDeleteProject(), { wrapper });

    result.current.mutate("p1");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith("Couldn't delete the project.");
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/api/v1/projects/p1");
  });

  it("invalidates the project list, chat list, and pins list on success", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    const queryClient = newTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteProject(), {
      wrapper: wrapperWithClient(queryClient),
    });

    result.current.mutate("p1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: projectQueryKeys.lists(),
    });
    // Deleting a project unfiles its chats server-side rather than deleting
    // them, so the chat list must refresh too (or they'd look vanished).
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: chatQueryKeys.lists(),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: pinQueryKeys.list(),
    });
  });
});

describe("useFileChat", () => {
  it("toasts a move-specific message when filing into a project fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useFileChat(), { wrapper });

    result.current.mutate({ chatId: "c1", projectId: "p1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith("Couldn't move the chat.");
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1");
    await expect(request.clone().json()).resolves.toEqual({
      projectId: "p1",
    });
  });

  it("toasts a remove-specific message when unfiling fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const toastErrorSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { result } = renderHook(() => useFileChat(), { wrapper });

    result.current.mutate({ chatId: "c1", projectId: null });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastErrorSpy).toHaveBeenCalledWith(
      "Couldn't remove the chat from its project.",
    );
    const request = requestFromCall(fetchMock);
    await expect(request.clone().json()).resolves.toEqual({
      projectId: null,
    });
  });
});
