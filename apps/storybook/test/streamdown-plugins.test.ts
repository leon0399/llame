import { describe, expect, test } from "vitest";

import { assertSafeMermaidSource } from "@workspace/ui/components/ai-elements/streamdown-plugins";

describe("Streamdown Mermaid plugin", () => {
  test("rejects Mermaid image nodes before they can request an external URL", () => {
    expect(() =>
      assertSafeMermaidSource(
        'flowchart LR\n  attacker@{ img: "https://attacker.example/pixel" }',
      ),
    ).toThrow("Mermaid image nodes are not supported");
  });

  test("allows Mermaid diagrams without image nodes", () => {
    expect(() =>
      assertSafeMermaidSource("flowchart LR\n  API --> Worker"),
    ).not.toThrow();
  });
});
