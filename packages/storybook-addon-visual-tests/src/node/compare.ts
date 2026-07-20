import { createHash } from "node:crypto";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import type { BaselineMetadata } from "../shared/results.js";

export const COMPARATOR_POLICY = {
  name: "pixelmatch",
  threshold: 0.1,
  includeAA: false,
} as const;

export interface ComparePngsOptions {
  baseline?: Buffer;
  baselineMetadata?: unknown;
  candidate: Buffer;
  candidateMetadata?: unknown;
}

export interface ComparisonResult {
  status: "new" | "passed" | "changed";
  message?: string;
  baselineSha256?: string;
  candidateSha256: string;
  diff?: Buffer;
  diffPixels: number;
  diffRatio: number;
  width: number;
  height: number;
}

export function comparePngs(options: ComparePngsOptions): ComparisonResult {
  const candidateSha256 = sha256(options.candidate);
  const candidate = PNG.sync.read(options.candidate);

  if (!options.baseline) {
    return {
      status: "new",
      candidateSha256,
      diffPixels: 0,
      diffRatio: 0,
      width: candidate.width,
      height: candidate.height,
    };
  }

  const baselineSha256 = sha256(options.baseline);
  const baseline = PNG.sync.read(options.baseline);
  const width = Math.max(baseline.width, candidate.width);
  const height = Math.max(baseline.height, candidate.height);
  const baselineCanvas = padImage(baseline, width, height);
  const candidateCanvas = padImage(candidate, width, height);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    baselineCanvas,
    candidateCanvas,
    diff.data,
    width,
    height,
    COMPARATOR_POLICY,
  );
  const diffRatio = diffPixels / (width * height);

  const storedMetadata = parseBaselineMetadata(options.baselineMetadata);
  const currentMetadata = parseBaselineMetadata(options.candidateMetadata);
  const message = incompatibilityReason({
    storedMetadata,
    currentMetadata,
    baselineSha256,
    candidateSha256,
    dimensionsChanged:
      baseline.width !== candidate.width ||
      baseline.height !== candidate.height,
  });
  const status = diffPixels === 0 && !message ? "passed" : "changed";

  return {
    status,
    ...(message ? { message } : {}),
    baselineSha256,
    candidateSha256,
    diff: PNG.sync.write(diff),
    diffPixels,
    diffRatio,
    width,
    height,
  };
}

export function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseBaselineMetadata(
  value: unknown,
): BaselineMetadata | undefined {
  if (!isExactRecord(value, METADATA_KEYS)) return undefined;
  if (
    value.schemaVersion !== 1 ||
    typeof value.baselineSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.baselineSha256) ||
    typeof value.platform !== "string" ||
    value.platform.length === 0 ||
    !isPositiveNumber(value.deviceScaleFactor) ||
    !isExactRecord(value.browser, BROWSER_KEYS) ||
    typeof value.browser.name !== "string" ||
    value.browser.name.length === 0 ||
    typeof value.browser.version !== "string" ||
    value.browser.version.length === 0 ||
    typeof value.browser.playwrightVersion !== "string" ||
    value.browser.playwrightVersion.length === 0 ||
    !isExactRecord(value.viewport, VIEWPORT_KEYS) ||
    !isPositiveInteger(value.viewport.width) ||
    !isPositiveInteger(value.viewport.height) ||
    !isExactRecord(value.comparator, COMPARATOR_KEYS) ||
    value.comparator.name !== COMPARATOR_POLICY.name ||
    value.comparator.threshold !== COMPARATOR_POLICY.threshold ||
    value.comparator.includeAA !== COMPARATOR_POLICY.includeAA
  ) {
    return undefined;
  }

  return value as unknown as BaselineMetadata;
}

const METADATA_KEYS = [
  "schemaVersion",
  "baselineSha256",
  "browser",
  "platform",
  "viewport",
  "deviceScaleFactor",
  "comparator",
] as const;
const BROWSER_KEYS = ["name", "version", "playwrightVersion"] as const;
const VIEWPORT_KEYS = ["width", "height"] as const;
const COMPARATOR_KEYS = ["name", "threshold", "includeAA"] as const;

function incompatibilityReason(options: {
  storedMetadata?: BaselineMetadata;
  currentMetadata?: BaselineMetadata;
  baselineSha256: string;
  candidateSha256: string;
  dimensionsChanged: boolean;
}): string | undefined {
  if (!options.storedMetadata)
    return "Baseline metadata is missing or malformed";
  if (options.storedMetadata.baselineSha256 !== options.baselineSha256) {
    return "Baseline metadata hash does not match baseline image";
  }
  if (!options.currentMetadata)
    return "Candidate metadata is missing or malformed";
  if (options.currentMetadata.baselineSha256 !== options.candidateSha256) {
    return "Candidate metadata hash does not match candidate image";
  }
  if (!compatibleMetadata(options.storedMetadata, options.currentMetadata)) {
    return "Baseline environment metadata is incompatible with the candidate";
  }
  if (options.dimensionsChanged) return "Image dimensions changed";
  return undefined;
}

function compatibleMetadata(
  baseline: BaselineMetadata,
  candidate: BaselineMetadata,
): boolean {
  return (
    baseline.schemaVersion === candidate.schemaVersion &&
    baseline.browser.name === candidate.browser.name &&
    baseline.browser.version === candidate.browser.version &&
    baseline.browser.playwrightVersion ===
      candidate.browser.playwrightVersion &&
    baseline.platform === candidate.platform &&
    baseline.viewport.width === candidate.viewport.width &&
    baseline.viewport.height === candidate.viewport.height &&
    baseline.deviceScaleFactor === candidate.deviceScaleFactor &&
    baseline.comparator.name === candidate.comparator.name &&
    baseline.comparator.threshold === candidate.comparator.threshold &&
    baseline.comparator.includeAA === candidate.comparator.includeAA
  );
}

function padImage(image: PNG, width: number, height: number): Buffer {
  if (image.width === width && image.height === height) return image.data;
  const canvas = Buffer.alloc(width * height * 4);
  for (let row = 0; row < image.height; row += 1) {
    image.data.copy(
      canvas,
      row * width * 4,
      row * image.width * 4,
      (row + 1) * image.width * 4,
    );
  }
  return canvas;
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
