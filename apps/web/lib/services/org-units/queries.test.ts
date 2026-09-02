// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import {
  fetchMemberships,
  fetchMyEffectiveRole,
  fetchOrgUnits,
  orgUnitsQueryKeys,
  useMembershipsQuery,
  useMyEffectiveRoleQuery,
  useOrgUnitsQuery,
} from "./queries";
import { OrgUnitsApiError } from "./errors";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "../../test-support/query-client";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("orgUnitsQueryKeys", () => {
  it("builds serializable resource-path keys", () => {
    expect(orgUnitsQueryKeys.all).toEqual(["org-units"]);
    expect(orgUnitsQueryKeys.lists()).toEqual(["org-units", "list"]);
    expect(orgUnitsQueryKeys.detail("u1")).toEqual(["org-units", "u1"]);
    expect(orgUnitsQueryKeys.memberships("u1")).toEqual([
      "org-units",
      "u1",
      "memberships",
    ]);
    expect(orgUnitsQueryKeys.myRole("u1")).toEqual(["org-units", "u1", "me"]);
  });
});

describe("fetchOrgUnits", () => {
  it("GETs /org-units through the authenticated policy", async () => {
    const units = [{ id: "u1", name: "Acme" }];
    fetchMock.mockResolvedValue(jsonResponse(units));

    await expect(fetchOrgUnits()).resolves.toEqual(units);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/org-units");
    expect(request.credentials).toBe("include");
  });
});

describe("fetchMemberships", () => {
  it("GETs /org-units/:id/memberships", async () => {
    const memberships = [{ id: "m1", userId: "u2", role: "member" }];
    fetchMock.mockResolvedValue(jsonResponse(memberships));

    await expect(fetchMemberships("u1")).resolves.toEqual(memberships);

    const request = requestFromCall(fetchMock);
    expect(new URL(request.url).pathname).toBe(
      "/api/v1/org-units/u1/memberships",
    );
  });
});

describe("fetchMyEffectiveRole", () => {
  it("GETs /org-units/:id/memberships/me and returns the role", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ role: "owner" }));

    await expect(fetchMyEffectiveRole("u1")).resolves.toEqual({
      role: "owner",
    });
    const request = requestFromCall(fetchMock);
    expect(new URL(request.url).pathname).toBe(
      "/api/v1/org-units/u1/memberships/me",
    );
  });

  it("maps a 404 to null instead of throwing (the no-membership-yet edge)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "not found" }, 404));

    await expect(fetchMyEffectiveRole("u1")).resolves.toBeNull();
  });

  it("classifies a non-404 failure into an OrgUnitsApiError instead of returning null", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "nope" }, 403));

    await expect(fetchMyEffectiveRole("u1")).rejects.toBeInstanceOf(
      OrgUnitsApiError,
    );
  });
});

describe("useOrgUnitsQuery", () => {
  it("resolves the list under the lists() key", async () => {
    const units = [{ id: "u1", name: "Acme" }];
    fetchMock.mockResolvedValue(jsonResponse(units));
    const queryClient = newTestQueryClient();

    const { result } = renderHook(() => useOrgUnitsQuery(), {
      wrapper: wrapperWithClient(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(units);
    expect(queryClient.getQueryData(orgUnitsQueryKeys.lists())).toEqual(units);
  });
});

describe("useMembershipsQuery", () => {
  it("stays disabled and never fetches when orgUnitId is undefined", () => {
    const queryClient = newTestQueryClient();

    const { result } = renderHook(() => useMembershipsQuery(undefined), {
      wrapper: wrapperWithClient(queryClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches memberships once an orgUnitId is provided", async () => {
    const memberships = [{ id: "m1", userId: "u2", role: "member" }];
    fetchMock.mockResolvedValue(jsonResponse(memberships));
    const queryClient = newTestQueryClient();

    const { result } = renderHook(() => useMembershipsQuery("u1"), {
      wrapper: wrapperWithClient(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(memberships);
  });
});

describe("useMyEffectiveRoleQuery", () => {
  it("stays disabled when orgUnitId is undefined", () => {
    const queryClient = newTestQueryClient();

    const { result } = renderHook(() => useMyEffectiveRoleQuery(undefined), {
      wrapper: wrapperWithClient(queryClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves null (not an error state) on a 404", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "not found" }, 404));
    const queryClient = newTestQueryClient();

    const { result } = renderHook(() => useMyEffectiveRoleQuery("u1"), {
      wrapper: wrapperWithClient(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
