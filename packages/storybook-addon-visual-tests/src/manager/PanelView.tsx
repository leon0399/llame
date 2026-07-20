import React, { useMemo, useState } from "react";

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
  const [selectedStoryId, setSelectedStoryId] = useState<string>();
  const [imageKind, setImageKind] = useState<ImageKind>("diff");
  const selected = useMemo(
    () =>
      state.results.find((result) => result.storyId === selectedStoryId) ??
      state.results[0],
    [selectedStoryId, state.results],
  );

  if (!available) {
    return (
      <section style={styles.empty}>
        <h2 style={styles.heading}>Visual tests unavailable</h2>
        <p style={styles.muted}>
          Run Storybook in development mode to capture and approve local images.
        </p>
      </section>
    );
  }

  return (
    <section style={styles.root} aria-label="Visual tests">
      <header style={styles.toolbar}>
        <strong>Visual tests</strong>
        <span style={styles.spacer} />
        <button
          type="button"
          disabled={state.running || !currentStoryId}
          onClick={() =>
            currentStoryId &&
            onCommand({
              type: "run",
              scope: "current",
              storyId: currentStoryId,
            })
          }
        >
          Run current
        </button>
        <button
          type="button"
          disabled={state.running}
          onClick={() => onCommand({ type: "run", scope: "all" })}
        >
          Run all
        </button>
        {state.running ? (
          <button type="button" onClick={() => onCommand({ type: "cancel" })}>
            Cancel
          </button>
        ) : null}
      </header>

      {state.results.length === 0 ? (
        <div style={styles.empty}>
          <p style={styles.muted}>No visual results yet.</p>
        </div>
      ) : (
        <div style={styles.content}>
          <ol style={styles.list} aria-label="Visual test results">
            {state.results.map((result) => (
              <li key={`${result.storyId}:${result.environmentKey}`}>
                <button
                  type="button"
                  style={styles.resultButton}
                  aria-current={selected?.storyId === result.storyId}
                  onClick={() => setSelectedStoryId(result.storyId)}
                >
                  <span>{result.title}</span>
                  <Status status={result.status} />
                </button>
              </li>
            ))}
          </ol>
          {selected ? (
            <ResultReview
              result={selected}
              runId={state.runId}
              imageKind={imageKind}
              setImageKind={setImageKind}
              onCommand={onCommand}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

function Status({ status }: { status: VisualResult["status"] }) {
  return <small style={styles.status}>{status}</small>;
}

function ResultReview({
  result,
  runId,
  imageKind,
  setImageKind,
  onCommand,
}: {
  result: VisualResult;
  runId?: string;
  imageKind: ImageKind;
  setImageKind: (kind: ImageKind) => void;
  onCommand: (command: VisualCommand) => void;
}) {
  const artifactId = result.artifacts?.[imageKind];
  const reviewable =
    (result.status === "new" || result.status === "changed") &&
    runId &&
    result.candidateSha256;

  return (
    <article style={styles.review}>
      <header style={styles.reviewHeader}>
        <div>
          <h2 style={styles.heading}>{result.title}</h2>
          <p style={styles.muted}>{result.storyId}</p>
        </div>
        {reviewable ? (
          <button
            type="button"
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
            Approve candidate
          </button>
        ) : null}
      </header>
      <nav style={styles.tabs} aria-label="Visual artifact">
        {(["baseline", "candidate", "diff"] as const).map((kind) => (
          <button
            type="button"
            key={kind}
            disabled={!result.artifacts?.[kind]}
            aria-pressed={imageKind === kind}
            onClick={() => setImageKind(kind)}
          >
            {kind}
          </button>
        ))}
      </nav>
      {artifactId ? (
        <img
          alt={`${imageKind} for ${result.title}`}
          src={`${ARTIFACT_ROUTE}/${encodeURIComponent(artifactId)}`}
          style={styles.image}
        />
      ) : (
        <p style={styles.empty}>No {imageKind} image for this result.</p>
      )}
      {result.message ? <p role="alert">{result.message}</p> : null}
    </article>
  );
}

const border = "1px solid color-mix(in srgb, currentColor 18%, transparent)";
const styles = {
  root: { height: "100%", display: "flex", flexDirection: "column" },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderBottom: border,
  },
  spacer: { flex: 1 },
  content: {
    display: "grid",
    gridTemplateColumns: "280px minmax(0, 1fr)",
    minHeight: 0,
    flex: 1,
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 8,
    overflow: "auto",
    borderRight: border,
  },
  resultButton: {
    display: "flex",
    justifyContent: "space-between",
    width: "100%",
    gap: 8,
    padding: "8px 10px",
    textAlign: "left",
  },
  status: { opacity: 0.7 },
  review: { padding: 12, overflow: "auto" },
  reviewHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
  },
  heading: { margin: 0, fontSize: 14 },
  muted: { margin: "4px 0", opacity: 0.65 },
  tabs: { display: "flex", gap: 6, margin: "12px 0" },
  image: { display: "block", maxWidth: "100%", border: border },
  empty: { padding: 24, textAlign: "center" },
} as const;
