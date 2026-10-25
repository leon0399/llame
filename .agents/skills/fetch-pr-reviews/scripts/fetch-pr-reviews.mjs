#!/usr/bin/env node
/**
 * Prints the review state of one or more pull requests for an agent: review
 * threads, review verdicts, and conversation comments, filtered, and stripped
 * of the bot markup that costs tokens without carrying a finding — HTML
 * comment markers and state blobs, badges and icons, analysis transcripts,
 * duplicate "prompt for AI agents" restatements, and long hashes.
 *
 * Read-only: it never replies to, resolves, or edits anything.
 *
 *   node .agents/skills/fetch-pr-reviews/scripts/fetch-pr-reviews.mjs [options] <pr>...
 *
 * Run with --help for the options.
 */
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const USAGE = `Usage: node .agents/skills/fetch-pr-reviews/scripts/fetch-pr-reviews.mjs [options] <pr>...

<pr> is 123, #123, owner/repo#123, or a pull request URL.

  --threads <which>      unresolved (default), resolved, or all
  --outdated <how>       include (default), exclude, or only
  --kinds <list>         threads,reviews,comments (default: all three)
  --since <when>         ISO date/time, or an age such as 90m, 6h, 2d
  --author <login>       only this author (repeatable, comma-separated)
  --exclude-author <l>   drop this author (repeatable, comma-separated)
  --current-head         only reviews submitted against the head commit
  --all-bots             keep deployment and coverage bots (codecov, vercel, …)
  --raw                  print bodies as GitHub stores them
  --max-chars <n>        truncate each body to n characters
  --json                 print the selection as JSON
  --stats                report raw versus printed size on stderr
  --repo <owner/name>    repository for bare numbers (default: current repo)
  -h, --help             show this help
`;

/** Bots whose comments report deployments, coverage, or CI status rather than
 *  review findings. Kept out unless --all-bots. */
const STATUS_BOTS = new Set([
  "codecov",
  "vercel",
  "netlify",
  "github-actions",
  "socket-security",
]);

/** `<details>` blocks whose summary names one of these carry no finding: the
 *  bot's own analysis transcript, a restatement of the finding written for
 *  agents, a duplicate of a suggested diff, configuration, action buttons, or
 *  advertising. */
const NOISE_DETAILS =
  /static analysis|analysis chain|prompt for ai agents|prompt to fix|committable suggestion|about codex|review info|review details|run configuration|learnings used|additional comments|finishing touches|generate (?:unit tests|docstrings)|stack traces|flaky test|\btips\b/i;

/** Regions a bot brackets with start/end HTML comment markers. */
const NOISE_REGIONS = [
  /<!--\s*(tips|autofix_checkbox|walkthrough|change_assessment|final_review_risk|review_stack_entry|autopilot)_start\s*-->[\s\S]*?<!--\s*\1_end\s*-->/g,
  /<!--\s*This is an auto-generated comment: ([\w ]+?)(?: by [\w.]+)?\s*-->[\s\S]*?<!--\s*end of auto-generated comment: \1[^>]*-->/g,
];

/** Lines that are a bot's sign-off, feedback prompt, or link bar. */
const BOILERPLATE_LINES = [
  /^Useful\? React with .*$/gm,
  /^Here are some automated review suggestions for this pull request\.$/gm,
  /^You are interacting with an AI system\.$/gm,
  /^> 📝 .*\blearnings?\b.*$/gm,
  /^.*\[Fix it ➔\]\(.*$/gm,
];

/** Presentational tags, dropped with their content kept. */
const TAG =
  /<\/?(?:sub|sup|dl|dd|dt|br|p|div|span|b|i|strong|em|blockquote|source|summary|hr|a|relative-time)\b[^>]*>/gi;

// ---------------------------------------------------------------- arguments

/** Reads a pull request reference; a bare number takes `defaultRepo`. */
function parsePrRef(text, defaultRepo) {
  const url = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(text);
  if (url) return { repo: url[1], number: Number(url[2]) };
  const qualified = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(text);
  if (qualified) return { repo: qualified[1], number: Number(qualified[2]) };
  const bare = /^#?(\d+)$/.exec(text);
  if (bare && defaultRepo)
    return { repo: defaultRepo, number: Number(bare[1]) };
  throw new Error(`not a pull request reference: ${text}`);
}

/** An absolute date, or an age before now such as `90m`, `6h`, or `2d`. */
function parseSince(text) {
  const age = /^(\d+)([mhd])$/.exec(text);
  if (age) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[age[2]];
    return new Date(Date.now() - Number(age[1]) * unit);
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`not a date: ${text}`);
  return date;
}

