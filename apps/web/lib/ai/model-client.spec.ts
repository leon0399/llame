import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeModelClient } from "./fake-model-client";
import {
  MissingModelCredentialError,
  resolveModelCredential,
} from "./model-client";
import {
  DEFAULT_OPENAI_MODEL,
  createOpenAIModelClient,
} from "./openai-model-client";

const { createOpenAIMock, streamTextMock } = vi.hoisted(() => ({
  createOpenAIMock: vi.fn(),
  streamTextMock: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: createOpenAIMock,
}));

vi.mock("ai", async (importActual) => {
  const actual = await importActual<typeof import("ai")>();

  return {
    ...actual,
    streamText: streamTextMock,
  };
});

async function collectText(stream: AsyncIterable<string>): Promise<string> {
  let text = "";

  for await (const chunk of stream) {
    text += chunk;
  }

  return text;
}

const messages = [
  {
    role: "user",
    content: "Hello",
  },
] satisfies ModelMessage[];

describe("ModelClient", () => {
  beforeEach(() => {
    createOpenAIMock.mockReset();
    streamTextMock.mockReset();
  });

  it("fails closed with a typed error when no user credential is available", async () => {
    await expect(resolveModelCredential("user-1")).rejects.toMatchObject({
      name: "MissingModelCredentialError",
      code: "missing_model_credential",
      userId: "user-1",
    });

    await expect(resolveModelCredential("user-1")).rejects.toBeInstanceOf(
      MissingModelCredentialError,
    );
  });

  it("constructs a per-request client from a user-supplied credential", async () => {
    const providerModel = { provider: "openai", modelId: "gpt-test" };
    const openaiProvider = vi.fn(() => providerModel);
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({ textStream: (async function* () {})() });

    const credential = await resolveModelCredential("user-1", async (userId) =>
      userId === "user-1" ? "sk-user-supplied" : null,
    );
    const client = createOpenAIModelClient(credential, "gpt-test");

    const abortSignal = AbortSignal.timeout(1000);
    client.streamText({
      messages,
      system: "stable system",
      abortSignal,
    });

    expect(createOpenAIMock).toHaveBeenCalledWith({
      apiKey: "sk-user-supplied",
    });
    expect(openaiProvider).toHaveBeenCalledWith("gpt-test");
    expect(streamTextMock).toHaveBeenCalledWith({
      model: providerModel,
      messages,
      system: "stable system",
      abortSignal,
    });
  });

  it("can create the provider client directly with the default model", () => {
    const providerModel = { provider: "openai", modelId: DEFAULT_OPENAI_MODEL };
    const openaiProvider = vi.fn(() => providerModel);
    createOpenAIMock.mockReturnValue(openaiProvider);
    streamTextMock.mockReturnValue({ textStream: (async function* () {})() });

    createOpenAIModelClient("sk-user-supplied").streamText({ messages });

    expect(openaiProvider).toHaveBeenCalledWith(DEFAULT_OPENAI_MODEL);
    expect(streamTextMock).toHaveBeenCalledWith({
      model: providerModel,
      messages,
      system: undefined,
      abortSignal: undefined,
    });
  });

  it("uses a fake client to drive callers without a provider or network", async () => {
    const client = createFakeModelClient(["first", "second"]);

    await expect(
      collectText(client.streamText({ messages }).textStream),
    ).resolves.toBe("first");
    await expect(
      collectText(client.streamText({ messages }).textStream),
    ).resolves.toBe("second");
    await expect(
      collectText(client.streamText({ messages }).textStream),
    ).resolves.toBe("first");
  });
});
