import {
  STORY_FINISHED,
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

addons.getChannel().on(STORY_FINISHED, (payload: StoryFinishedPayload) => {
  globalThis.__LLAME_VISUAL_TESTS__?.report({
    storyId: payload.storyId,
    status:
      payload.status === "error" &&
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
  const capture =
    context.parameters?.visualTests?.capture ??
    (context.parameters?.layout === "fullscreen" ? "viewport" : "content");
  globalThis.__LLAME_VISUAL_TESTS__?.report({
    storyId: context.id,
    disabled: context.parameters?.visualTests?.disable === true,
    capture,
  });
}
