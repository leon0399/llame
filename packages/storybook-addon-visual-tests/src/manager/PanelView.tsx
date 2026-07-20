import {
  CheckIcon,
  ContrastIcon,
  PhotoIcon,
  PlayHollowIcon,
  StopAltIcon,
} from "@storybook/icons";
import React, { useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyTabContent,
  ScrollArea,
} from "storybook/internal/components";
import { styled } from "storybook/theming";

import { ARTIFACT_ROUTE } from "../constants.js";
import type { VisualCommand } from "../shared/protocol.js";
import type { VisualResult, VisualRunState } from "../shared/results.js";

type ImageKind = "baseline" | "candidate" | "diff";

export interface PanelViewProps {
  state: VisualRunState;
  currentStoryId?: string;
  available?: boolean;
  onCommand: (command: VisualCommand) => void;
}

export function PanelView({
  state,
  currentStoryId,
  available = true,
  onCommand,
}: PanelViewProps) {
  const result = useMemo(
    () => state.results.find((item) => item.storyId === currentStoryId),
    [currentStoryId, state.results],
  );
  const runCurrent = () => {
    if (!currentStoryId) return;
    onCommand({ type: "run", scope: "current", storyId: currentStoryId });
  };

  if (!available) {
    return (
      <PanelRoot aria-label="Visual tests">
        <EmptyTabContent
          title="Visual tests unavailable"
          description="Start Storybook in development mode to capture and approve local images."
        />
      </PanelRoot>
    );
  }

  return (
    <PanelRoot aria-label="Visual tests">
      <PanelHeader>
        <PanelTitle>
          <PhotoIcon />
          Visual tests
        </PanelTitle>
        {state.running ? (
          <Button
            ariaLabel="Stop visual tests"
            padding="small"
            size="small"
            variant="ghost"
            onClick={() => onCommand({ type: "cancel" })}
          >
            <StopAltIcon />
          </Button>
        ) : (
          <Button
            ariaLabel="Run visual tests"
            padding="small"
            size="small"
            variant="ghost"
            disabled={!currentStoryId}
            onClick={runCurrent}
          >
            <PlayHollowIcon />
          </Button>
        )}
      </PanelHeader>

      {!currentStoryId ? (
        <EmptyTabContent
          title="Select a story"
          description="Visual results are reviewed one story at a time."
        />
      ) : result ? (
        <ResultReview
          result={result}
          runId={state.runId}
          onCommand={onCommand}
        />
      ) : (
        <EmptyTabContent
          title="No visual result for this story"
          description="Run visual tests to capture this story and compare it with its baseline."
          footer={
            <Button
              ariaLabel={false}
              size="medium"
              variant="solid"
              onClick={runCurrent}
            >
              <PlayHollowIcon />
              Run visual tests
            </Button>
          }
        />
      )}
    </PanelRoot>
  );
}

function ResultReview({
  result,
  runId,
  onCommand,
}: {
  result: VisualResult;
  runId?: string;
  onCommand: (command: VisualCommand) => void;
}) {
  const availableImages = (["baseline", "candidate", "diff"] as const).filter(
    (kind) => result.artifacts?.[kind],
  );
  const [requestedImage, setRequestedImage] = useState<ImageKind>("diff");
  const imageKind = availableImages.includes(requestedImage)
    ? requestedImage
    : (availableImages.at(-1) ?? requestedImage);
  const artifactId = result.artifacts?.[imageKind];
  const reviewable =
    (result.status === "new" || result.status === "changed") &&
    runId &&
    result.candidateSha256;

  return (
    <ReviewLayout>
      <ReviewHeader>
        <StoryInfo>
          <StoryTitle>{result.title}</StoryTitle>
          <StoryId>{result.storyId}</StoryId>
        </StoryInfo>
        <StatusBadge compact status={badgeStatus(result.status)}>
          {statusLabel(result.status)}
        </StatusBadge>
        {reviewable ? (
          <Button
            ariaLabel={false}
            size="small"
            variant="solid"
            onClick={() =>
              onCommand({
                type: "approve",
                runId,
                storyId: result.storyId,
                environmentKey: result.environmentKey,
                candidateSha256: result.candidateSha256!,
              })
            }
          >
            <CheckIcon />
            Accept
          </Button>
        ) : null}
      </ReviewHeader>

      <ArtifactBar aria-label="Visual artifact">
        <ArtifactTab
          ariaLabel={false}
          $active={imageKind === "candidate"}
          disabled={!result.artifacts?.candidate}
          padding="small"
          size="small"
          variant="ghost"
          onClick={() => setRequestedImage("candidate")}
        >
          <PhotoIcon /> Latest
        </ArtifactTab>
        <ArtifactTab
          ariaLabel={false}
          $active={imageKind === "baseline"}
          disabled={!result.artifacts?.baseline}
          padding="small"
          size="small"
          variant="ghost"
          onClick={() => setRequestedImage("baseline")}
        >
          <PhotoIcon /> Baseline
        </ArtifactTab>
        <ArtifactTab
          ariaLabel={false}
          $active={imageKind === "diff"}
          disabled={!result.artifacts?.diff}
          padding="small"
          size="small"
          variant="ghost"
          onClick={() => setRequestedImage("diff")}
        >
          <ContrastIcon /> Diff
        </ArtifactTab>
      </ArtifactBar>

      {result.message ? (
        <Message
          role={result.status === "capture-error" ? "alert" : undefined}
          error={result.status === "capture-error"}
        >
          {result.message}
        </Message>
      ) : null}

      <ArtifactViewport focusable vertical horizontal>
        {artifactId ? (
          <Snapshot
            alt={`${imageKind} for ${result.title}`}
            src={`${ARTIFACT_ROUTE}/${encodeURIComponent(artifactId)}`}
          />
        ) : (
          <EmptyTabContent
            title="No image available"
            description={`This result has no ${imageKind} artifact.`}
          />
        )}
      </ArtifactViewport>
    </ReviewLayout>
  );
}

