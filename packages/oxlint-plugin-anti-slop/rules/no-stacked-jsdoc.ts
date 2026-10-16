import { defineRule } from "@oxlint/plugins";

/**
 * A JSDoc block must not be followed directly by another JSDoc block.
 *
 * Only the block closest to a declaration documents it; editors, TypeDoc and
 * hover text show that one. A block stacked above it documents nothing. It
 * is almost always a doc comment stranded when a helper, type or constant was
 * inserted between it and the declaration it describes, so it now sits on
 * the wrong symbol or on none, and readers take it as describing whatever
 * follows.
 *
 * A block that begins the file is a module overview, not a stray declaration
 * doc, so it may sit directly above the first declaration's own block.
 */
export const noStackedJsdocRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a JSDoc block directly followed by another JSDoc block; only the closest one documents the declaration.",
    },
    messages: {
      stacked:
        "This JSDoc block is followed directly by another, so it documents nothing: only the closest block attaches to the declaration. Move it to the declaration it describes, merge it into the next block, or delete it.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        const { sourceCode } = context;
        const text = sourceCode.text;
        const comments = sourceCode.getAllComments();
        for (let index = 0; index < comments.length - 1; index += 1) {
          const current = comments[index];
          const next = comments[index + 1];
          if (!current || !next || !isJsdoc(current) || !isJsdoc(next)) {
            continue;
          }
          const between = text.slice(current.range[1], next.range[0]);
          if (between.trim() !== "") continue;
          if (beginsFile(text, current.range[0])) continue;
          context.report({ node: current, messageId: "stacked" });
        }
      },
    };
  },
});

function isJsdoc(comment: { type: string; value: string }): boolean {
  return comment.type === "Block" && comment.value.startsWith("*");
}

/** Whether only whitespace or a shebang line precedes `offset`. */
function beginsFile(text: string, offset: number): boolean {
  return (
    text
      .slice(0, offset)
      .replace(/^#!.*\n/u, "")
      .trim() === ""
  );
}
