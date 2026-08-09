import { describe, expect, test } from "vitest";

import {
  assertSafeMermaidSource,
  normalizeMathDelimiters,
} from "@workspace/ui/components/ai-elements/streamdown-plugins";

describe("normalizeMathDelimiters", () => {
  test.each([
    ["Inline \\(E = mc^2\\) here.", "Inline $E = mc^2$ here."],
    ["Block \\[E = mc^2\\] here.", "Block $$E = mc^2$$ here."],
    ["Two \\(a\\) and \\(b\\) in one line.", "Two $a$ and $b$ in one line."],
    ["Spanning \\[\n  x = 1\n\\] lines.", "Spanning $$\n  x = 1\n$$ lines."],
  ])(
    "rewrites LaTeX delimiters remark-math cannot parse",
    (input, expected) => {
      expect(normalizeMathDelimiters(input)).toBe(expected);
    },
  );

  test.each([
    "No math here at all.",
    "Dollar math $E = mc^2$ is left alone.",
    "Inline code `\\(E = mc^2\\)` stays literal.",
    "```tex\n\\(E = mc^2\\)\n```",
    "~~~tex\n\\(E = mc^2\\)\n~~~",
    "Unterminated \\(E = mc^2 while streaming",
    "Unterminated \\[E = mc^2 while streaming",
  ])("leaves %j untouched", (input) => {
    expect(normalizeMathDelimiters(input)).toBe(input);
  });

  test("skips an unclosed fence still streaming in", () => {
    expect(normalizeMathDelimiters("```tex\n\\(E = mc^2\\)")).toBe(
      "```tex\n\\(E = mc^2\\)",
    );
  });

  test("rewrites prose around a fenced block without touching the block", () => {
    expect(
      normalizeMathDelimiters(
        "Before \\(a\\)\n\n```tex\n\\(b\\)\n```\n\nAfter \\(c\\)",
      ),
    ).toBe("Before $a$\n\n```tex\n\\(b\\)\n```\n\nAfter $c$");
  });

  // A code region at offset 0 is the case that would break if the split's
  // segment/capture parity ever shifted — a message opening with a fence is
  // ordinary model output, not an edge case.
  test.each([
    [
      "```tex\n\\(a\\)\n```\n\nAfter \\(b\\)",
      "```tex\n\\(a\\)\n```\n\nAfter $b$",
    ],
    ["`\\(a\\)` then \\(b\\)", "`\\(a\\)` then $b$"],
  ])("rewrites after a leading code region", (input, expected) => {
    expect(normalizeMathDelimiters(input)).toBe(expected);
  });
});

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