const listOf = (values) =>
  new Set(
    (values ?? [])
      .flatMap((value) => value.split(","))
      .map(login)
      .filter(Boolean),
  );

function oneOf(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`--${name} takes ${allowed.join(", ")}; got ${value}`);
  }
  return value;
}

const OPTION_SPEC = {
  threads: { type: "string", default: "unresolved" },
  outdated: { type: "string", default: "include" },
  kinds: { type: "string", default: "threads,reviews,comments" },
  since: { type: "string" },
  author: { type: "string", multiple: true },
  "exclude-author": { type: "string", multiple: true },
  "current-head": { type: "boolean", default: false },
  "all-bots": { type: "boolean", default: false },
  raw: { type: "boolean", default: false },
  "max-chars": { type: "string" },
  json: { type: "boolean", default: false },
  stats: { type: "boolean", default: false },
  repo: { type: "string" },
  help: { type: "boolean", short: "h", default: false },
};

/** The command line as options and pull request references. */
function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: OPTION_SPEC,
  });
  return {
    help: values.help,
    refs: positionals,
    repo: values.repo,
    threads: oneOf("threads", values.threads, [
      "unresolved",
      "resolved",
      "all",
    ]),
    outdated: oneOf("outdated", values.outdated, [
      "include",
      "exclude",
      "only",
    ]),
    kinds: new Set(
      values.kinds
        .split(",")
        .map((kind) =>
          oneOf("kinds", kind.trim(), ["threads", "reviews", "comments"]),
        ),
    ),
    since: values.since === undefined ? null : parseSince(values.since),
    authors: listOf(values.author),
    excludedAuthors: listOf(values["exclude-author"]),
    currentHead: values["current-head"],
    allBots: values["all-bots"],
    raw: values.raw,
    maxChars:
      values["max-chars"] === undefined ? 0 : Number(values["max-chars"]),
    json: values.json,
    stats: values.stats,
  };
}

// ----------------------------------------------------------------- cleaning

/** A login without the `[bot]` suffix REST adds and GraphQL omits. */
function login(name) {
  return (name ?? "ghost")
    .trim()
    .toLowerCase()
    .replace(/\[bot\]$/, "");
}

/** Replaces fenced and inline code with placeholders so markup cleaning never
 *  touches code, then puts it back. */
