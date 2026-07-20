import {
  CheckIcon,
  ContrastIcon,
  PhotoIcon,
  PlayHollowIcon,
  StopAltIcon,
  SyncIcon,
} from "@storybook/icons";
import React, { useMemo, useState } from "react";
import { Button, EmptyTabContent } from "storybook/internal/components";
import { styled, type Theme } from "storybook/theming";

import { ARTIFACT_ROUTE } from "../constants.js";
import type { VisualCommand } from "../shared/protocol.js";
import type { VisualResult, VisualRunState } from "../shared/results.js";

type ImageKind = "baseline" | "candidate" | "diff";
type DisplayStatus = VisualResult["status"] | "not-run";

export interface PanelViewProps {
  state: VisualRunState;
  currentStoryId?: string;
  /** Opaque id of the current story's committed baseline, if one exists on disk. */
  baselineArtifactId?: string;
  commandError?: string;
  available?: boolean;
  onCommand: (command: VisualCommand) => void;
}

export function PanelView({
  state,
  currentStoryId,
  baselineArtifactId,
  commandError,
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
        <Fill>
          <EmptyTabContent
            title="Visual tests unavailable"
            description="Start Storybook in development mode to capture and approve local images."
          />
        </Fill>
      </PanelRoot>
    );
  }

  return (
    <PanelRoot aria-label="Visual tests">
      {currentStoryId ? (
        <Summary
          result={result}
          storyId={currentStoryId}
          running={state.running}
          onRun={runCurrent}
          onCancel={() => onCommand({ type: "cancel" })}
          onCommand={onCommand}
        />
      ) : null}
      {commandError ? (
        <Message role="alert" $error>
          {commandError}
        </Message>
      ) : null}
      <Content>
        {currentStoryId ? (
          <Review
            key={currentStoryId}
            result={result}
            baselineArtifactId={baselineArtifactId}
            running={state.running}
          />
        ) : (
          <Fill>
            <EmptyTabContent
              title="Select a story"
              description="Visual results are reviewed one story at a time."
            />
          </Fill>
        )}
      </Content>
    </PanelRoot>
  );
}

