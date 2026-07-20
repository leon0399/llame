import React, { useEffect, useState } from "react";
import { addons, useStorybookState } from "storybook/manager-api";

import {
  COMMAND_ERROR_EVENT,
  COMMAND_EVENT,
  STATE_EVENT,
} from "../constants.js";
import type { VisualCommand, VisualCommandError } from "../shared/protocol.js";
import type { VisualRunState } from "../shared/results.js";
import { PanelView } from "./PanelView.js";

const EMPTY_STATE: VisualRunState = { running: false, results: [] };

export function Panel() {
  const { storyId } = useStorybookState();
  const [state, setState] = useState<VisualRunState>(EMPTY_STATE);
  const [commandError, setCommandError] = useState<string>();
  const available =
    (globalThis as typeof globalThis & { CONFIG_TYPE?: string }).CONFIG_TYPE ===
    "DEVELOPMENT";

  useEffect(() => {
    if (!available) return;
    const channel = addons.getChannel();
    channel.on(STATE_EVENT, setState);
    const onCommandError = (error: VisualCommandError) =>
      setCommandError(error.message);
    channel.on(COMMAND_ERROR_EVENT, onCommandError);
    channel.emit(COMMAND_EVENT, { type: "get-state" } satisfies VisualCommand);
    return () => {
      channel.off(STATE_EVENT, setState);
      channel.off(COMMAND_ERROR_EVENT, onCommandError);
    };
  }, [available]);

  const send = (command: VisualCommand) => {
    setCommandError(undefined);
    addons.getChannel().emit(COMMAND_EVENT, command);
  };

  return (
    <PanelView
      state={state}
      currentStoryId={storyId}
      commandError={commandError}
      available={available}
      onCommand={send}
    />
  );
}
