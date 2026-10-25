import assert from "node:assert/strict";
import test from "node:test";

import { cleanBody, parsePrRef, parseSince, run } from "./fetch-pr-reviews.mjs";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

const thread = (id, overrides = {}) => ({
  id,
  isResolved: false,
  isOutdated: false,
  path: "src/file.ts",
  line: 12,
  originalLine: 10,
  resolvedBy: null,
  comments: {
    nodes: [
      {
        author: { login: "coderabbitai" },
        body: `Finding ${id}`,
        createdAt: "2026-10-24T10:00:00Z",
        lastEditedAt: null,
        url: `https://example.test/${id}`,
      },
    ],
  },
  ...overrides,
});

const review = (id, overrides = {}) => ({
  id,
  author: { login: "pullfrog" },
  state: "COMMENTED",
  body: `Review ${id}`,
  submittedAt: "2026-10-24T11:00:00Z",
  lastEditedAt: null,
  url: `https://example.test/${id}`,
  commit: { oid: HEAD },
  ...overrides,
});

const issueComment = (id, login, overrides = {}) => ({
  id,
  author: { login },
  body: `Comment ${id}`,
  createdAt: "2026-10-24T12:00:00Z",
  lastEditedAt: null,
  url: `https://example.test/${id}`,
  ...overrides,
});

/** Pages of each connection, as the GraphQL API would serve them. */
const PAGES = {
  reviewThreads: [
    [
      thread("T1"),
      thread("T2", { isResolved: true, resolvedBy: { login: "leon0399" } }),
    ],
    [thread("T3", { isOutdated: true, line: null })],
  ],
  reviews: [
    [
      review("R1"),
      review("R2", { body: "<!-- marker only -->" }),
      review("R3", {
        body: "",
        state: "APPROVED",
        author: { login: "coderabbitai" },
      }),
      review("R4", {
        commit: { oid: OLD },
        submittedAt: "2026-10-20T11:00:00Z",
      }),
    ],
  ],
  comments: [
    [
      issueComment("C1", "leon0399"),
      issueComment("C2", "codecov"),
      issueComment("C3", "coderabbitai", {
        createdAt: "2026-10-20T12:00:00Z",
        lastEditedAt: "2026-10-24T13:00:00Z",
      }),
    ],
  ],
};

/** A `gh` stand-in that answers GraphQL reads from PAGES and records calls. */
function fakeGh() {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === "repo") return "acme/widget\n";
    const query = args.find((arg) => arg.startsWith("query=")).slice(6);
    const connection = Object.keys(PAGES).find((name) =>
      query.includes(`${name}(`),
    );
    const cursor = args.find((arg) => arg.startsWith("cursor="));
    const page = cursor ? Number(cursor.slice(7)) : 0;
    const pages = PAGES[connection];
    const hasNextPage = page + 1 < pages.length;
    return JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            title: "Add the widget",
            url: "https://github.com/acme/widget/pull/7",
            state: "OPEN",
            headRefOid: HEAD,
            [connection]: {
              pageInfo: {
                hasNextPage,
                endCursor: hasNextPage ? String(page + 1) : null,
              },
              nodes: pages[page],
            },
          },
        },
      },
    });
  };
  return { gh, calls };
}

function runCapture(argv) {
  const { gh, calls } = fakeGh();
  const lines = [];
  const errors = [];
  const code = run(argv, {
    gh,
    out: (line) => lines.push(line),
    err: (line) => errors.push(line),
    now: Date.parse("2026-10-24T14:00:00Z"),
  });
  return { code, text: lines.join("\n"), errors, calls };
}

test("cleanBody drops markers, noise blocks, icons and long hashes", () => {
  const body = [
    "<!-- coderabbit-ai-generated:v1 -->",
    '**<picture><img src="https://x.test/amber.svg" alt=""></picture> Minor** · **Quick win**',
    "",
    "<details>",
    "<summary>🔎 Supported by static analysis</summary>",
    "Script executed: sed -n 1,10p file",
    "</details>",
    "",
    "**Replace the wrapper.**",
    "",
    `See ${HEAD} and <!-- internal state ${"Q".repeat(200)} -->.`,
    "",
    "Useful? React with 👍 / 👎.",
  ].join("\n");

  assert.equal(
    cleanBody(body),
    `**Minor** · **Quick win**\n\n**Replace the wrapper.**\n\nSee ${HEAD.slice(0, 10)} and .`,
  );
});

test("cleanBody keeps a finding nested under a summary and drops its agent prompt", () => {
  const body = [
    "**Actionable comments posted: 1**",
    "<details>",
    "<summary>🧹 Nitpick comments: 1</summary><blockquote>",
    "<details>",
    "<summary>src/a.ts: 1</summary>",
    "`3-4`: **Cover the setting.**",
    "<details>",
    "<summary>🤖 Prompt for AI Agents</summary>",
    "Restated finding",
    "</details>",
    "</details>",
    "</blockquote></details>",
  ].join("\n");

  const cleaned = cleanBody(body);
  assert.match(cleaned, /▸ 🧹 Nitpick comments: 1/);
  assert.match(cleaned, /▸ src\/a\.ts: 1/);
  assert.match(cleaned, /`3-4`: \*\*Cover the setting\.\*\*/);
  assert.doesNotMatch(cleaned, /Restated finding|Prompt for AI/);
});

test("cleanBody leaves code alone and turns badges into labels", () => {
  const body = [
    "**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow)</sub></sub> Fix it**",
    "Inline `<b>kept</b>` code.",
    "```diff",
    '-  <div className="w-80">',
    `+  const sha = "${HEAD}";`,
    "```",
  ].join("\n");

  assert.equal(
    cleanBody(body),
    [
      "**[P2] Fix it**",
      "Inline `<b>kept</b>` code.",
      "```diff",
      '-  <div className="w-80">',
      `+  const sha = "${HEAD}";`,
      "```",
    ].join("\n"),
  );
});