function badgeStatus(
  status: VisualResult["status"],
): React.ComponentProps<typeof Badge>["status"] {
  if (status === "passed") return "positive";
  if (status === "changed" || status === "new") return "warning";
  if (status === "capture-error") return "critical";
  if (status === "running") return "active";
  return "neutral";
}

function statusLabel(status: VisualResult["status"]): string {
  return status.replaceAll("-", " ");
}

const PanelRoot = styled.section(({ theme }) => ({
  background: theme.background.app,
  color: theme.color.defaultText,
  containerType: "size",
  display: "grid",
  fontFamily: theme.typography.fonts.base,
  gridTemplateRows: "40px minmax(0, 1fr)",
  height: "100%",
  minWidth: 0,
}));

const PanelHeader = styled.header(({ theme }) => ({
  alignItems: "center",
  background: theme.background.bar,
  borderBottom: `1px solid ${theme.appBorderColor}`,
  display: "flex",
  justifyContent: "space-between",
  padding: "0 10px 0 15px",
}));

const PanelTitle = styled.strong(({ theme }) => ({
  alignItems: "center",
  display: "flex",
  fontSize: theme.typography.size.s2,
  gap: 7,
  lineHeight: "20px",
}));

const ReviewLayout = styled.div({
  display: "grid",
  gridTemplateRows: "auto 40px auto minmax(0, 1fr)",
  minHeight: 0,
});

const ReviewHeader = styled.div(({ theme }) => ({
  alignItems: "center",
  background: theme.background.content,
  borderBottom: `1px solid ${theme.appBorderColor}`,
  display: "grid",
  gap: 10,
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
  minHeight: 56,
  padding: "8px 10px 8px 15px",
}));

const StoryInfo = styled.div({ minWidth: 0 });

const StoryTitle = styled.div(({ theme }) => ({
  fontSize: theme.typography.size.s2,
  fontWeight: theme.typography.weight.bold,
  lineHeight: "18px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
}));

const StoryId = styled.div(({ theme }) => ({
  color: theme.textMutedColor,
  fontFamily: theme.typography.fonts.mono,
  fontSize: theme.typography.size.s1,
  lineHeight: "16px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
}));

const StatusBadge = styled(Badge)({ textTransform: "capitalize" });

const ArtifactBar = styled.nav(({ theme }) => ({
  alignItems: "stretch",
  background: theme.background.bar,
  borderBottom: `1px solid ${theme.appBorderColor}`,
  display: "flex",
  gap: 4,
  padding: "0 10px",
}));

const ArtifactTab = styled(Button)<{ $active: boolean }>(
  ({ $active, theme }) => ({
    borderBottom: `3px solid ${$active ? theme.color.secondary : "transparent"}`,
    borderRadius: 0,
    color: $active ? theme.color.secondary : theme.color.defaultText,
  }),
);

const Message = styled.div<{ error?: boolean }>(({ error, theme }) => ({
  background: error ? theme.background.negative : theme.background.hoverable,
  borderBottom: `1px solid ${theme.appBorderColor}`,
  color: error ? theme.color.negativeText : theme.color.defaultText,
  fontSize: theme.typography.size.s1,
  lineHeight: "18px",
  padding: "10px 15px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
}));

const ArtifactViewport = styled(ScrollArea)(({ theme }) => ({
  background: theme.background.content,
  height: "100%",
  minHeight: 0,
  padding: 15,
}));

const Snapshot = styled.img(({ theme }) => ({
  background: theme.background.preview,
  border: `1px solid ${theme.appBorderColor}`,
  borderRadius: theme.appBorderRadius,
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
  display: "block",
  height: "auto",
  maxWidth: "100%",
}));