function outsideCode(text, clean) {
  const blocks = [];
  const keep = (block) => {
    blocks.push(block);
    return `\uE000${blocks.length - 1}\uE000`;
  };
  const masked = text
    .replaceAll(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, keep)
    .replaceAll(/`[^`\n]+`/g, keep);
  return clean(masked).replaceAll(
    /\uE000(\d+)\uE000/g,
    (_, index) => blocks[Number(index)],
  );
}

/** The end of the `<details>` element opening at `open`, and where its
 *  content ends; an unclosed element runs to the end of the text. */
function detailsEnd(text, open) {
  const tag = /<\/?details\b[^>]*>/gi;
  tag.lastIndex = open;
  let depth = 0;
  for (let match = tag.exec(text); match; match = tag.exec(text)) {
    depth += match[0][1] === "/" ? -1 : 1;
    if (depth === 0) return { end: tag.lastIndex, contentEnd: match.index };
  }
  return { end: text.length, contentEnd: text.length };
}

/** One `<details>` element's content: dropped when its summary names noise,
 *  otherwise its summary as a heading line over its cleaned content. */
function renderDetails(content) {
  const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(content);
  const title = summary ? stripTags(summary[1]).trim() : "";
  if (NOISE_DETAILS.test(title)) return "\n";
  const body = summary
    ? content.slice(summary.index + summary[0].length)
    : content;
  return `\n${title ? `▸ ${title}\n` : ""}${unwrapDetails(body)}\n`;
}

/** Text with every `<details>` element rendered by `renderDetails`. */
function unwrapDetails(text) {
  let out = "";
  let cursor = 0;
  for (
    let open = text.indexOf("<details", cursor);
    open !== -1;
    open = text.indexOf("<details", cursor)
  ) {
    const { end, contentEnd } = detailsEnd(text, open);
    out +=
      text.slice(cursor, open) +
      renderDetails(text.slice(text.indexOf(">", open) + 1, contentEnd));
    cursor = end;
  }
  return out + text.slice(cursor);
}

function stripTags(text) {
  return text
    .replaceAll(/<picture\b[\s\S]*?<\/picture>\s*/gi, "")
    .replaceAll(/<img\b[^>]*?alt="([^"]*)"[^>]*>/gi, "$1")
    .replaceAll(/<img\b[^>]*>/gi, "")
    .replaceAll(/<code>([^<]*)<\/code>/gi, "`$1`")
    .replaceAll(TAG, "")
    .replaceAll("&nbsp;", " ");
}

/** Shortens what tokenizes badly and means nothing to a reader: full commit
 *  hashes, and long opaque runs of letters and digits such as encoded state. */
function shortenOpaque(text) {
  return text
    .replaceAll(/\b[0-9a-f]{40}\b/g, (hash) => hash.slice(0, 10))
    .replaceAll(/(?=[\w+=-]*\d)(?=[\w+=-]*[A-Za-z])[\w+=-]{80,}/g, "[blob]");
}

/** Table rows without the padding that aligns them in source. */
function compactTables(text) {
  return text.replaceAll(/^\|.*\|$/gm, (row) =>
    row.replaceAll(/:?-{3,}:?/g, "---").replaceAll(/ {2,}/g, " "),
  );
}

/** Markup cleaning outside code: markers, noise regions and blocks, badges,
 *  presentational tags, boilerplate lines, table padding, and opaque runs. */
function cleanMarkup(text) {
  let out = text;
  for (const region of NOISE_REGIONS) out = out.replaceAll(region, "");
  out = out.replaceAll(/<!--[\s\S]*?-->/g, "");
  out = unwrapDetails(out);
  out = out.replaceAll(/!\[([^\]]*?)(?: Badge)?\]\([^)]*\)/g, (_, alt) =>
    alt ? `[${alt}]` : "",
  );
  out = stripTags(out);
  for (const line of BOILERPLATE_LINES) out = out.replaceAll(line, "");
  return shortenOpaque(compactTables(out));
}

/** A review or comment body as an agent should read it. Whitespace is
 *  normalized while code is still masked, so code keeps its blank lines and
 *  trailing spaces. Rule lines that end a body, or repeat, separate nothing
 *  once the noise between them is gone. */
function cleanBody(body) {
  return outsideCode(body ?? "", (text) =>
    cleanMarkup(text)
      .replaceAll(/[ \t]+$/gm, "")
      .replaceAll(/\n{3,}/g, "\n\n")
      .replaceAll(/^---\n\n(?=---$)/gm, "")
      .replace(/(?:\n+---)+\s*$/, ""),
  ).trim();
}

// -------------------------------------------------------------- GitHub reads

const PAGE = "pageInfo { hasNextPage endCursor }";

const CONNECTIONS = {
  reviewThreads: `reviewThreads(first: 100, after: $cursor) { ${PAGE} nodes {
    id isResolved isOutdated path line originalLine resolvedBy { login }
    comments(first: 100) { nodes { author { login } body createdAt lastEditedAt url } } } }`,
  reviews: `reviews(first: 100, after: $cursor) { ${PAGE} nodes {
    id author { login } state body submittedAt lastEditedAt url commit { oid } } }`,
  comments: `comments(first: 100, after: $cursor) { ${PAGE} nodes {
    id author { login } body createdAt lastEditedAt url } }`,
};

const KIND_CONNECTION = {
  threads: "reviewThreads",
  reviews: "reviews",
  comments: "comments",
};

function query(connection) {
  return `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    title url state headRefOid ${CONNECTIONS[connection]} } } }`;
}

/** Every node of one connection of a pull request, and the pull request's
 *  own fields. */
function readConnection(ref, connection) {
  const [owner, name] = ref.repo.split("/");
  const nodes = [];
  let pull;
  let cursor = null;
  do {
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${query(connection)}`,
      "-f",
      `owner=${owner}`,
      "-f",
      `name=${name}`,
      "-F",
      `number=${ref.number}`,
    ];
    if (cursor) args.push("-f", `cursor=${cursor}`);
    pull = JSON.parse(gh(args)).data.repository.pullRequest;
    nodes.push(...pull[connection].nodes);
    cursor = pull[connection].pageInfo.hasNextPage
      ? pull[connection].pageInfo.endCursor
      : null;
  } while (cursor);
  return { pull, nodes };
}

