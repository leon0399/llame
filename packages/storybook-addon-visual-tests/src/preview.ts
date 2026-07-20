import {
  STORY_FINISHED,
  UNHANDLED_ERRORS_WHILE_PLAYING,
  type StoryFinishedPayload,
} from "storybook/internal/core-events";
import { addons } from "storybook/preview-api";

import type { VisualCaptureMode } from "./shared/capture.js";

export interface VisualPreviewReport {
  storyId: string;
  status?: "error" | "success";
  disabled?: boolean;
  capture?: VisualCaptureMode;
}

declare global {
  var __LLAME_VISUAL_TESTS__:
    | {
        report(report: VisualPreviewReport): void;
        wait(storyId: string): Promise<VisualPreviewReport>;
        get(storyId: string): VisualPreviewReport | undefined;
      }
    | undefined;
}

const storiesWithUnhandledErrors = new Set<string>();
let activeStoryId: string | undefined;
const channel = addons.getChannel();

channel.on(UNHANDLED_ERRORS_WHILE_PLAYING, () => {
  if (activeStoryId) storiesWithUnhandledErrors.add(activeStoryId);
});

channel.on(STORY_FINISHED, (payload: StoryFinishedPayload) => {
  const hasUnhandledErrors = storiesWithUnhandledErrors.has(payload.storyId);
  storiesWithUnhandledErrors.delete(payload.storyId);
  globalThis.__LLAME_VISUAL_TESTS__?.report({
    storyId: payload.storyId,
    status:
      payload.status === "error" &&
      !hasUnhandledErrors &&
      payload.reporters.some((report) => report.status === "failed")
        ? "success"
        : payload.status,
  });
});

export function beforeEach(context: {
  id: string;
  parameters?: {
    layout?: "centered" | "fullscreen" | "padded";
    visualTests?: {
      capture?: VisualCaptureMode;
      disable?: boolean;
    };
  };
}): void {
  activeStoryId = context.id;
  storiesWithUnhandledErrors.delete(context.id);
  const capture =
    context.parameters?.visualTests?.capture ??
    (context.parameters?.layout === "fullscreen" ? "viewport" : "content");
  globalThis.__LLAME_VISUAL_TESTS__?.report({
    storyId: context.id,
    disabled: context.parameters?.visualTests?.disable === true,
    capture,
  });
}
