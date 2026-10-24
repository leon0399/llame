import { describe, expect, it } from "vitest";

import type { CheckoutResponse } from "../../api/generated/models";
import {
  prefillFromSearchParams,
  projectStartPath,
  projectStartRedirect,
  startLocationDeepLink,
  startLocationFromRoot,
} from "./start-location-link";

const AT = "2026-01-01T00:00:00.000Z";

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

/** The parameters a URL carries, as the browser-side reader sees them. */
function queryOf(href: string) {
  return new URL(href, "https://llame.test").searchParams;
}

describe("startLocationDeepLink", () => {
  it("writes the project and every pre-filled level in one fixed order", () => {
    expect(
      startLocationDeepLink({
        projectId: "p1",
        repositoryId: "repo-1",
        executorId: "machine:nas",
        checkoutId: "c1",
        worktree: true,
      }),
    ).toBe(
      "/chat/new?project=p1&repository=repo-1&executor=machine%3Anas&checkout=c1&worktree=1",
    );
  });

  it("is bare /chat/new when nothing is named", () => {
    expect(startLocationDeepLink()).toBe("/chat/new");
    expect(startLocationDeepLink({ worktree: false })).toBe("/chat/new");
  });

  it("names only the project for a project's own entry point", () => {
    expect(startLocationDeepLink({ projectId: "p1" })).toBe(
      "/chat/new?project=p1",
    );
  });

  it("drops a blank level instead of writing an empty parameter", () => {
    expect(
      startLocationDeepLink({
        projectId: "p1",
        repositoryId: "  ",
        checkoutId: "c1",
      }),
    ).toBe("/chat/new?project=p1&checkout=c1");
  });
});

describe("prefillFromSearchParams", () => {
  it("reads the selection and the worktree ask back from the deep link", () => {
    const params = queryOf(
      startLocationDeepLink({
        projectId: "p1",
        repositoryId: "repo-1",
        executorId: "machine:nas",
        checkoutId: "c1",
        worktree: true,
      }),
    );

    expect(prefillFromSearchParams(params)).toEqual({
      selection: {
        repositoryId: "repo-1",
        executorId: "machine:nas",
        checkoutId: "c1",
      },
      isolation: "worktree",
    });
  });

  it("leaves the isolation to the preview unless the link asks for one", () => {
    const params = queryOf(startLocationDeepLink({ repositoryId: "repo-1" }));

    expect(prefillFromSearchParams(params)).toEqual({
      selection: { repositoryId: "repo-1" },
      isolation: null,
    });
  });

  it("reads an explicit reuse ask and ignores an unknown value", () => {
    expect(prefillFromSearchParams(new URLSearchParams("worktree=0"))).toEqual({
      selection: {},
      isolation: "reuse",
    });
    expect(prefillFromSearchParams(new URLSearchParams("worktree=yes"))).toBe(
      null,
    );
  });

  it("is null when the URL asks for no level", () => {
    expect(
      prefillFromSearchParams(new URLSearchParams("project=p1")),
    ).toBeNull();
    expect(prefillFromSearchParams(new URLSearchParams())).toBeNull();
  });
});

describe("projectStartPath", () => {
  it("keeps the pre-fill on the project's own URL", () => {
    expect(
      projectStartPath("p1", {
        selection: { repositoryId: "repo-1", checkoutId: "c1" },
        isolation: "worktree",
      }),
    ).toBe("/projects/p1?repository=repo-1&checkout=c1&worktree=1");
  });

  it("is the bare project page without a pre-fill", () => {
    expect(projectStartPath("p1", null)).toBe("/projects/p1");
  });
});

describe("projectStartRedirect", () => {
  it("forwards a named project with its pre-fill", () => {
    expect(
      projectStartRedirect({
        project: "p1",
        repository: "repo-1",
        executor: "local",
        checkout: "c1",
        worktree: "1",
      }),
    ).toBe(
      "/projects/p1?repository=repo-1&executor=local&checkout=c1&worktree=1",
    );
  });

  it("reads the first value of a repeated parameter", () => {
    expect(
      projectStartRedirect({ project: ["p1", "p2"], checkout: ["c1", "c2"] }),
    ).toBe("/projects/p1?checkout=c1");
  });

  it("has no destination without a project", () => {
    expect(projectStartRedirect({ repository: "repo-1" })).toBeNull();
    expect(projectStartRedirect({ project: "  " })).toBeNull();
  });
});

describe("startLocationFromRoot", () => {
  it("copies a main checkout and asks for a worktree of it", () => {
    expect(
      startLocationFromRoot("/home/leo/src/llame-c1", [
        checkout("c1", { path: "/home/leo/src/llame-c1" }),
      ]),
    ).toEqual({
      repositoryId: "repo-1",
      executorId: "local",
      checkoutId: "c1",
      worktree: true,
    });
  });

  it("copies a worktree root's source main checkout", () => {
    expect(
      startLocationFromRoot("/home/leo/.llame-worktrees/llame/clear-field", [
        checkout("c1", { path: "/home/leo/src/llame-c1" }),
        checkout("w1", {
          kind: "worktree",
          path: "/home/leo/.llame-worktrees/llame/clear-field",
          parentCheckoutId: "c1",
          branch: "llame/clear-field",
        }),
      ]),
    ).toEqual({
      repositoryId: "repo-1",
      executorId: "local",
      checkoutId: "c1",
      worktree: true,
    });
  });

  it("asks for a worktree even when the catalog does not hold the root", () => {
    expect(
      startLocationFromRoot("/srv/src/unregistered", [checkout("c1")]),
    ).toEqual({ worktree: true });
  });

  it("asks for nothing on a chat bound to nothing", () => {
    expect(startLocationFromRoot(null, [checkout("c1")])).toEqual({
      worktree: false,
    });
  });
});
