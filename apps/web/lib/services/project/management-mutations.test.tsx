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

const { post, patch, del } = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("../../api/client", () => ({
  api: { post, patch, delete: del },
  buildApiUrl: (path: string) => `http://api${path}`,
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

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  post.mockReset();
  patch.mockReset();
  del.mockReset();
  toastError.mockReset();
});

describe("useCreateProject", () => {
  it("toasts on failure instead of failing silently", async () => {
    post.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useCreateProject(), { wrapper });

    result.current.mutate("Acme");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't create the project.");
  });
});

describe("useUpdateProject", () => {
  it("toasts on failure instead of failing silently", async () => {
    patch.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useUpdateProject(), { wrapper });

    result.current.mutate({ id: "p1", name: "Renamed" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't rename the project.");
  });
});

describe("useDeleteProject", () => {
  it("toasts on failure instead of failing silently", async () => {
    del.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useDeleteProject(), { wrapper });

    result.current.mutate("p1");

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't delete the project.");
  });
});

describe("useFileChat", () => {
  it("toasts a move-specific message when filing into a project fails", async () => {
    patch.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useFileChat(), { wrapper });

    result.current.mutate({ chatId: "c1", projectId: "p1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith("Couldn't move the chat.");
  });

  it("toasts a remove-specific message when unfiling fails", async () => {
    patch.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useFileChat(), { wrapper });

    result.current.mutate({ chatId: "c1", projectId: null });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't remove the chat from its project.",
    );
  });
});
