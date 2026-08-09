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

  test("rejects image nodes after a quoted closing brace", () => {
    expect(() =>
      assertSafeMermaidSource(
        'flowchart LR\n  attacker@{ label: "quoted } brace", img: "https://attacker.example/pixel" }',
      ),
    ).toThrow("Mermaid image nodes are not supported");
  });

  test.each([
    "flowchart LR\n  attacker[\"<img src='https://attacker.example/pixel'>\"]",
    'flowchart LR\n  attacker["![pixel](https://attacker.example/pixel)"]',
    '%%{init: {"htmlLabels": true}}%%\nflowchart LR\n  attacker["<img src=\'https://attacker.example/pixel\'>"]',
  ])("rejects image-capable labels before Mermaid renders them", (source) => {
    expect(() => assertSafeMermaidSource(source)).toThrow(
      "Mermaid image nodes are not supported",
    );
  });

  test.each([
    "%% img: this is a comment\nflowchart LR\n  API --> Worker",
    'flowchart LR\n  note["Literal img: text"]',
    'flowchart LR\n  note@{ label: "Literal img: text", shape: rect }',
  ])("allows non-rendering image syntax in comments and labels", (source) => {
    expect(() => assertSafeMermaidSource(source)).not.toThrow();
  });

  test("allows Mermaid diagrams without image nodes", () => {
    expect(() =>
      assertSafeMermaidSource("flowchart LR\n  API --> Worker"),
    ).not.toThrow();
  });
});
