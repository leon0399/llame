/* eslint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions, anti-slop/no-unknown-returns -- every cast here builds a test double for one collaborator's surface, and no production code reads it. */
// @vitest-environment jsdom
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { createSubmitHandler } from "./use-chat-creation";

/*
 * The filed composer's submit handler (openspec `chat-start-location`, design
 * D10): one Chat id per draft, retained before the request leaves the browser,
 * so a lost response cannot mint a second Chat and its Run on the next submit.
 */

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CHAT_ID = "3f9b2ab7-8ba1-4f34-9a4e-0f6e3f6a2b10";

function handlerFor(options: {
  readonly mutateAsync: (request: { id: string }) => Promise<unknown>;
  readonly retryChatId?: string | null;
}) {
  const onRetain = vi.fn();
  const onSent = vi.fn();
  const onFailure = vi.fn();
  const onWorkspaceFailure = vi.fn();
  const handler = createSubmitHandler({
    input: "Start here.",
    attachments: {
      items: [],
      sendBlocked: false,
      clear: vi.fn(),
    } as never,
    createChat: {
      mutateAsync: options.mutateAsync,
      isPending: false,
    } as never,
    selections: {
      modelId: "system:openai:gpt-5.4",
      effort: undefined,
      permissionMode: "default",
      modelReadyForSend: true,
      modelSendUnavailableReason: null,
    },
    location: {
      isolation: "reuse",
      location: { checkout: null },
    } as never,
    projectId: PROJECT_ID,
    retryChatId: options.retryChatId ?? null,
    onRetain,
    onFailure,
    onWorkspaceFailure,
    onSent,
  });
  return { handler, onRetain, onSent, onFailure, onWorkspaceFailure };
}

function formEvent() {
  return {
    preventDefault: vi.fn(),
  } as unknown as React.FormEvent<HTMLFormElement>;
}

describe("createSubmitHandler", () => {
  it("retains the Chat id across a lost response and reuses it", async () => {
    const sent: Array<string> = [];
    const failed = handlerFor({
      mutateAsync: (request) => {
        sent.push(request.id);
        return Promise.reject(new Error("network down"));
      },
    });

    failed.handler(formEvent());
    await vi.waitFor(() => expect(failed.onFailure).toHaveBeenCalledTimes(1));

    const retained = failed.onRetain.mock.calls[0]?.[0];
    expect(retained).toEqual(expect.any(String));

    const retried = handlerFor({
      retryChatId: retained,
      mutateAsync: (request) => {
        sent.push(request.id);
        return Promise.resolve({
          chat: { id: request.id },
          workspace: { status: "bound", root: "/srv/llame" },
        });
      },
    });
    retried.handler(formEvent());
    await vi.waitFor(() => expect(retried.onSent).toHaveBeenCalledTimes(1));

    expect(sent).toEqual([retained, retained]);
  });

  it("treats a Chat that already holds the draft's message as sent", async () => {
    const { handler, onSent, onFailure } = handlerFor({
      retryChatId: CHAT_ID,
      mutateAsync: () =>
        Promise.reject({
          status: 409,
          info: {
            message:
              "The Chat already holds a message; send the draft through the message route.",
          },
        }),
    });

    handler(formEvent());

    await vi.waitFor(() => expect(onSent).toHaveBeenCalledWith(CHAT_ID));
    expect(onFailure).not.toHaveBeenCalledWith(expect.any(String));
  });
});
