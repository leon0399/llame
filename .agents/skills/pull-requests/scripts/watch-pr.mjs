#!/usr/bin/env node
/**
 * Watches one or more pull requests and prints what changed, in the format of
 * fetch-pr-reviews.mjs: new or edited review threads, reviews, and comments,
 * failed checks, a head change, and the moment every check is terminal. It
 * exits once each pull request is settled: closed, or open with every check
 * terminal and the review floor elapsed since its head was pushed.
 *
 * Seen items persist in a state file, so a later run prints only what is new.
 *
 *   node .agents/skills/pull-requests/scripts/watch-pr.mjs [options] <pr>...
 *
 * Read-only: it never replies to, resolves, or edits anything.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  STATUS_BOTS,
  cleanBody,
  commentText,
  currentRepo,
  gh,
  minute,
  parsePrRef,
  readPull,
  reviewText,
  short,
  threadText,
} from "./fetch-pr-reviews.mjs";

const USAGE = `Usage: node .agents/skills/pull-requests/scripts/watch-pr.mjs [options] <pr>...

<pr> is 123, #123, owner/repo#123, or a pull request URL. Several PRs, such as
a whole stack, are watched together and settle together.

  --once                 exit after the first poll that prints a change
  --lines                one line per change, for a watcher that wakes per line
  --floor <age>          review floor after a push (default 15m; 0 on a draft)
  --interval <age>       time between polls (default 60s)
  --wait-for <logins>    also wait until each bot has reviewed or commented
                         since the head was pushed (comma-separated)
  --state <file>         where seen items persist (default: a file in tmpdir)
  --reset                forget seen items and print the current state again
  --repo <owner/name>    repository for bare numbers (default: current repo)
  -h, --help             show this help

Exit status: 0 when every PR is settled or --once printed a change.`;

const AGE = /^(\d+)(s|m|h)$/;

function parseAge(name, text) {
  if (text === "0") return 0;
  const match = AGE.exec(text);
  if (!match) throw new Error(`--${name}: expected an age such as 90s or 15m`);
  return Number(match[1]) * { s: 1e3, m: 60e3, h: 3600e3 }[match[2]];
}

function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      once: { type: "boolean", default: false },
      lines: { type: "boolean", default: false },
      floor: { type: "string" },
      interval: { type: "string", default: "60s" },
      state: { type: "string" },
      "wait-for": { type: "string", default: "" },
      reset: { type: "boolean", default: false },
      repo: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  return {
    ...values,
    refs: positionals,
    floor: values.floor === undefined ? null : parseAge("floor", values.floor),
    waitFor: values["wait-for"]
      .split(",")
      .map((name) => name.trim().replace(/\[bot\]$/, ""))
      .filter(Boolean),
    interval: parseAge("interval", values.interval),
  };
}

// ------------------------------------------------------------------ reading

/** The PR's checks; `gh pr checks` exits non-zero while any is pending. */
function readChecks(ref) {
  const run = spawnSync(
    "gh",
    [
      "pr",
      "checks",
      String(ref.number),
      "--repo",
      ref.repo,
      "--json",
      "name,bucket,link,startedAt",
    ],
    { encoding: "utf8" },
  );
  if (!run.stdout.trim()) {
    if (/no checks reported/i.test(run.stderr)) return [];
    throw new Error(run.stderr.trim() || `gh pr checks exited ${run.status}`);
  }
  return JSON.parse(run.stdout);
}

function readDraft(ref) {
  return (
    gh([
      "pr",
      "view",
      String(ref.number),
      "--repo",
      ref.repo,
      "--json",
      "isDraft",
      "--jq",
      ".isDraft",
    ]).trim() === "true"
  );
}

const fingerprint = (text) =>
  createHash("sha1").update(text).digest("hex").slice(0, 12);

const reviewer = (author) => !STATUS_BOTS.has(author);

// ---------------------------------------------------------------- diffing

