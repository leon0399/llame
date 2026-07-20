import React, { useEffect, useState } from "react";
import { addons, useStorybookState } from "storybook/manager-api";

import {
  BASELINE_EVENT,
  COMMAND_ERROR_EVENT,
  COMMAND_EVENT,
  STATE_EVENT,
} from "../constants.js";
import type { VisualCommand, VisualCommandError } from "../shared/protocol.js";
import type { BaselinePreview, VisualRunState } from "../shared/results.js";
import { PanelView } from "./PanelView.js";

const EMPTY_STATE: VisualRunState = { running: false, results: [] };

export function Panel() {
  const { storyId } = useStorybookState();
  const [state, setState] = useState<VisualRunState>(EMPTY_STATE);
  const [baseline, setBaseline] = useState<BaselinePreview>();
  const [commandError, setCommandError] = useState<string>();
  const available =
    (globalThis as typeof globalThis & { CONFIG_TYPE?: string }).CONFIG_TYPE ===
    "DEVELOPMENT";

  useEffect(() => {
    if (!available) return;
    const channel = addons.getChannel();
    channel.on(STATE_EVENT, setState);
    channel.on(BASELINE_EVENT, setBaseline);
    const onCommandError = (error: VisualCommandError) =>
      setCommandError(error.message);
    channel.on(COMMAND_ERROR_EVENT, onCommandError);
    channel.emit(COMMAND_EVENT, { type: "get-state" } satisfies VisualCommand);
    return () => {
      channel.off(STATE_EVENT, setState);
      channel.off(BASELINE_EVENT, setBaseline);
      channel.off(COMMAND_ERROR_EVENT, onCommandError);
    };
  }, [available]);

  // Ask the server for the selected story's committed baseline so it can be
  // reviewed even before a local run captures anything.
  useEffect(() => {
    if (!available || !storyId) return;
    setBaseline(undefined);
    addons.getChannel().emit(COMMAND_EVENT, {
      type: "load-baseline",
      storyId,
    } satisfies VisualCommand);
  }, [available, storyId]);

  const send = (command: VisualCommand) => {
    setCommandError(undefined);
    addons.getChannel().emit(COMMAND_EVENT, command);
  };

  return (
    <PanelView
      state={state}
      currentStoryId={storyId}
      baselineArtifactId={
        baseline?.storyId === storyId ? baseline.artifactId : undefined
      }
      commandError={commandError}
      available={available}
      onCommand={send}
    />
  );
}
