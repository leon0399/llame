export type VisualResultStatus =
  | "queued"
  | "running"
  | "new"
  | "changed"
  | "passed"
  | "capture-error"
  | "cancelled";

export interface VisualArtifactIds {
  baseline?: string;
  candidate?: string;
  diff?: string;
}

export interface VisualResult {
  runId: string;
  storyId: string;
  title: string;
  importPath: string;
  environmentKey: string;
  status: VisualResultStatus;
  message?: string;
  diffPixels?: number;
  diffRatio?: number;
  candidateSha256?: string;
  artifacts?: VisualArtifactIds;
}

export interface VisualRunState {
  runId?: string;
  running: boolean;
  results: VisualResult[];
}

export interface BaselineMetadata {
  schemaVersion: 1;
  baselineSha256: string;
  browser: {
    name: string;
    version: string;
    playwrightVersion: string;
  };
  platform: string;
  viewport: {
    width: number;
    height: number;
  };
  deviceScaleFactor: number;
  comparator: {
    name: "pixelmatch";
    threshold: 0.1;
    includeAA: false;
  };
}
