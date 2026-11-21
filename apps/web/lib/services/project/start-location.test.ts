import { describe, expect, it } from "vitest";

import type {
  CheckoutResponse,
  MachineResponse,
  StartLocationResponse,
} from "../../api/generated/models";
import {
  executorLabel,
  executorOptions,
  resolveLocation,
  type ResolvedLocation,
} from "./start-location";

const AT = "2026-01-01T00:00:00.000Z";

function checkout(
  id: string,
  overrides: Partial<CheckoutResponse> = {},
): CheckoutResponse {
  const executorId = overrides.executorId ?? "host";

  return {
    id,
    repositoryId: "repo-1",
    executorId,
    path: `machine://${executorId}/home/leo/src/llame-${id}`,
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
    facts: null,
    factsCapturedAt: null,
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
    executorId: "host",
    checkoutId: "c1",
    isolation: "reuse",
    isolationReason: "project_policy",
    isolationChats: 0,
    ...overrides,
  };
}

const CHECKOUTS = [checkout("c1")];

describe("executorOptions", () => {
  it("groups the repository's main checkouts per Machine and sorts by label", () => {
    const options = executorOptions({
      repositoryId: "repo-1",
      checkouts: [
        checkout("c1"),
        checkout("c2"),
        checkout("c3", { executorId: "nas" }),
        checkout("w1", { kind: "worktree" }),
        checkout("c4", { repositoryId: "repo-2" }),
      ],
      machines: [machine("host"), machine("nas")],
    });

    expect(options).toEqual([
      { executorId: "host", label: "host", mainCheckouts: 2, reason: null },
      { executorId: "nas", label: "nas", mainCheckouts: 1, reason: null },
    ]);
  });

  it("disables an offline Machine and names its failure", () => {
    const [option] = executorOptions({
      repositoryId: "repo-1",
      checkouts: [checkout("c1", { executorId: "nas" })],
      machines: [
        machine("nas", {
          status: "offline",
          failureReason: "host_key_mismatch",
        }),
      ],
    });

    expect(option).toEqual({
      executorId: "nas",
      label: "nas",
      mainCheckouts: 1,
      reason: "Offline — Host key does not match",
    });
  });

  it("names a Machine the configuration no longer provides", () => {
    const [option] = executorOptions({
      repositoryId: "repo-1",
      checkouts: [checkout("c1", { executorId: "gone" })],
      machines: [],
    });

    expect(option.label).toBe("gone");
    expect(option.reason).toBe("This Machine is not configured.");
  });

  it("keeps a Machine startable until the list answers", () => {
    const [option] = executorOptions({
      repositoryId: "repo-1",
      checkouts: [checkout("c1")],
      machines: undefined,
    });

    expect(option).toEqual({
      executorId: "host",
      label: "host",
      mainCheckouts: 1,
      reason: null,
    });
  });

  it("uses a failed create's reason ahead of the Machine's status", () => {
    const [option] = executorOptions({
      repositoryId: "repo-1",
      checkouts: [checkout("c1", { executorId: "nas" })],
      machines: [machine("nas")],
      unavailable: {
        executorId: "nas",
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

function resolve(
  overrides: Partial<Parameters<typeof resolveLocation>[0]> = {},
): ResolvedLocation {
  return resolveLocation({
    preview: preview(),
    previewFailed: false,
    checkouts: CHECKOUTS,
    machines: [machine("host")],
    failed: null,
    ...overrides,
  });
}

describe("resolveLocation", () => {
  it("resolves the preview's ids against the owner's rows", () => {
    const location = resolve();

    expect(location.executor?.label).toBe("host");
    expect(location.checkout?.id).toBe("c1");
    expect(location.isolation).toBe("reuse");
    expect(location.warning).toBeNull();
  });

  it("treats a project without a repository, or a repository without a checkout, as an ordinary start", () => {
    // No link, several links with no primary, and a link no Machine holds a
    // checkout of all preview no checkout, which creates an unbound chat.
    expect(
      resolve({
        preview: preview({
          repositoryId: null,
          executorId: null,
          checkoutId: null,
        }),
      }).warning,
    ).toBeNull();
    expect(
      resolve({ preview: preview({ executorId: null, checkoutId: null }) })
        .warning,
    ).toBeNull();
  });

  it("warns about an offline Machine by name and reason", () => {
    const location = resolve({
      preview: preview({ executorId: "nas" }),
      checkouts: [checkout("c1", { executorId: "nas" })],
      machines: [machine("host"), machine("nas", { status: "offline" })],
    });

    expect(location.warning).toEqual({
      step: "machine",
      message: "nas: Offline",
    });
  });

  it("names a failed create's Workspace status", () => {
    const location = resolve({
      preview: preview({ executorId: "nas" }),
      checkouts: [checkout("c1", { executorId: "nas" })],
      machines: [machine("host"), machine("nas")],
      failed: { status: "machine_update_required", executorId: "nas" },
    });

    expect(location.warning?.step).toBe("machine");
    expect(location.warning?.message).toContain("Update the llame-machine");
    expect(location.executor?.reason).toContain("Update the llame-machine");
  });

  it("names a mismatched Machine identity and disables the Machine with it", () => {
    const location = resolve({
      preview: preview({ executorId: "machine:nas" }),
      checkouts: [checkout("c1", { executorId: "machine:nas" })],
      machines: [machine("nas")],
      failed: {
        status: "machine_identity_mismatch",
        executorId: "machine:nas",
      },
    });

    expect(location.warning?.step).toBe("machine");
    expect(location.warning?.message).toContain("machines:forget");
    expect(location.executor?.reason).toContain("machines:forget");
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
  it("names the Machine's row, else the id itself", () => {
    expect(executorLabel("nas", [machine("nas")])).toBe("nas");
    expect(executorLabel("host", [machine("host")])).toBe("host");
    expect(executorLabel("builder", [machine("nas")])).toBe("builder");
    expect(executorLabel("nas", undefined)).toBe("nas");
    expect(executorLabel("NAS", [machine("nas")])).toBe("nas");
  });
});
