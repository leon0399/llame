// @vitest-environment jsdom

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { fetchMachines, machinesQueryKeys, useMachinesQuery } from "./queries";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "../../test-support/fetch-stub";
import {
  newTestQueryClient,
  wrapperWithClient,
} from "../../test-support/query-client";

const DEVL = {
  name: "devl",
  status: "offline",
  lastSeenAt: null,
  failureReason: "host_key_mismatch",
  hubProtocolVersion: 1,
  daemonProtocolVersion: null,
  daemonVersion: null,
  roots: ["/srv/projects"],
};

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("machines query keys", () => {
  it("keeps the resource-path keys", () => {
    expect(machinesQueryKeys.all).toEqual(["machines"]);
    expect(machinesQueryKeys.list()).toEqual(["machines", "list"]);
  });
});

describe("machines query transport", () => {
  it("reads the authenticated Machines list", async () => {
    fetchMock.mockResolvedValue(jsonResponse([DEVL]));

    await expect(fetchMachines()).resolves.toEqual([DEVL]);

    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("GET");
    expect(new URL(request.url).pathname).toBe("/api/v1/machines");
    expect(request.credentials).toBe("include");
  });

  it("treats an instance without the route as having no Machines", async () => {
    // No `machines` section means no Machine surface, not a failure to show.
    fetchMock.mockResolvedValue(jsonResponse({}, 404));

    await expect(fetchMachines()).resolves.toEqual([]);
  });

  it("propagates a real read failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 500));

    await expect(fetchMachines()).rejects.toThrow("GET /api/v1/machines");
  });

  it("reads once and does not poll: live messages keep the list current", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse([DEVL]));

    renderHook(() => useMachinesQuery(), {
      wrapper: wrapperWithClient(newTestQueryClient()),
    });

    // The first read: a mock promise settling on a microtask.
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stays off the network while disabled", async () => {
    const queryClient = newTestQueryClient();

    const { result } = renderHook(() => useMachinesQuery(false), {
      wrapper: wrapperWithClient(queryClient),
    });

    // React Query reports a disabled query as pending; the point here is that
    // no request was made for it.
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
