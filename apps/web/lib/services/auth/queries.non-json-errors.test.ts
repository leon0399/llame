import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { InvalidCredentialsError } from "./errors";
import { fetchMeOptional, login } from "./queries";
import { stubFetch } from "../../test-support/fetch-stub";

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth service non-JSON error outcomes", () => {
  it("classifies a non-JSON generated 401 login failure", async () => {
    const rawBody = "<html><body>unauthorized</body></html>";
    fetchMock.mockResolvedValue(new Response(rawBody, { status: 401 }));

    await expect(
      login({ email: "leo@example.com", password: "wrong" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("maps a non-JSON generated 401 optional-auth failure to null", async () => {
    const rawBody = "<html><body>unauthorized</body></html>";
    fetchMock.mockResolvedValue(new Response(rawBody, { status: 401 }));

    await expect(fetchMeOptional()).resolves.toBeNull();
  });
});
