// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelSwitchBoundary } from "@workspace/ui/components/model-switch-boundary";

afterEach(cleanup);

describe("ModelSwitchBoundary", () => {
  it("identifies both public model ids and stays collapsed by default", () => {
    render(
      <ModelSwitchBoundary
        fromModelId="system:openai:model-a-with-an-extremely-long-public-identifier"
        toModelId="custom:anthropic:model-b-with-an-extremely-long-public-identifier"
        onInspectContext={() => undefined}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: /model changed from system:openai:model-a.*to custom:anthropic:model-b/i,
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(/system:openai:model-a-with/i)).toBeTruthy();
    expect(screen.getByText(/custom:anthropic:model-b-with/i)).toBeTruthy();
    expect(screen.queryByText(/effective system prompt/i)).toBeNull();
  });

  it("expands from the keyboard and exposes an effective-context action", async () => {
    const user = userEvent.setup();
    const inspect = vi.fn();
    render(
      <ModelSwitchBoundary
        fromModelId="model-a"
        toModelId="model-b"
        onInspectContext={inspect}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: /model changed from model-a to model-b/i,
    });
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/effective system prompt/i)).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: /view effective context/i }),
    );
    expect(inspect).toHaveBeenCalledTimes(1);
  });
});
