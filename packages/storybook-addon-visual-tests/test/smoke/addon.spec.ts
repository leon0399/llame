import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

test("runs, reviews, approves, and reruns from inside Storybook", async ({
  page,
}) => {
  await page.goto("/?path=/story/visual-fixture--portal");

  const panelTab = page.getByRole("tab", { name: "Visual tests" });
  await expect(panelTab).toBeVisible({ timeout: 15_000 });
  await panelTab.click();
  const visualPanel = page.getByRole("region", { name: "Visual tests" });
  await visualPanel
    .getByRole("button", { name: "Run visual tests" })
    .last()
    .click();
  await expect(page.getByText("new", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(
    page.getByAltText("candidate for Visual Fixture / Portal"),
  ).toBeVisible();

  const artifactDirectory = path.join(
    process.cwd(),
    "test/.tmp/project/src/__screenshots__/visual-fixture.stories.tsx.visual/visual-fixture--portal/chromium-1280x720@1x",
  );
  const candidate = await readFile(
    path.join(artifactDirectory, "candidate.png"),
  );
  const image = PNG.sync.read(candidate);
  expect(image.width).toBeLessThan(1280);
  expect(image.height).toBeLessThan(720);
  expect(hasPixel(image, [0, 180, 90])).toBe(true);
  expect(hasPixel(image, [20, 80, 220])).toBe(true);
  expect(hasPixel(image, [200, 30, 30])).toBe(false);

  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("passed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect(await readFile(path.join(artifactDirectory, "baseline.png"))).toEqual(
    candidate,
  );

  await visualPanel.getByRole("button", { name: "Run visual tests" }).click();
  await expect(page.getByText("passed", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
});

function hasPixel(image: PNG, rgb: [number, number, number]): boolean {
  for (let index = 0; index < image.data.length; index += 4) {
    if (
      image.data[index] === rgb[0] &&
      image.data[index + 1] === rgb[1] &&
      image.data[index + 2] === rgb[2]
    ) {
      return true;
    }
  }
  return false;
}