const comment = (node) => ({
  author: login(node.author?.login),
  // Bots rewrite their summary comments in place, so the last edit is what
  // `--since` and the printed time follow.
  at: node.lastEditedAt ?? node.createdAt ?? node.submittedAt,
  url: node.url,
  body: node.body ?? "",
});

/** One pull request as plain data: only the kinds asked for are read. */
function readPull(ref, kinds) {
  const pr = {
    repo: ref.repo,
    number: ref.number,
    threads: [],
    reviews: [],
    comments: [],
  };
  for (const kind of kinds) {
    const { pull, nodes } = readConnection(ref, KIND_CONNECTION[kind]);
    Object.assign(pr, {
      title: pull.title,
      url: pull.url,
      state: pull.state,
      head: pull.headRefOid,
    });
    pr[kind] = nodes.map((node) => toItem(kind, node));
  }
  return pr;
}

function toItem(kind, node) {
  if (kind === "threads") {
    return {
      id: node.id,
      resolved: node.isResolved,
      outdated: node.isOutdated,
      path: node.path,
      line: node.line ?? node.originalLine,
      resolvedBy: node.resolvedBy ? login(node.resolvedBy.login) : null,
      comments: node.comments.nodes.map(comment),
    };
  }
  const item = { id: node.id, ...comment(node) };
  return kind === "reviews"
    ? { ...item, state: node.state, commit: node.commit?.oid ?? null }
    : item;
}

// ---------------------------------------------------------------- selection

function authorAllowed(author, options) {
  if (options.authors.size > 0 && !options.authors.has(author)) return false;
  if (options.excludedAuthors.has(author)) return false;
  return (
    options.allBots || options.authors.has(author) || !STATUS_BOTS.has(author)
  );
}

const after = (at, since) => since === null || new Date(at) >= since;

function threadSelected(thread, options) {
  if (
    options.threads !== "all" &&
    thread.resolved !== (options.threads === "resolved")
  )
    return false;
  if (options.outdated === "exclude" && thread.outdated) return false;
  if (options.outdated === "only" && !thread.outdated) return false;
  if (!thread.comments.some((item) => authorAllowed(item.author, options)))
    return false;
  return thread.comments.some((item) => after(item.at, options.since));
}

function reviewSelected(review, pr, options) {
  if (options.currentHead && review.commit !== pr.head) return false;
  return (
    authorAllowed(review.author, options) && after(review.at, options.since)
  );
}

/** A review with no body text left after cleaning is only the container of
 *  its inline comments, unless its verdict says something. */
const reviewSaysSomething = (review) =>
  review.body !== "" ||
  review.state === "APPROVED" ||
  review.state === "CHANGES_REQUESTED";

const commentSelected = (item, options) =>
  authorAllowed(item.author, options) && after(item.at, options.since);

function prepare(text, options) {
  const body = options.raw ? text : cleanBody(text);
  return options.maxChars > 0 && body.length > options.maxChars
    ? `${body.slice(0, options.maxChars)}… [${body.length - options.maxChars} more chars]`
    : body;
}