function Summary({
  result,
  storyId,
  running,
  onRun,
  onCancel,
  onCommand,
}: {
  result: VisualResult | undefined;
  storyId: string;
  running: boolean;
  onRun: () => void;
  onCancel: () => void;
  onCommand: (command: VisualCommand) => void;
}) {
  const status: DisplayStatus = result
    ? result.status
    : running
      ? "running"
      : "not-run";
  // Whether *this* story is mid-capture — drives Stop vs Run, independent of
  // whether some other story in a "run all" is still going.
  const active = result
    ? result.status === "running" || result.status === "queued"
    : running;
  const reviewable =
    result &&
    (result.status === "new" || result.status === "changed") &&
    result.candidateSha256;

  return (
    <SummaryBar>
      <SummaryInfo>
        <Headline>
          <StatusDot $status={status} />
          <HeadlineText>{statusLabel(status)}</HeadlineText>
          {result?.diffPixels ? (
            <Metric>{result.diffPixels.toLocaleString("en-US")} px</Metric>
          ) : null}
        </Headline>
        {result ? (
          <SubTitle title={result.title}>{result.title}</SubTitle>
        ) : null}
        <SubId title={storyId}>{storyId}</SubId>
      </SummaryInfo>

      <Actions>
        {active ? (
          <Button
            ariaLabel="Stop visual tests"
            padding="small"
            size="small"
            variant="ghost"
            onClick={onCancel}
          >
            <StopAltIcon />
          </Button>
        ) : (
          <>
            {reviewable && result ? (
              <Button
                ariaLabel={false}
                size="small"
                variant="solid"
                onClick={() =>
                  onCommand({
                    type: "approve",
                    runId: result.runId,
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
            <Button
              ariaLabel="Run visual tests"
              padding="small"
              size="small"
              variant="ghost"
              onClick={onRun}
            >
              {result ? <SyncIcon /> : <PlayHollowIcon />}
            </Button>
          </>
        )}
      </Actions>
    </SummaryBar>
  );
}

function Review({
  result,
  baselineArtifactId,
  running,
}: {
  result: VisualResult | undefined;
  baselineArtifactId?: string;
  running: boolean;
}) {
  // With no local run, fall back to the committed baseline so it stays
  // reviewable; a run supplies the full baseline/candidate/diff set.
  const artifacts =
    result?.artifacts ??
    (baselineArtifactId ? { baseline: baselineArtifactId } : undefined);
  const availableImages = (["baseline", "candidate", "diff"] as const).filter(
    (kind) => artifacts?.[kind],
  );
  const [requestedImage, setRequestedImage] = useState<ImageKind>("diff");
  const imageKind = availableImages.includes(requestedImage)
    ? requestedImage
    : (availableImages.at(-1) ?? requestedImage);
  const artifactId = artifacts?.[imageKind];
  const isError = result?.status === "capture-error";

  const placeholder = artifactId
    ? undefined
    : isError
      ? undefined
      : running
        ? "Capturing this story…"
        : result
          ? "No image for this view."
          : "Run the visual test to capture this story and compare it with its baseline.";

  return (
    <>
      <TabBar aria-label="Visual artifact">
        <Tab
          active={imageKind === "candidate"}
          disabled={!artifacts?.candidate}
          icon={<PhotoIcon aria-hidden />}
          label="Latest"
          onSelect={() => setRequestedImage("candidate")}
        />
        <Tab
          active={imageKind === "baseline"}
          disabled={!artifacts?.baseline}
          icon={<PhotoIcon aria-hidden />}
          label="Baseline"
          onSelect={() => setRequestedImage("baseline")}
        />
        <Tab
          active={imageKind === "diff"}
          disabled={!artifacts?.diff}
          icon={<ContrastIcon aria-hidden />}
          label="Diff"
          onSelect={() => setRequestedImage("diff")}
        />
      </TabBar>

      {result?.message ? (
        <Message role={isError ? "alert" : undefined} $error={isError}>
          {result.message}
        </Message>
      ) : null}

      <Viewport
        role="group"
        aria-label="Visual artifact preview"
        tabIndex={artifactId ? 0 : undefined}
      >
        {artifactId ? (
          <Snapshot
            alt={`${imageKind} for ${result?.title ?? "story"}`}
            src={`${ARTIFACT_ROUTE}/${encodeURIComponent(artifactId)}`}
          />
        ) : placeholder ? (
          <Placeholder>{placeholder}</Placeholder>
        ) : null}
      </Viewport>
    </>
  );
}

function Tab({
  active,
  disabled,
  icon,
  label,
  onSelect,
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}) {
  return (
    <TabButton
      type="button"
      aria-pressed={active}
      $active={active}
      disabled={disabled}
      onClick={onSelect}
    >
      {icon}
      {label}
    </TabButton>
  );
}

function statusLabel(status: DisplayStatus): string {
  switch (status) {
    case "new":
      return "New";
    case "changed":
      return "Changed";
    case "passed":
      return "Passed";
    case "capture-error":
      return "Capture failed";
    case "running":
      return "Running…";
    case "queued":
      return "Queued";
    case "cancelled":
      return "Cancelled";
    case "not-run":
      return "Not run";
  }
}

function statusColor(theme: Theme, status: DisplayStatus): string {
  if (status === "passed") return theme.color.positive;
  if (status === "new" || status === "changed") return theme.color.warning;
  if (status === "capture-error") return theme.color.negative;
  if (status === "running" || status === "queued") return theme.color.secondary;
  return theme.textMutedColor;
}

const PanelRoot = styled.section(({ theme }) => ({
  background: theme.background.app,
  color: theme.color.defaultText,
  containerType: "size",
  display: "flex",
  flexDirection: "column",
  fontFamily: theme.typography.fonts.base,
  height: "100%",
  minWidth: 0,
}));

const SummaryBar = styled.div(({ theme }) => ({
  alignItems: "center",
  borderBottom: `1px solid ${theme.appBorderColor}`,
  display: "flex",
  flexShrink: 0,
  gap: 12,
  justifyContent: "space-between",
  padding: "10px 12px",
}));

const SummaryInfo = styled.div({
  display: "grid",
  gap: 2,
  minWidth: 0,
});

const Headline = styled.div(({ theme }) => ({
  alignItems: "center",
  display: "flex",
  fontSize: theme.typography.size.s2,
  fontWeight: theme.typography.weight.bold,
  gap: 7,
  lineHeight: "18px",
  minWidth: 0,
}));

const StatusDot = styled.span<{ $status: DisplayStatus }>(
  ({ $status, theme }) => ({
    background: statusColor(theme, $status),
    borderRadius: "50%",
    flexShrink: 0,
    height: 8,
    width: 8,
  }),
);

const HeadlineText = styled.span({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

const Metric = styled.span(({ theme }) => ({
  color: theme.textMutedColor,
  fontSize: theme.typography.size.s1,
  fontWeight: theme.typography.weight.regular,
  whiteSpace: "nowrap",
}));

const SubTitle = styled.div(({ theme }) => ({
  color: theme.color.defaultText,
  fontSize: theme.typography.size.s1,
  lineHeight: "16px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
}));

const SubId = styled.div(({ theme }) => ({
  color: theme.textMutedColor,
  fontFamily: theme.typography.fonts.mono,
  fontSize: theme.typography.size.s1,
  lineHeight: "16px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
}));

const Actions = styled.div({
  alignItems: "center",
  display: "flex",
  flexShrink: 0,
  gap: 6,
});

const Content = styled.div({
  display: "flex",
  flex: 1,
  flexDirection: "column",
  minHeight: 0,
});

const TabBar = styled.nav(({ theme }) => ({
  alignItems: "stretch",
  borderBottom: `1px solid ${theme.appBorderColor}`,
  display: "flex",
  flexShrink: 0,
  gap: 2,
  height: 36,
  padding: "0 8px",
}));

const TabButton = styled.button<{ $active: boolean }>(({ $active, theme }) => ({
  alignItems: "center",
  background: "none",
  border: 0,
  boxShadow: $active ? `inset 0 -2px 0 0 ${theme.color.secondary}` : "none",
  color: $active ? theme.color.secondary : theme.textMutedColor,
  cursor: "pointer",
  display: "inline-flex",
  fontFamily: "inherit",
  fontSize: theme.typography.size.s1,
  fontWeight: $active
    ? theme.typography.weight.bold
    : theme.typography.weight.regular,
  gap: 6,
  height: "100%",
  padding: "0 8px",
  "& svg": { height: 12, width: 12 },
  "&:hover:not(:disabled)": { color: theme.color.defaultText },
  "&:disabled": {
    color: theme.textMutedColor,
    cursor: "not-allowed",
    opacity: 0.5,
  },
}));

const Message = styled.div<{ $error?: boolean }>(({ $error, theme }) => ({
  background: $error ? theme.background.negative : theme.background.hoverable,
  borderBottom: `1px solid ${theme.appBorderColor}`,
  color: $error ? theme.color.negativeText : theme.color.defaultText,
  flexShrink: 0,
  fontSize: theme.typography.size.s1,
  lineHeight: "18px",
  padding: "10px 12px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
}));

const Viewport = styled.div(({ theme }) => ({
  background: theme.background.content,
  display: "flex",
  flex: 1,
  minHeight: 0,
  outline: "none",
  overflow: "auto",
  padding: 16,
  "&:focus-visible": {
    outline: `1px solid ${theme.color.secondary}`,
    outlineOffset: "-1px",
  },
}));

const Fill = styled.div({
  display: "flex",
  flex: 1,
  minHeight: 0,
});

const Snapshot = styled.img(({ theme }) => ({
  background: theme.background.preview,
  border: `1px solid ${theme.appBorderColor}`,
  borderRadius: theme.appBorderRadius,
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12)",
  display: "block",
  height: "auto",
  margin: "auto",
  maxWidth: "100%",
}));

const Placeholder = styled.p(({ theme }) => ({
  color: theme.textMutedColor,
  fontSize: theme.typography.size.s1,
  lineHeight: "18px",
  margin: "auto",
  maxWidth: 260,
  textAlign: "center",
}));
