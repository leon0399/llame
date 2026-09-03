import mermaid from "mermaid";
import { describe, expect, test } from "vitest";

import { streamdownPlugins } from "@workspace/ui/components/ai-elements/streamdown-plugins";

describe("Streamdown Mermaid security configuration", () => {
  test("pins image-related settings against diagram directives", () => {
    const plugin = streamdownPlugins.mermaid;
    if (!plugin) {
      throw new Error("Streamdown Mermaid plugin is not configured");
    }

    plugin.getMermaid({});
    const config = mermaid.mermaidAPI.getConfig();

    expect(config.htmlLabels).toBe(false);
    expect(config.secure).toEqual(
      expect.arrayContaining(["htmlLabels", "dompurifyConfig"]),
    );
    expect(config.dompurifyConfig).toEqual({
      FORBID_TAGS: expect.arrayContaining(["img", "image"]),
    });
  });
});
