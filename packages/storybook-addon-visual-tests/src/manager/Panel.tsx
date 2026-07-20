import React, { useEffect, useState } from "react";
import { addons, useStorybookState } from "storybook/manager-api";

import { COMMAND_EVENT, STATE_EVENT } from "../constants.js";
import type { VisualCommand } from "../shared/protocol.js";
import type { VisualRunState } from "../shared/results.js";
import { PanelView } from "./PanelView.js";

const EMPTY_STATE: VisualRunState = { running: false, results: [] };

export function Panel() {
  const { storyId } = useStorybookState();
  const [state, setState] = useState<VisualRunState>(EMPTY_STATE);
  const available =
    (globalThis as typeof globalThis & { CONFIG_TYPE?: string }).CONFIG_TYPE ===
    "DEVELOPMENT";

  useEffect(() => {
    if (!available) return;
    const channel = addons.getChannel();
    channel.on(STATE_EVENT, setState);
    channel.emit(COMMAND_EVENT, { type: "get-state" } satisfies VisualCommand);
    return () => channel.off(STATE_EVENT, setState);
  }, [available]);

  const send = (command: VisualCommand) =>
    addons.getChannel().emit(COMMAND_EVENT, command);

  return (
    <PanelView
      state={state}
      currentStoryId={storyId}
      available={available}
      onCommand={send}
    />
  );
}
