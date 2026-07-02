import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProviderAccount,
  deleteProviderAccount,
  fetchProviderAccounts,
  providerQueryKeys,
} from "./queries";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** ky calls fetch(new Request(...)) — read from the Request, not (url, init). */
function requestOf(mock: ReturnType<typeof vi.fn<typeof fetch>>): Request {
  const [input] = mock.mock.calls[0]!;
  return input as Request;
}

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

describe("provider query keys", () => {
  it("namespaces list keys under provider-accounts", () => {
    expect(providerQueryKeys.lists()).toEqual(["provider-accounts", "list"]);
  });
});

describe("fetchProviderAccounts", () => {
  it("GETs the provider-accounts endpoint with credentials", async () => {
    const accounts = [{ id: "1", displayName: "OR" }];
    fetchMock.mockResolvedValue(jsonResponse(accounts));

    await expect(fetchProviderAccounts()).resolves.toEqual(accounts);
    const request = requestOf(fetchMock);
    expect(request.url).toContain("/api/v1/provider-accounts");
    expect(request.method).toBe("GET");
    expect(request.credentials).toBe("include");
  });
});

describe("createProviderAccount", () => {
  it("POSTs the account payload including the write-only key", async () => {
    // Read the request body inside the mock — the Request stream is intact
    // here (nothing has consumed it), avoiding a post-hoc .json() read that
    // hangs in the test environment.
    let sentBody: unknown;
    fetchMock.mockImplementation(async (input) => {
      sentBody = await (input as Request).clone().json();
      return jsonResponse({ id: "2" }, 201);
    });

    const input = {
      providerType: "openrouter" as const,
      displayName: "OR",
      apiKey: "sk-secret",
      defaultModel: "openai/gpt-5.4-mini",
    };
    await expect(createProviderAccount(input)).resolves.toEqual({ id: "2" });

    const request = requestOf(fetchMock);
    expect(request.url).toContain("/api/v1/provider-accounts");
    expect(request.method).toBe("POST");
    expect(sentBody).toEqual(input);
  });
});

describe("deleteProviderAccount", () => {
  it("DELETEs the account by id", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await deleteProviderAccount("abc");
    const request = requestOf(fetchMock);
    expect(request.url).toContain("/api/v1/provider-accounts/abc");
    expect(request.method).toBe("DELETE");
  });
});
