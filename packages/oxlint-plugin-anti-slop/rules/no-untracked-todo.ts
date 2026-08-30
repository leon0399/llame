import { defineRule } from "@oxlint/plugins";

/**
 * A deferral marker must name the issue that owns it.
 *
 * `TODO(#123): ...` is a pointer into tracked work — someone owns it and it can
 * be found again. A bare `TODO: handle this properly` is a note to nobody: it
 * records that the author knew the code was incomplete and shipped it anyway,
 * and it accumulates because nothing ever fails on account of it. Agents
 * produce the bare form freely, which is why this is a lint error rather than a
 * convention.
 *
 * `FIXME`, `XXX`, and `HACK` have no tracked form at all here — they say the
 * same thing as `TODO` with more alarm and less information. Use `TODO(#n)`, or
 * fix it.
 */
const TRACKED = /^(?:TODO)\(#\d+(?:\/#?\d+)*\)/u;
const MARKER = /(?<![A-Za-z0-9_])(TODO|FIXME|XXX|HACK)(?![A-Za-z0-9_])/giu;

export const noUntrackedTodoRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a deferral marker to reference its issue: `TODO(#123)`, never a bare TODO/FIXME/XXX/HACK.",
    },
    messages: {
      untracked:
        "`{{marker}}` names no issue. Write `TODO(#123): ...` so the deferral is owned and findable, or resolve it now.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          // Reset between comments: the matcher is global and stateful.
          MARKER.lastIndex = 0;
          const found = MARKER.exec(comment.value);
          if (!found) continue;

          // Only the first marker in a comment is reported; a block comment
          // listing several deferrals is one problem, not four.
          const trailing = comment.value.slice(found.index);
          if (TRACKED.test(trailing)) continue;

          context.report({
            node: comment,
            messageId: "untracked",
            data: { marker: found[1] },
          });
        }
      },
    };
  },
});