/** The pull request reduced to what the options select, bodies cleaned; and
 *  the totals read, for the header. */
function selectItems(pr, options) {
  const clean = (item) => ({ ...item, body: prepare(item.body, options) });
  return {
    ...pr,
    threads: pr.threads
      .filter((thread) => threadSelected(thread, options))
      .map((thread) => ({ ...thread, comments: thread.comments.map(clean) })),
    reviews: pr.reviews
      .filter((review) => reviewSelected(review, pr, options))
      .map(clean)
      .filter(reviewSaysSomething),
    comments: pr.comments
      .filter((item) => commentSelected(item, options))
      .map(clean)
      .filter((item) => item.body !== ""),
    totals: {
      threads: pr.threads.length,
      reviews: pr.reviews.length,
      comments: pr.comments.length,
    },
  };
}

// ------------------------------------------------------------------- output

const minute = (at) => (at ? at.slice(0, 16).replace("T", " ") + "Z" : "");
// Blank lines stay empty: trailing indentation is tokens with no content.
const indent = (text) => text.replaceAll(/^(?=.)/gm, "    ");
const short = (oid) => (oid ? oid.slice(0, 8) : "");

function threadText(thread) {
  const flags = [
    thread.resolved ? `resolved by @${thread.resolvedBy}` : "unresolved",
  ];
  if (thread.outdated) flags.push("outdated");
  const lines = [
    `- ${thread.id} ${thread.path ?? ""}:${thread.line ?? "?"} [${flags.join(", ")}]`,
  ];
  for (const item of thread.comments) {
    lines.push(`  @${item.author} ${minute(item.at)}`, indent(item.body));
  }
  return lines.join("\n");
}

function reviewText(review, head) {
  const commit = review.commit === head ? "head" : short(review.commit);
  const header = `- @${review.author} ${review.state} ${minute(review.at)} on ${commit}`;
  return review.body ? `${header}\n${indent(review.body)}` : header;
}

const commentText = (item) =>
  `- @${item.author} ${minute(item.at)} ${item.url}\n${indent(item.body)}`;

/** One selected pull request as compact text for an agent. */
function formatText(selection, kinds) {
  const { totals } = selection;
  const parts = [
    `# ${selection.repo}#${selection.number} ${selection.state} head ${short(selection.head)} — ${selection.title}`,
  ];
  const section = (kind, items, render) => {
    if (!kinds.has(kind)) return;
    parts.push(
      `## ${kind} ${items.length}/${totals[kind]}`,
      ...items.map(render),
    );
  };
  section("threads", selection.threads, threadText);
  section("reviews", selection.reviews, (review) =>
    reviewText(review, selection.head),
  );
  section("comments", selection.comments, commentText);
  return parts.join("\n");
}

// --------------------------------------------------------------------- run

function rawSize(pr) {
  const bodies = [
    ...pr.threads.flatMap((thread) => thread.comments),
    ...pr.reviews,
    ...pr.comments,
  ];
  return bodies.reduce((sum, item) => sum + item.body.length, 0);
}

const gh = (args) =>
  execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function currentRepo() {
  return gh([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]).trim();
}

const out = (line) => process.stdout.write(`${line}\n`);

function run(argv) {
  const options = parseOptions(argv);
  if (options.help || options.refs.length === 0) {
    out(USAGE);
    return options.help ? 0 : 2;
  }
  const needsRepo =
    options.refs.some((ref) => /^#?\d+$/.test(ref)) && !options.repo;
  const repo = needsRepo ? currentRepo() : options.repo;
  const selections = [];
  for (const text of options.refs) {
    const pr = readPull(parsePrRef(text, repo), [...options.kinds]);
    const selection = selectItems(pr, options);
    const printed = formatText(selection, options.kinds);
    selections.push(selection);
    if (!options.json) out(printed);
    if (options.stats) {
      console.error(
        `${pr.repo}#${pr.number}: ${rawSize(pr)} raw chars, ${printed.length} printed`,
      );
    }
  }
  if (options.json) {
    out(JSON.stringify(selections.length === 1 ? selections[0] : selections));
  }
  return 0;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
