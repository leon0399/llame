import { describe, expect, it } from "vitest";
import { applySelectorSuffix, type ReadTarget } from "./path";
import { outlineMarkdown } from "./markdown-outline";
import {
  MAX_READ_LINES,
  splitSourceLines,
  type SingleReadSuccess,
} from "./source-lines";
import { measureNativeModelOutput } from "./serialization";

function target(
  selector = "outline",
  extra: Partial<ReadTarget> = {},
): ReadTarget {
  return { ...applySelectorSuffix("/doc.md", selector), ...extra };
}

function read(
  source: string,
  selector = "outline",
  extra: Partial<ReadTarget> = {},
) {
  return outlineMarkdown(splitSourceLines(source), target(selector, extra));
}

function assertSuccess(value: unknown): asserts value is SingleReadSuccess {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    value.status !== "success"
  ) {
    throw new Error("Expected outline success");
  }
}

async function* asyncLines(lines: Array<string>): AsyncGenerator<string> {
  for (const line of lines) {
    const resolved = await Promise.resolve(line);
    yield resolved;
  }
}

describe("markdown outline reader", () => {
  it("emits structural lines and one excerpt per heading", async () => {
    const source = [
      "# Guide\n",
      "\n",
      "Intro sentence.\n",
      "\n",
      "## Install\n",
      "\n",
      "```bash\n",
      "echo install\n",
      "```\n",
      "\n",
      "\n",
      "## Use\n",
      "\n",
      "### Flags\n",
      "\n",
      "Flag text.\n",
    ].join("");
    await expect(read(source)).resolves.toMatchObject({
      representation: "outline",
      content:
        "1: # Guide\n3: Intro sentence.\n5: ## Install\n7: ```bash\n12: ## Use\n14: ### Flags\n16: Flag text.\n",
      requestedRange: { startLine: 1, endLine: 16 },
      shownRange: { startLine: 1, endLine: 16 },
      truncated: false,
    });
  });

  it("keeps setext heading lines verbatim", async () => {
    await expect(read("\n\nTwo\n===\nbody\n")).resolves.toMatchObject({
      content: "3: Two\n4: ===\n5: body\n",
    });
  });

  it("cuts long lines at 120 UTF-16 units without splitting a surrogate", async () => {
    const exact = "# " + "x".repeat(118);
    const long = "# " + "x".repeat(117) + "😀";
    await expect(read(`${exact}\n${long}\n`)).resolves.toMatchObject({
      content: `1: ${exact}\n2: ${"# " + "x".repeat(117)}…\n`,
    });
  });

  it("handles headingless, duplicate, and empty documents", async () => {
    await expect(read("\n\nopening\nsecond\n")).resolves.toMatchObject({
      content: "3: opening\n",
      shownRange: { startLine: 3, endLine: 3 },
    });
    await expect(
      read("\n\n## Notes\nfirst\n" + "\n".repeat(34) + "## Notes\nsecond\n"),
    ).resolves.toMatchObject({
      content: "3: ## Notes\n4: first\n39: ## Notes\n40: second\n",
    });
    await expect(read("")).resolves.toMatchObject({
      content: "",
      requestedRange: null,
      shownRange: null,
      truncated: false,
    });
    await expect(read("", "outline:1")).resolves.toMatchObject({
      content: "",
      requestedRange: null,
      shownRange: null,
      truncated: false,
    });
    await expect(read("", "outline:2")).rejects.toMatchObject({
      type: "invalid_selector",
    });
  });

  it("renders frontmatter keys, elision, malformed content, and CRLF", async () => {
    const keys = Array.from(
      { length: 60 },
      (_, index) => `key${index}: value\n`,
    ).join("");
    const source = `---\n${keys}  indented\n# hidden\n- item\n---\n# Body\ntext\n`;
    const result = await read(source);
    expect(result).toMatchObject({
      content: `1: ---\n${Array.from({ length: 32 }, (_, index) => `${index + 2}: key${index}: value\n`).join("")}[… 28 more frontmatter lines]\n65: ---\n66: # Body\n67: text\n`,
    });
    await expect(read("---\ntitle: x\n# Body\n")).resolves.toMatchObject({
      content: "1: ---\n3: # Body\n",
    });
    await expect(
      read("---\nnot: [valid\n---\n# Body\n"),
    ).resolves.toMatchObject({
      content: "1: ---\n2: not: [valid\n3: ---\n4: # Body\n",
    });
    await expect(
      read("---\r\ntitle: X\r\n---\r\n# Body\r\n"),
    ).resolves.toMatchObject({
      content: "1: ---\r\n2: title: X\r\n3: ---\r\n4: # Body\r\n",
    });
    await expect(
      read(
        "---\ntags:\n  - notes\ntitle: >\n  folded\n# comment\n---\n# Body\n",
      ),
    ).resolves.toMatchObject({
      content: "1: ---\n2: tags:\n4: title: >\n7: ---\n8: # Body\n",
    });
    await expect(
      read("---\ntitle: x\n---\n# Body\n", "outline:2-2"),
    ).resolves.toMatchObject({
      content: "2: title: x\n",
      requestedRange: { startLine: 2, endLine: 2 },
      shownRange: { startLine: 2, endLine: 2 },
    });
  });

  it("prepends ancestors for a scoped outline and rejects a scope past EOF", async () => {
    const lines = Array<string>(100).fill("");
    lines[0] = "# Title";
    lines[1] = "Title excerpt";
    lines[29] = "## Setup";
    lines[30] = "Setup excerpt";
    lines[43] = "### Linux";
    lines[44] = "Linux excerpt";
    lines[69] = "### macOS";
    lines[70] = "macOS excerpt";
    lines[99] = "## Use";
    const source = `${lines.join("\n")}\n`;
    await expect(read(source, "outline:65")).resolves.toMatchObject({
      content:
        "1: # Title\n2: Title excerpt\n30: ## Setup\n31: Setup excerpt\n44: ### Linux\n45: Linux excerpt\n",
      requestedRange: { startLine: 65, endLine: 65 },
    });
    await expect(read(source, "outline:60-90")).resolves.toMatchObject({
      content:
        "1: # Title\n2: Title excerpt\n30: ## Setup\n31: Setup excerpt\n44: ### Linux\n45: Linux excerpt\n70: ### macOS\n71: macOS excerpt\n",
    });
    await expect(
      read("# only\n".repeat(120), "outline:500-600"),
    ).rejects.toMatchObject({
      type: "invalid_selector",
    });
    await expect(read("# A\n# B\n", "outline:2")).resolves.toMatchObject({
      content: "2: # B\n",
    });
    await expect(
      read("# H\n\nopening\n", "outline:2-3"),
    ).resolves.toMatchObject({
      content: "1: # H\n3: opening\n",
    });
  });

  it("obeys line and serialized bounds and reports zero-based continuation", async () => {
    const source = "#\n".repeat(MAX_READ_LINES + 4);
    const first = await read(source, "outline", { reserveCodeUnits: -10_000 });
    assertSuccess(first);
    expect(first.truncated).toBe(true);
    expect(first.nextOffset).toBe(MAX_READ_LINES);
    expect(first.content.split("\n").filter(Boolean)).toHaveLength(
      MAX_READ_LINES,
    );
    await expect(
      read(source, `outline:${first.nextOffset! + 1}-${first.nextOffset! + 1}`),
    ).resolves.toMatchObject({
      content: `${first.nextOffset! + 1}: #\n`,
    });

    const budgeted = await read("# one\n# two\n# three\n", "outline", {
      reserveCodeUnits: 15_800,
    });
    assertSuccess(budgeted);
    expect(budgeted.truncated).toBe(true);
    expect(budgeted.nextOffset).toBe(0);
    expect(measureNativeModelOutput(budgeted)).toBeLessThanOrEqual(
      16_000 - 15_800,
    );
    const rangeBudgeted = await read("# H\n" + "\n".repeat(9), "outline", {
      reserveCodeUnits: 15_782,
    });
    assertSuccess(rangeBudgeted);
    expect(measureNativeModelOutput(rangeBudgeted)).toBeLessThanOrEqual(
      16_000 - 15_782,
    );
  });

  it("stops an iterable at the scope end and accepts async lines", async () => {
    function* guarded(): Generator<string> {
      yield "# H\n";
      yield "body\n";
      yield "## Child\n";
      yield "\n";
      throw new Error("pulled past scope");
    }
    await expect(
      outlineMarkdown(guarded(), target("outline:1-3")),
    ).resolves.toMatchObject({
      content: "1: # H\n2: body\n3: ## Child\n",
    });
    await expect(
      outlineMarkdown(asyncLines(splitSourceLines("# H\nbody\n")), target()),
    ).resolves.toMatchObject({ content: "1: # H\n2: body\n" });
  });
  it("waits for a setext underline before stopping at the scope end", async () => {
    let pulled = 0;
    function* straddling(): Generator<string> {
      for (const line of [
        "intro\n",
        "\n",
        "# A\n",
        "Text\n",
        "===\n",
        "after\n",
      ]) {
        pulled += 1;
        yield line;
      }
    }
    await expect(
      outlineMarkdown(straddling(), target("outline:4-4")),
    ).resolves.toMatchObject({
      content: "4: Text\n",
      shownRange: { startLine: 4, endLine: 4 },
    });
    expect(pulled).toBe(5);
  });

  it("keeps BOM and native line numbering", async () => {
    await expect(read("\ufeff# Title\r\nbody\rnext\n")).resolves.toMatchObject({
      content: "1: \ufeff# Title\r\n2: body\rnext\n",
      shownRange: { startLine: 1, endLine: 2 },
    });
  });
});
