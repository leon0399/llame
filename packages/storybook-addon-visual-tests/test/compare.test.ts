import { createHash } from "node:crypto";

import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";

import { comparePngs } from "../src/node/compare.js";
import type { BaselineMetadata } from "../src/shared/results.js";

function png(width: number, height: number, pixels: number[][]): Buffer {
  const image = new PNG({ width, height });
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    const [red = 0, green = 0, blue = 0, alpha = 255] = pixels[index]!;
    image.data.set([red, green, blue, alpha], offset);
  }
  return PNG.sync.write(image);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function metadata(baseline: Buffer, overrides: Partial<BaselineMetadata> = {}) {
  return {
    schemaVersion: 1,
    baselineSha256: sha256(baseline),
    browser: {
      name: "chromium",
      version: "136.0.0",
      playwrightVersion: "1.53.2",
    },
    platform: "linux",
    viewport: { width: 2, height: 1 },
    deviceScaleFactor: 1,
    comparator: { name: "pixelmatch", threshold: 0.1, includeAA: false },
    ...overrides,
  } satisfies BaselineMetadata;
}

describe("comparePngs", () => {
  const black = png(2, 1, [
    [0, 0, 0],
    [0, 0, 0],
  ]);

  test("reports a missing baseline as new", () => {
    expect(comparePngs({ candidate: black })).toMatchObject({
      status: "new",
      candidateSha256: sha256(black),
    });
  });

  test("passes identical pixels with compatible metadata", () => {
    expect(
      comparePngs({
        baseline: black,
        baselineMetadata: metadata(black),
        candidate: black,
        candidateMetadata: metadata(black),
      }),
    ).toMatchObject({ status: "passed", diffPixels: 0, diffRatio: 0 });
  });

  test("returns a diff when any pixel changes", () => {
    const changed = png(2, 1, [
      [255, 255, 255],
      [0, 0, 0],
    ]);

    const result = comparePngs({
      baseline: black,
      baselineMetadata: metadata(black),
      candidate: changed,
      candidateMetadata: metadata(changed),
    });

    expect(result).toMatchObject({
      status: "changed",
      diffPixels: 1,
      diffRatio: 0.5,
      width: 2,
      height: 1,
    });
    expect(PNG.sync.read(result.diff!)).toMatchObject({ width: 2, height: 1 });
  });

  test("renders a deterministic max-dimension diff", () => {
    const larger = png(3, 2, [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);

    const result = comparePngs({
      baseline: black,
      baselineMetadata: metadata(black),
      candidate: larger,
      candidateMetadata: metadata(larger, {
        viewport: { width: 3, height: 2 },
      }),
    });

    expect(result).toMatchObject({ status: "changed", width: 3, height: 2 });
    expect(PNG.sync.read(result.diff!)).toMatchObject({ width: 3, height: 2 });
  });

  test.each([
    ["malformed metadata", { schemaVersion: 1 }],
    ["baseline hash mismatch", metadata(Buffer.from("not the baseline"))],
    ["environment mismatch", metadata(black, { platform: "darwin" })],
  ])(
    "requires review for %s even when pixels match",
    (_name, baselineMetadata) => {
      const result = comparePngs({
        baseline: black,
        baselineMetadata,
        candidate: black,
        candidateMetadata: metadata(black),
      });

      expect(result).toMatchObject({
        status: "changed",
        diffPixels: 0,
        diffRatio: 0,
      });
      expect(result.message).toBeTruthy();
    },
  );

  test("requires review when candidate metadata does not describe candidate bytes", () => {
    const result = comparePngs({
      baseline: black,
      baselineMetadata: metadata(black),
      candidate: black,
      candidateMetadata: metadata(Buffer.from("not the candidate")),
    });

    expect(result).toMatchObject({ status: "changed", diffPixels: 0 });
    expect(result.message).toMatch(/candidate metadata hash/i);
  });
});