/**
 * The printable changes of one poll, and the state they leave. `seen` maps an
 * item id to a fingerprint of what was last printed for it.
 */
export function diffPull(previous, pr, checks, now) {
  const seen = { ...previous.seen };
  const sections = { head: [], checks: [], threads: [], reviews: [], comments: [] };

  const first = previous.head === undefined;
  const headChanged = !first && previous.head !== pr.head;
  if (headChanged) {
    sections.head.push(
      `- ${short(pr.head)} replaces ${short(previous.head)}: the floor restarts`,
    );
  }

  // The head was pushed when its first check started; a new head without
  // checks yet counts from now.
  const started = checks
    .map((check) => Date.parse(check.startedAt))
    .filter(Number.isFinite);
  const pushedAt =
    headChanged || first
      ? started.length > 0
        ? Math.min(...started)
        : now
      : previous.pushedAt;
  // The first poll prints the open review state of the current head only:
  // unresolved threads, reviews of the head, and comments since its push.
  const current = (at, commit) =>
    !first || (commit === undefined ? Date.parse(at) >= pushedAt : commit === pr.head);

  for (const thread of pr.threads) {
    const known = seen[thread.id];
    const count = thread.comments.length;
    seen[thread.id] = String(count);
    if (known === undefined && thread.resolved) continue;
    const fresh = thread.comments
      .slice(known === undefined ? 0 : Number(known))
      .filter((item) => reviewer(item.author))
      .map((item) => ({ ...item, body: cleanBody(item.body) }));
    if (fresh.length > 0) sections.threads.push(threadText({ ...thread, comments: fresh }));
  }

  for (const review of pr.reviews) {
    const body = cleanBody(review.body);
    const mark = fingerprint(`${review.state}\n${body}`);
    const known = seen[review.id];
    seen[review.id] = mark;
    const speaks =
      body !== "" || review.state === "APPROVED" || review.state === "CHANGES_REQUESTED";
    if (known !== mark && speaks && reviewer(review.author) && current(review.at, review.commit)) {
      sections.reviews.push(reviewText({ ...review, body }, pr.head));
    }
  }

  for (const item of pr.comments) {
    const body = cleanBody(item.body);
    const mark = fingerprint(body);
    const known = seen[item.id];
    seen[item.id] = mark;
    if (known !== mark && body !== "" && reviewer(item.author) && current(item.at)) {
      sections.comments.push(commentText({ ...item, body }));
    }
  }

  const buckets = headChanged ? {} : { ...previous.checks };
  for (const check of checks) {
    const before = buckets[check.name];
    buckets[check.name] = check.bucket;
    if (before !== check.bucket && (check.bucket === "fail" || check.bucket === "cancel")) {
      sections.checks.push(`- ${check.bucket} ${check.name} ${check.link}`);
    }
  }
  const counts = countBuckets(checks);
  const terminal = checks.length > 0 && counts.pending === 0;
  if (terminal && !(previous.terminal && !headChanged)) {
    sections.checks.push(
      `- terminal: ${Object.entries(counts)
        .filter(([bucket, n]) => n > 0 && bucket !== "pending")
        .map(([bucket, n]) => `${n} ${bucket}`)
        .join(", ")}`,
    );
  }


  return {
    sections,
    state: { head: pr.head, seen, checks: buckets, terminal, pushedAt },
  };
}

function countBuckets(checks) {
  const counts = { pass: 0, fail: 0, cancel: 0, skipping: 0, pending: 0 };
  for (const check of checks) counts[check.bucket] = (counts[check.bucket] ?? 0) + 1;
  return counts;
}

