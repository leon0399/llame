import { PlayHollowIcon, StopAltIcon } from "@storybook/icons";
import React, { useEffect, useState } from "react";
import { Button } from "storybook/internal/components";
import { addons } from "storybook/manager-api";
import { styled } from "storybook/theming";

import { COMMAND_EVENT } from "../constants.js";
import type { VisualRunState } from "../shared/results.js";
import { subscribeToVisualState } from "./channel.js";

const EMPTY_STATE: VisualRunState = { running: false, results: [] };

export function TestProviderRow() {
  const [state, setState] = useState<VisualRunState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const channel = addons.getChannel();
    return subscribeToVisualState(channel, (nextState) => {
      setReady(true);
      setState(nextState);
    });
  }, []);

  const changed = state.results.filter(
    ({ status }) => status === "changed" || status === "new",
  ).length;
  const failed = state.results.filter(
    ({ status }) => status === "capture-error",
  ).length;
  const cancelled = state.results.filter(
    ({ status }) => status === "cancelled",
  ).length;
  const description = state.running
    ? "Running…"
    : failed > 0
      ? `${String(failed)} failed`
      : changed > 0
        ? `${String(changed)} changed`
        : cancelled > 0
          ? `${String(cancelled)} cancelled`
          : state.results.length > 0
            ? "No visual changes detected"
            : "Not run";

  return (
    <Container>
      <Info>
        <Title>Visual tests</Title>
        <Description>{description}</Description>
      </Info>
      <Button
        ariaLabel={state.running ? "Stop visual tests" : "Run visual tests"}
        disabled={!ready}
        size="medium"
        variant="ghost"
        padding="small"
        onClick={() =>
          addons
            .getChannel()
            .emit(
              COMMAND_EVENT,
              state.running
                ? { type: "cancel" }
                : { type: "run", scope: "all" },
            )
        }
      >
        {state.running ? <StopAltIcon /> : <PlayHollowIcon />}
      </Button>
    </Container>
  );
}

const Container = styled.div({
  alignItems: "center",
  display: "flex",
  justifyContent: "space-between",
  padding: "8px 0",
});

const Info = styled.div({
  display: "flex",
  flexDirection: "column",
  marginLeft: 8,
});

const Title = styled.div(({ theme }) => ({
  color: theme.color.defaultText,
  fontSize: theme.typography.size.s1,
}));

const Description = styled.div(({ theme }) => ({
  color: theme.textMutedColor,
  fontSize: theme.typography.size.s1,
}));
