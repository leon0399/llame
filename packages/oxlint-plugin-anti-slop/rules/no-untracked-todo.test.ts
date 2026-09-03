import { RuleTester } from "oxlint/plugins-dev";

import { noUntrackedTodoRule } from "./no-untracked-todo.ts";

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const error = { messageId: "untracked" };

tester.run("anti-slop/no-untracked-todo", noUntrackedTodoRule, {
  valid: [
    "// TODO(#599): research the canonical shape before changing this.",
    "/* TODO(#187): the walk exhausts before the cursor does. */",
    "// TODO(#187/#417): both issues touch this path.",
    "// Nothing deferred here.",
    // Not a marker: substring of a longer identifier-ish word.
    "// TODOS_LIST is a variable name, not a deferral.",
  ],
  invalid: [
    { code: "// TODO: handle this properly", errors: [error] },
    { code: "// TODO handle this properly", errors: [error] },
    {
      code: "// FIXME(#123): tracked, but FIXME has no tracked form",
      errors: [error],
    },
    { code: "/* XXX this is wrong */", errors: [error] },
    { code: "// HACK: works for now", errors: [error] },
    // One report per comment, not one per marker.
    { code: "/* TODO: a\n   FIXME: b\n   XXX: c */", errors: [error] },
  ],
});
