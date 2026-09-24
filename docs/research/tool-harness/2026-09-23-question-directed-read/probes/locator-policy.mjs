// Requires llame's Node/pnpm dependencies. No target file or model is opened.
// This evaluates exact published fixture regexes, not the whole authorizer.
import assert from "node:assert/strict";
import { PORTABLE_TOOL_PERMISSIONS } from "../../../../../apps/api/src/testing/portable-tool-policy.ts";

const rejects = PORTABLE_TOOL_PERMISSIONS.read.reject;
assert(Array.isArray(rejects));
const pathPatterns = rejects
  .filter(
    (clause) => clause.field === "path" && typeof clause.regex === "string",
  )
  .map((clause) => new RegExp(clause.regex));
const rejectedByExamplePatterns = (path) =>
  pathPatterns.some((pattern) => pattern.test(path));
const cases = [
  { source: "/p/.env", submitted: "/p/.env?q=what" },
  { source: "/p/.env.production", submitted: "/p/.env.production?q=x" },
  { source: "/h/.npmrc", submitted: "/h/.npmrc?question=token" },
];
const rows = cases.map(({ source, submitted }) => ({
  source,
  submitted,
  source_rejected: rejectedByExamplePatterns(source),
  unsplit_question_path_rejected: rejectedByExamplePatterns(submitted),
}));
assert(rows.every((row) => row.source_rejected));
assert(rows.every((row) => !row.unsplit_question_path_rejected));
assert(rejectedByExamplePatterns("/p/.env:1-5"));
console.log(
  JSON.stringify(
    {
      scope:
        "Recommended policy test fixture, not runtime defaults or a present ?q exploit.",
      condition:
        "A future delegate parser would bypass these resource rejects if it stripped question metadata only after permission matching.",
      required_boundary:
        "Disambiguate the grammar, then authorize the same parsed source identity the executor opens; preserve ordinary HTTP queries and literal filenames.",
      opened_target_files: 0,
      inference_calls: 0,
      rows,
    },
    null,
    2,
  ),
);
