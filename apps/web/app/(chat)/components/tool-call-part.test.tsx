// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { toChatUiMessages } from "@/lib/services/chat/history";

import {
  ToolCallPart,
  summarizeToolInput,
  toolActivityStatus,
} from "./tool-call-part";

afterEach(() => {
  cleanup();
});

// Base UI assigns each Collapsible instance a fresh
// auto-incrementing id (`base-ui-_r_..._`), so two independently-rendered
// instances of otherwise identical markup never produce byte-identical HTML.
// Strip those before a parity comparison — the ids are React internals, not
// part of what the user sees. Base UI also stamps a transient
// `data-starting-style`/`data-ending-style` attribute for the duration of an
// enter/exit CSS transition; whether it is still present depends on which
// animation frame the snapshot was taken on, so normalize it away too.
function stripGeneratedIds(html: string): string {
  return html
    .replace(/\bid="(?:radix|base-ui)-[^"]*"/g, 'id="_"')
    .replace(/\baria-controls="(?:radix|base-ui)-[^"]*"/g, 'aria-controls="_"')
    .replace(/ data-(?:starting|ending)-style=""/g, "");
}

describe("toolActivityStatus", () => {
  it("maps each AI SDK tool-part state to its coarse call/running/done/error status", () => {
    expect(toolActivityStatus("input-streaming")).toBe("calling");
    expect(toolActivityStatus("input-available")).toBe("running");
    expect(toolActivityStatus("output-available")).toBe("done");
    expect(toolActivityStatus("output-error")).toBe("error");
  });

  it("defaults states unreachable in this read-only slice (approvals, denial) to running rather than rendering nothing", () => {
    expect(toolActivityStatus("approval-requested")).toBe("running");
    expect(toolActivityStatus("approval-responded")).toBe("running");
    expect(toolActivityStatus("output-denied")).toBe("running");
    expect(toolActivityStatus("some-future-state")).toBe("running");
  });
});

describe("summarizeToolInput", () => {
  it("summarizes primitive-valued object fields as key: value pairs", () => {
    expect(summarizeToolInput({ query: "budget", limit: 5 })).toBe(
      'query: "budget", limit: 5',
    );
  });

  it("returns undefined for absent input and empty objects", () => {
    expect(summarizeToolInput(undefined)).toBeUndefined();
    expect(summarizeToolInput({})).toBeUndefined();
  });

  it("truncates long summaries with an ellipsis", () => {
    const summary = summarizeToolInput({ query: "x".repeat(200) });
    expect(summary?.endsWith("…")).toBe(true);
    expect(summary?.length).toBeLessThanOrEqual(81);
  });

  it("formats a non-object input directly", () => {
    expect(summarizeToolInput("plain-string-input")).toBe(
      '"plain-string-input"',
    );
  });
});

describe("ToolCallPart", () => {
  it("shows the call (tool name + args summary) and a calling state for input-streaming", () => {
    render(
      <ToolCallPart
        toolName="search_conversations"
        state="input-streaming"
        input={{ query: "budget" }}
      />,
    );
    expect(screen.getByText("search_conversations")).toBeTruthy();
    expect(screen.getByText('query: "budget"')).toBeTruthy();
    expect(screen.getByText("calling…")).toBeTruthy();
  });

  it("shows a running state for input-available", () => {
    render(
      <ToolCallPart
        toolName="search_conversations"
        state="input-available"
        input={{ query: "budget" }}
      />,
    );
    expect(screen.getByText("running…")).toBeTruthy();
  });

  it("shows a done state and reveals the result on expand for output-available", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallPart
        toolName="search_conversations"
        state="output-available"
        input={{ query: "budget" }}
        output={{ status: "success", results: [] }}
      />,
    );
    expect(screen.getByText("done")).toBeTruthy();

    await user.click(screen.getByRole("button"));

    expect(screen.getByText("Result")).toBeTruthy();
    expect(screen.getByText(/"status": "success"/)).toBeTruthy();
  });

  it("shows an error state and reveals the error text on expand for output-error", async () => {
    const user = userEvent.setup();
    render(
      <ToolCallPart
        toolName="search_conversations"
        state="output-error"
        input={{ query: "budget" }}
        errorText="The search could not complete."
      />,
    );
    expect(screen.getByText("error")).toBeTruthy();

    await user.click(screen.getByRole("button"));

    expect(screen.getByText("The search could not complete.")).toBeTruthy();
  });
});

describe("live vs. historical rendering parity", () => {
  it("renders the identical tool-call chip whether the part came from the live stream or a reloaded history response", async () => {
    const user = userEvent.setup();
    const livePart = {
      type: "tool-search_conversations" as const,
      toolCallId: "call_1",
      state: "output-available" as const,
      input: { query: "budget", limit: 5 },
      output: { status: "success", results: [] },
    };

    const [historyMessage] = toChatUiMessages({
      messages: [
        {
          id: "assistant-message",
          chatId: "chat-1",
          seq: 2,
          role: "assistant",
          senderUserId: null,
          parts: [livePart],
          attachments: [],
          usage: null,
          inReplyTo: "user-message",
          createdAt: "2026-07-11T12:00:00.000Z",
        },
      ],
    });
    const historicalPart = historyMessage?.parts[0] as typeof livePart;

    const liveRender = render(
      <ToolCallPart
        toolName={livePart.type.replace(/^tool-/, "")}
        state={livePart.state}
        input={livePart.input}
        output={livePart.output}
      />,
    );
    await user.click(liveRender.getByRole("button"));
    const liveHtml = stripGeneratedIds(liveRender.container.innerHTML);
    liveRender.unmount();

    const historicalRender = render(
      <ToolCallPart
        toolName={historicalPart.type.replace(/^tool-/, "")}
        state={historicalPart.state}
        input={historicalPart.input}
        output={historicalPart.output}
      />,
    );
    await user.click(historicalRender.getByRole("button"));

    expect(stripGeneratedIds(historicalRender.container.innerHTML)).toBe(
      liveHtml,
    );
  });
});
