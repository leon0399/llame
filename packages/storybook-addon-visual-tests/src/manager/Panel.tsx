import React, { useEffect, useState } from "react";
import {
  addons,
  useStorybookApi,
  useStorybookState,
} from "storybook/manager-api";

import {
  BASELINE_EVENT,
  COMMAND_ERROR_EVENT,
  COMMAND_EVENT,
} from "../constants.js";
import type { VisualCommand, VisualCommandError } from "../shared/protocol.js";
import type { BaselinePreview, VisualRunState } from "../shared/results.js";
import { subscribeToVisualState } from "./channel.js";
import { PanelView } from "./PanelView.js";

const EMPTY_STATE: VisualRunState = { running: false, results: [] };

export function Panel() {
  const api = useStorybookApi();
  const { storyId } = useStorybookState();
  const data = storyId ? api.getData(storyId) : undefined;
  // Human title for the current story, so the summary shows the same
  // component-path line whether or not a result exists (stable height).
  const currentStoryTitle =
    data && (data.type === "story" || data.type === "docs")
      ? `${data.title} / ${data.name}`
      : undefined;
  const [state, setState] = useState<VisualRunState>(EMPTY_STATE);
  const [baseline, setBaseline] = useState<BaselinePreview>();
  const [commandError, setCommandError] = useState<string>();
  const [ready, setReady] = useState(false);
  const available =
    (globalThis as typeof globalThis & { CONFIG_TYPE?: string }).CONFIG_TYPE ===
    "DEVELOPMENT";

  useEffect(() => {
    if (!available) return;
    const channel = addons.getChannel();
    const unsubscribeState = subscribeToVisualState(channel, (nextState) => {
      setReady(true);
      setState(nextState);
    });
    channel.on(BASELINE_EVENT, setBaseline);
    const onCommandError = (error: VisualCommandError) =>
      setCommandError(error.message);
    channel.on(COMMAND_ERROR_EVENT, onCommandError);
    return () => {
      unsubscribeState();
      channel.off(BASELINE_EVENT, setBaseline);
      channel.off(COMMAND_ERROR_EVENT, onCommandError);
    };
  }, [available]);

  // Ask the server for the selected story's committed baseline so it can be
  // reviewed even before a local run captures anything.
  useEffect(() => {
    if (!available || !ready || !storyId) return;
    setBaseline(undefined);
    addons.getChannel().emit(COMMAND_EVENT, {
      type: "load-baseline",
      storyId,
    } satisfies VisualCommand);
  }, [available, ready, storyId]);

  const send = (command: VisualCommand) => {
    setCommandError(undefined);
    addons.getChannel().emit(COMMAND_EVENT, command);
  };

  return (
    <PanelView
      state={state}
      currentStoryId={storyId}
      currentStoryTitle={currentStoryTitle}
      baselineArtifactId={
        baseline?.storyId === storyId ? baseline.artifactId : undefined
      }
      commandError={commandError}
      available={available}
      ready={ready}
      onCommand={send}
    />
  );
}