test("cleanBody compacts table padding and opaque runs", () => {
  const body = [
    "| Check     |   Status   |",
    "| :-------- | :--------: |",
    `| Docs      | ${"a1".repeat(45)} |`,
  ].join("\n");

  assert.equal(
    cleanBody(body),
    "| Check | Status |\n| --- | --- |\n| Docs | [blob] |",
  );
});

test("parsePrRef reads numbers, qualified references and URLs", () => {
  assert.deepEqual(parsePrRef("#12", "acme/widget"), {
    repo: "acme/widget",
    number: 12,
  });
  assert.deepEqual(parsePrRef("acme/gadget#3", "acme/widget"), {
    repo: "acme/gadget",
    number: 3,
  });
  assert.deepEqual(
    parsePrRef("https://github.com/acme/gadget/pull/9/files", null),
    {
      repo: "acme/gadget",
      number: 9,
    },
  );
  assert.throws(() => parsePrRef("12", null), /not a pull request reference/);
});

test("parseSince takes ages and dates", () => {
  const now = Date.parse("2026-10-24T14:00:00Z");
  assert.equal(
    parseSince("90m", now).toISOString(),
    "2026-10-24T12:30:00.000Z",
  );
  assert.equal(parseSince("2d", now).toISOString(), "2026-10-22T14:00:00.000Z");
  assert.equal(
    parseSince("2026-10-01", now).toISOString(),
    "2026-10-01T00:00:00.000Z",
  );
  assert.throws(() => parseSince("yesterday", now), /not a date/);
});

test("the default run lists unresolved threads, verdicts and human comments", () => {
  const { code, text, calls } = runCapture(["7"]);

  assert.equal(code, 0);
  // A bare number resolves the current repository once.
  assert.deepEqual(calls[0], [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]);
  assert.match(text, /^# acme\/widget#7 OPEN head aaaaaaaa — Add the widget$/m);
  // The second thread page was read: T3 is there, outdated, at its original line.
  assert.match(text, /^## threads 2\/3$/m);
  assert.match(text, /^- T1 src\/file\.ts:12 \[unresolved\]$/m);
  assert.match(text, /^- T3 src\/file\.ts:10 \[unresolved, outdated\]$/m);
  assert.doesNotMatch(text, /- T2 /);
  // An emptied COMMENTED review is a container; an empty approval is a verdict.
  assert.match(text, /^## reviews 3\/4$/m);
  assert.match(text, /^- @coderabbitai APPROVED 2026-10-24 11:00Z on head$/m);
  assert.match(text, /^- @pullfrog COMMENTED 2026-10-20 11:00Z on bbbbbbbb$/m);
  assert.doesNotMatch(text, /R2/);
  // Coverage bots stay out.
  assert.match(text, /^## comments 2\/3$/m);
  assert.doesNotMatch(text, /@codecov/);
});

test("filters narrow threads by resolution and outdatedness", () => {
  const resolved = runCapture([
    "acme/widget#7",
    "--threads",
    "resolved",
    "--kinds",
    "threads",
  ]);
  assert.match(
    resolved.text,
    /^- T2 src\/file\.ts:12 \[resolved by @leon0399\]$/m,
  );
  assert.doesNotMatch(resolved.text, /## reviews/);

  const current = runCapture([
    "acme/widget#7",
    "--outdated",
    "exclude",
    "--kinds",
    "threads",
  ]);
  assert.match(current.text, /^## threads 1\/3$/m);
});

test("filters narrow reviews to the head commit and items to a recent edit", () => {
  const head = runCapture([
    "acme/widget#7",
    "--current-head",
    "--kinds",
    "reviews",
  ]);
  assert.match(head.text, /^## reviews 2\/4$/m);
  assert.doesNotMatch(head.text, /on bbbbbbbb/);

  const recent = runCapture(["acme/widget#7", "--since", "90m"]);
  assert.match(recent.text, /^## threads 0\/3$/m);
  assert.match(recent.text, /^## reviews 0\/4$/m);
  // The edit, not the creation, decides whether a comment is recent.
  assert.match(recent.text, /^## comments 1\/3$/m);
  assert.match(recent.text, /^- @coderabbitai 2026-10-24 13:00Z /m);
});

test("author filters select, exclude, and readmit status bots", () => {
  const mine = runCapture([
    "acme/widget#7",
    "--author",
    "leon0399",
    "--kinds",
    "comments",
  ]);
  assert.match(mine.text, /^## comments 1\/3$/m);

  const bots = runCapture([
    "acme/widget#7",
    "--all-bots",
    "--exclude-author",
    "leon0399",
  ]);
  assert.match(bots.text, /@codecov/);
  assert.doesNotMatch(bots.text, /@leon0399/);
});

test("json, truncation, stats and help", () => {
  const json = runCapture([
    "acme/widget#7",
    "--json",
    "--max-chars",
    "4",
    "--stats",
  ]);
  const selection = JSON.parse(json.text);
  assert.equal(selection.threads[0].comments[0].body, "Find… [6 more chars]");
  assert.deepEqual(selection.totals, { threads: 3, reviews: 4, comments: 3 });
  assert.match(json.errors[0], /^acme\/widget#7: \d+ raw chars, \d+ printed$/);

  const many = runCapture(["acme/widget#7", "acme/widget#8", "--json"]);
  assert.equal(JSON.parse(many.text).length, 2);

  assert.equal(runCapture(["--help"]).code, 0);
  assert.equal(runCapture([]).code, 2);
  assert.throws(
    () => runCapture(["7", "--threads", "open"]),
    /--threads takes/,
  );
});
