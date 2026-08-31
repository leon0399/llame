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
  useUpdateProject,
} from "./mutations";
import { requestFromCall, stubFetch } from "../../test-support/fetch-stub";

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
