import { describe, expect, it } from "vitest";
import { isRedirectError } from "next/dist/client/components/redirect-error";

import AdminIndexPage from "./page";

describe("AdminIndexPage", () => {
  it("redirects to /admin/organizations — the only built admin section", () => {
    let caught: unknown;
    try {
      AdminIndexPage();
    } catch (error) {
      caught = error;
    }

    expect(isRedirectError(caught)).toBe(true);
    // SAFETY: isRedirectError narrowed `caught` to Next's redirect error
    // shape, which always carries the target on `.digest`.
    const digest = (caught as { digest: string }).digest;
    expect(digest).toContain("/admin/organizations");
  });
});