export function formatChanges(pr, sections, lines = false) {
  const order = ["head", "checks", "threads", "reviews", "comments"];
  if (lines) {
    // One event per line, for a harness that delivers each output line as an
    // event: the entry's first lines, flattened; fetch-pr-reviews has the rest.
    const events = order.flatMap((name) =>
      sections[name].map((entry) => {
        const text = entry
          .split("\n")
          .map((line) => line.trim().replace(/^- /, ""))
          .filter(Boolean)
          .slice(0, 3)
          .join(" · ");
        const event = `${pr.repo}#${pr.number} ${name}: ${text}`;
        return event.length > 240 ? `${event.slice(0, 239)}…` : event;
      }),
    );
    return events.length > 0 ? events.join("\n") : null;
  }
  const parts = order
    .filter((name) => sections[name].length > 0)
    .flatMap((name) => [`## ${name} +${sections[name].length}`, ...sections[name]]);
  if (parts.length === 0) return null;
  return [
    `# ${pr.repo}#${pr.number} ${pr.state} head ${short(pr.head)} — ${pr.title}`,
    ...parts,
  ].join("\n");
}

/** Whether `bot` reviewed the head, or wrote anything since `since`. */
export function postedSince(pr, bot, since) {
  const recent = (at) => Date.parse(at) >= since;
  return (
    pr.reviews.some(
      (review) => review.author === bot && (review.commit === pr.head || recent(review.at)),
    ) ||
    pr.comments.some((item) => item.author === bot && recent(item.at)) ||
    pr.threads.some((thread) =>
      thread.comments.some((item) => item.author === bot && recent(item.at)),
    )
  );
}

// --------------------------------------------------------------------- run

const out = (line) => process.stdout.write(`${line}\n`);
// A reader that stops early, such as `head`, is not an error.
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function statePath(options, refs) {
  if (options.state) return options.state;
  const key = refs.map((ref) => `${ref.repo}#${ref.number}`).join(",");
  return path.join(tmpdir(), `watch-pr-${fingerprint(key)}.json`);
}

async function run(argv) {
  const options = parseOptions(argv);
  if (options.help || options.refs.length === 0) {
    out(USAGE);
    return options.help ? 0 : 2;
  }
  const needsRepo = options.refs.some((ref) => /^#?\d+$/.test(ref)) && !options.repo;
  const repo = needsRepo ? currentRepo() : options.repo;
  const refs = options.refs.map((text) => parsePrRef(text, repo));
  const file = statePath(options, refs);
  if (options.reset) rmSync(file, { force: true });
  const saved = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

  for (;;) {
    const now = Date.now();
    let printed = false;
    const settled = [];
    for (const ref of refs) {
      const key = `${ref.repo}#${ref.number}`;
      const pr = readPull(ref, ["threads", "reviews", "comments"]);
      const checks = readChecks(ref);
      const { sections, state } = diffPull(saved[key] ?? { seen: {} }, pr, checks, now);
      saved[key] = state;
      const text = formatChanges(pr, sections, options.lines);
      if (text) {
        out(text);
        printed = true;
      }
      const floor = options.floor ?? (readDraft(ref) ? 0 : 15 * 60e3);
      const waited = now - state.pushedAt >= floor;
      const missing = options.waitFor.filter(
        (bot) => !postedSince(pr, bot, state.pushedAt),
      );
      settled.push({
        key,
        done:
          pr.state !== "OPEN" ||
          (state.terminal && waited && missing.length === 0),
        why:
          pr.state !== "OPEN"
            ? pr.state.toLowerCase()
            : !state.terminal
              ? "checks pending"
              : !waited
                ? `floor until ${minute(new Date(state.pushedAt + floor).toISOString())}`
                : `waiting for ${missing.join(", ")}`,
      });
    }
    writeFileSync(file, JSON.stringify(saved));
    if (settled.every((pr) => pr.done)) {
      out(`# settled: ${settled.map((pr) => pr.key).join(", ")}`);
      return 0;
    }
    if (options.once && printed) {
      out(
        `# waiting: ${settled
          .filter((pr) => !pr.done)
          .map((pr) => `${pr.key} (${pr.why})`)
          .join(", ")}; run again to continue`,
      );
      return 0;
    }
    await sleep(options.interval);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
