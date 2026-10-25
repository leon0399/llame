import { describe, expect, it } from "vitest";

import type {
  CheckoutResponse,
  MachineResponse,
  RepositoryResponse,
  StartLocationResponse,
} from "../../api/generated/models";
import type { ProjectRepositoryLink } from "./types";
import {
  executorLabel,
  executorOptions,
  isolationReasonLabel,
  machineNameFromExecutorId,
  resolveLocation,
  type ResolvedLocation,
} from "./start-location";

const AT = "2026-01-01T00:00:00.000Z";

function link(
  overrides: Partial<ProjectRepositoryLink> & { repositoryId: string },
): ProjectRepositoryLink {
  return {
    id: `link-${overrides.repositoryId}`,
    ownerUserId: "u1",
    projectId: "p1",
    alias: "llame",
    isPrimary: false,
    isolation: "inherit",
    defaults: [],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function repository(id: string, displayName: string): RepositoryResponse {
  return {
    id,
    ownerUserId: "u1",
    displayName,
    canonicalRemote: `git@example.com:leo/${id}.git`,
    createdAt: AT,
    updatedAt: AT,
  };
}

function checkout(
  id: string,
  overrides: Partial<CheckoutResponse> = {},
): CheckoutResponse {
  return {
    id,
    repositoryId: "repo-1",
    executorId: "local",
    path: `/home/leo/src/llame-${id}`,
    kind: "main",
    parentCheckoutId: null,
    branch: "main",
    origin: "registered",
    worktreeBase: null,
    chatIds: [],
    leaseChatId: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function machine(
  name: string,
  overrides: Partial<MachineResponse> = {},
): MachineResponse {
  return {
    name,
    status: "online",
    lastSeenAt: AT,
    failureReason: null,
    hubProtocolVersion: 1,
    daemonProtocolVersion: 1,
    daemonVersion: "0.1.0",
    roots: ["/srv/src"],
    ...overrides,
  };
}

function preview(
  overrides: Partial<StartLocationResponse> = {},
): StartLocationResponse {
  return {
    projectId: "p1",
    repositoryId: "repo-1",
    executorId: "local",
    checkoutId: "c1",
    isolation: "reuse",
    isolationReason: "project_policy",
    isolationChats: 0,
    ...overrides,
  };
}

const LINKS = [
  link({ repositoryId: "repo-1", alias: "llame", isPrimary: true }),
];
const REPOSITORIES = [repository("repo-1", "llame")];
const CHECKOUTS = [checkout("c1")];

describe("machineNameFromExecutorId", () => {
  it("reads the Machine name and nothing from the local executor", () => {
    expect(machineNameFromExecutorId("machine:nas")).toBe("nas");
    expect(machineNameFromExecutorId("machine:")).toBeUndefined();
    expect(machineNameFromExecutorId("local")).toBeUndefined();
  });
});

describe("executorOptions", () => {
  it("groups the repository's main checkouts per executor and sorts by label", () => {
    const options = executorOptions({
      repositoryId: "repo-1",
      checkouts: [
        checkout("c1"),
        checkout("c2"),
        checkout("c3", { executorId: "machine:nas" }),
        checkout("w1", { kind: "worktree", executorId: "local" }),
        checkout("c4", { repositoryId: "repo-2" }),
      ],
      machines: [machine("nas")],
    });

    expect(options).toEqual([
      { executorId: "local", label: "local", mainCheckouts: 2, reason: null },
      {
        executorId: "machine:nas",
        label: "nas",
        mainCheckouts: 1,
        reason: null,
      },
    ]);
  });

  it("disables an offline Machine and names its failure", () => {
    const [option] = executorOptions({
      repositoryId: "repo-1",
      checkouts: [checkout("c1", { executorId: "machine:nas" })],
      machines: [
        machine("nas", {
          status: "offline",
          failureReason: "host_key_mismatch",
        }),
      ],
    });

    expect(option).toEqual({
      executorId: "machine:nas",
      label: "nas",
      mainCheckouts: 1,
      reason: "Offline — Host key does not match",
    });
  });

  it("names a Machine the configuration no longer provides", () => {
    const [option] = executorOptions({
      repositoryId: "repo-1",
      checkouts: [checkout("c1", { executorId: "machine:gone" })],
      machines: [],
    });

    expect(option.reason).toBe("This Machine is not configured.");
  });

  it("uses a failed create's reason ahead of the Machine's status", () => {
    const [option] = executorOptions({
      repositoryId: "repo-1",
      checkouts: [checkout("c1", { executorId: "machine:nas" })],
      machines: [machine("nas")],
      unavailable: {
        executorId: "machine:nas",
        reason: "Update the llame-machine daemon on that Machine.",
      },
    });

    expect(option.reason).toBe(
      "Update the llame-machine daemon on that Machine.",
    );
  });

  it("offers nothing without a resolved repository", () => {
    expect(
      executorOptions({
        repositoryId: null,
        checkouts: CHECKOUTS,
        machines: [],
      }),
    ).toEqual([]);
  });
});

describe("isolationReasonLabel", () => {
  it("labels each preview reason and a changed value", () => {
    expect(isolationReasonLabel("reuse", "project_policy", 0, true)).toBe(
      "reuse (project policy)",
    );
    expect(isolationReasonLabel("worktree", "clone_in_use", 1, true)).toBe(
      "worktree (clone in use by 1 chat)",
    );
    expect(isolationReasonLabel("worktree", "clone_in_use", 2, true)).toBe(
      "worktree (clone in use by 2 chats)",
    );
    expect(isolationReasonLabel("reuse", "no_link", 0, true)).toBe(
      "reuse (no linked repository)",
    );
    expect(isolationReasonLabel("reuse", "project_policy", 0, false)).toBe(
      "reuse (your choice)",
    );
  });
});

function resolve(
  overrides: Partial<Parameters<typeof resolveLocation>[0]> = {},
): ResolvedLocation {
  return resolveLocation({
    preview: preview(),
    previewFailed: false,
    pending: false,
    links: LINKS,
    repositories: REPOSITORIES,
    checkouts: CHECKOUTS,
    machines: [],
    failed: null,
    ...overrides,
  });
}

describe("resolveLocation", () => {
  it("resolves the preview's ids against the owner's rows", () => {
    const location = resolve();

    expect(location.repositoryLabel).toBe("llame");
    expect(location.executor?.label).toBe("local");
    expect(location.checkout?.id).toBe("c1");
    expect(location.isolation).toBe("reuse");
    expect(location.warning).toBeNull();
  });

  it("treats a project without a repository, or a repository without a checkout, as an ordinary start", () => {
    const unresolved = preview({
      repositoryId: null,
      executorId: null,
      checkoutId: null,
    });

    // No link, several links with no primary, and a link no Machine holds a
    // checkout of all create an unbound chat, which is a normal chat.
    expect(resolve({ preview: unresolved, links: [] }).warning).toBeNull();
    expect(
      resolve({
        preview: unresolved,
        links: [
          link({ repositoryId: "repo-1" }),
          link({ repositoryId: "repo-2", alias: "other" }),
        ],
      }).warning,
    ).toBeNull();
    expect(
      resolve({ preview: preview({ executorId: null, checkoutId: null }) })
        .warning,
    ).toBeNull();
  });

  it("warns about an offline Machine by name and reason", () => {
    const location = resolve({
      preview: preview({ executorId: "machine:nas" }),
      checkouts: [checkout("c1", { executorId: "machine:nas" })],
      machines: [machine("nas", { status: "offline" })],
    });

    expect(location.warning).toEqual({
      step: "machine",
      message: "nas: Offline",
    });
  });

  it("names a failed create's Workspace status", () => {
    const location = resolve({
      preview: preview({ executorId: "machine:nas" }),
      checkouts: [checkout("c1", { executorId: "machine:nas" })],
      machines: [machine("nas")],
      failed: { status: "machine_update_required", executorId: "machine:nas" },
    });

    expect(location.warning?.step).toBe("machine");
    expect(location.warning?.message).toContain("Update the llame-machine");
    expect(location.executor?.reason).toContain("Update the llame-machine");
  });

  it("reports a preview failure", () => {
    const location = resolve({
      preview: undefined,
      previewFailed: true,
    });

    expect(location.warning).toEqual({
      step: "preview",
      message: "Could not resolve the start location.",
    });
  });
});

describe("executorLabel", () => {
  it("names a Machine, falls back to its configured name, then the id", () => {
    expect(executorLabel("machine:nas", [machine("nas")])).toBe("nas");
    expect(executorLabel("machine:builder", [machine("nas")])).toBe("builder");
    // The local executor has no Machine name, so its id is the label.
    expect(executorLabel("local", [machine("nas")])).toBe("local");
    expect(executorLabel("machine:nas", undefined)).toBe("nas");
  });
});
