import { afterEach, describe, expect, it, vi } from "vitest";

const createProjectEndpoint = vi.hoisted(() => vi.fn());
const updateProjectEndpoint = vi.hoisted(() => vi.fn());
const deleteProjectEndpoint = vi.hoisted(() => vi.fn());
const updateChatEndpoint = vi.hoisted(() => vi.fn());
const authenticatedFetch = vi.hoisted(() => vi.fn());
const createAuthenticatedBrowserFetch = vi.hoisted(() => vi.fn());

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

import {
  createProject,
  deleteProject,
  fileChat,
  setProjectArchive,
  updateProject,
} from "./mutations";

createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);

afterEach(() => {
  vi.clearAllMocks();
  createAuthenticatedBrowserFetch.mockReturnValue(authenticatedFetch);
});

describe("createProject", () => {
  it("creates a project through the generated authenticated endpoint", async () => {
    createProjectEndpoint.mockResolvedValue({ id: "p1" });
    await createProject("Acme");
    expect(createProjectEndpoint).toHaveBeenCalledWith(
      { name: "Acme" },
      undefined,
      authenticatedFetch,
    );
  });
});

describe("updateProject", () => {
  it("renames a project through the generated authenticated endpoint", async () => {
    updateProjectEndpoint.mockResolvedValue({ id: "p1" });
    await updateProject("p1", "Renamed");
    expect(updateProjectEndpoint).toHaveBeenCalledWith(
      "p1",
      { name: "Renamed" },
      undefined,
      authenticatedFetch,
    );
  });
});

describe("setProjectArchive", () => {
  it("updates archive state through the generated authenticated endpoint", async () => {
    updateProjectEndpoint.mockResolvedValue({ id: "p1" });
    await setProjectArchive("p1", true);
    expect(updateProjectEndpoint).toHaveBeenCalledWith(
      "p1",
      { archived: true },
      undefined,
      authenticatedFetch,
    );
  });
});

describe("deleteProject", () => {
  it("deletes a project through the generated authenticated endpoint", async () => {
    deleteProjectEndpoint.mockResolvedValue(undefined);
    await deleteProject("p1");
    expect(deleteProjectEndpoint).toHaveBeenCalledWith(
      "p1",
      undefined,
      authenticatedFetch,
    );
  });

  it("swallows a 404 (already deleted) as success", async () => {
    deleteProjectEndpoint.mockRejectedValue({ status: 404, info: {} });
    await expect(deleteProject("gone")).resolves.toBeUndefined();
  });

  it("rethrows non-404 errors", async () => {
    const error = { status: 500, info: {} };
    deleteProjectEndpoint.mockRejectedValue(error);
    await expect(deleteProject("p1")).rejects.toBe(error);
  });
});

describe("fileChat", () => {
  it("updates the chat through the generated endpoint when filing it", async () => {
    updateChatEndpoint.mockResolvedValue(undefined);
    await fileChat("c1", "p1");
    expect(updateChatEndpoint).toHaveBeenCalledWith(
      "c1",
      { projectId: "p1" },
      undefined,
      authenticatedFetch,
    );
  });

  it("updates the chat with null when unfiling it", async () => {
    updateChatEndpoint.mockResolvedValue(undefined);
    await fileChat("c1", null);
    expect(updateChatEndpoint).toHaveBeenCalledWith(
      "c1",
      { projectId: null },
      undefined,
      authenticatedFetch,
    );
  });
});
