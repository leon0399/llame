import { afterEach, describe, expect, it, vi } from "vitest";

const { post, patch, del } = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock("../../api/client", () => ({
  api: { post, patch, delete: del },
  buildApiUrl: (path: string) => `http://api${path}`,
}));

import {
  createProject,
  deleteProject,
  fileChat,
  updateProject,
} from "./mutations";

function jsonResolved<T>(value: T) {
  return { json: () => Promise.resolve(value) };
}

afterEach(() => {
  post.mockReset();
  patch.mockReset();
  del.mockReset();
});

describe("createProject", () => {
  it("POSTs /projects with the name", async () => {
    post.mockReturnValue(jsonResolved({ id: "p1" }));
    await createProject("Acme");
    expect(post).toHaveBeenCalledWith("http://api/api/v1/projects", {
      json: { name: "Acme" },
    });
  });
});

describe("updateProject", () => {
  it("PATCHes /projects/:id with the new name", async () => {
    patch.mockReturnValue(jsonResolved({ id: "p1" }));
    await updateProject("p1", "Renamed");
    expect(patch).toHaveBeenCalledWith("http://api/api/v1/projects/p1", {
      json: { name: "Renamed" },
    });
  });
});

describe("deleteProject", () => {
  it("DELETEs /projects/:id", async () => {
    del.mockResolvedValue(undefined);
    await deleteProject("p1");
    expect(del).toHaveBeenCalledWith("http://api/api/v1/projects/p1");
  });
});

describe("fileChat", () => {
  it("PATCHes /chats/:id with a project uuid to file the chat", async () => {
    patch.mockResolvedValue(undefined);
    await fileChat("c1", "p1");
    expect(patch).toHaveBeenCalledWith("http://api/api/v1/chats/c1", {
      json: { projectId: "p1" },
    });
  });

  it("PATCHes /chats/:id with null to unfile the chat", async () => {
    patch.mockResolvedValue(undefined);
    await fileChat("c1", null);
    expect(patch).toHaveBeenCalledWith("http://api/api/v1/chats/c1", {
      json: { projectId: null },
    });
  });
});
