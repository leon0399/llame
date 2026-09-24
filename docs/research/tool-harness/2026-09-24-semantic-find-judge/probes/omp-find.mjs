import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

// Run with pnpm exec tsx: its installed esbuild supplies TS transpilation.
// Execute pinned source unchanged. Native I/O, credentials, timers and inference
// are explicit doubles; this proves mechanics, not model quality or full CLI parity.
const require = createRequire(import.meta.url);
const { transformSync } = require("esbuild");
const checkout = process.argv[2];
assert(checkout, "Supply the OMP source checkout");
const revision = "5fccbd0deee820049afa492dc3112272b163126f";
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: checkout,
    encoding: "utf8",
  }).trim(),
  revision,
);
const base = "packages/coding-agent/src/tools/jfind/";
const hashes = {};
const modules = new Map();
let corpus = {};
let scanOptions;
const delays = [];
const native = {
  FileType: { File: "file" },
  GrepOutputMode: { Content: "content" },
  async glob() {
    return {
      matches: Object.entries(corpus).map(([name, text]) => ({
        path: name,
        size: Buffer.byteLength(text),
      })),
    };
  },
  async grep(options) {
    scanOptions = options;
    const pattern = new RegExp(options.pattern, "iu");
    return {
      filesSearched: Object.keys(corpus).length,
      matches: Object.entries(corpus).flatMap(([name, text]) =>
        text
          .split("\n")
          .filter((line) => pattern.test(line))
          .map((line) => ({ path: name, line })),
      ),
    };
  },
};
const bun = {
  file(name) {
    const text = corpus[path.posix.relative("/synthetic", name)];
    if (text === undefined) throw new Error("Unknown synthetic source");
    return {
      slice: (start, end) => ({
        bytes: async () => Buffer.from(text).subarray(start, end),
      }),
    };
  },
  sleep: async (milliseconds) => {
    delays.push(milliseconds);
  },
};
class ProviderHttpError extends Error {
  constructor(message, status, options) {
    super(message);
    this.status = status;
    this.headers = options?.headers;
  }
}
class ProviderResponseError extends Error {}
const context = vm.createContext({
  Buffer,
  TextDecoder,
  AbortSignal,
  Error,
  console,
  performance,
  Bun: bun,
});
function load(relative) {
  if (modules.has(relative)) return modules.get(relative).exports;
  const source = execFileSync("git", ["show", `${revision}:${relative}`], {
    cwd: checkout,
    encoding: "utf8",
  });
  hashes[relative] = createHash("sha256").update(source).digest("hex");
  if (relative.endsWith(".md")) return source;
  const module = { exports: {} };
  modules.set(relative, module);
  const localRequire = (specifier) => {
    if (specifier === "node:path") return path;
    if (specifier === "@oh-my-pi/pi-natives") return native;
    if (specifier === "@oh-my-pi/pi-utils") {
      const tree = load("packages/utils/src/path-tree.ts");
      return {
        ...tree,
        $env: {},
        // Only find's three literal interpolation templates are exercised.
        prompt: {
          render: (template, data) =>
            template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key])),
        },
      };
    }
    if (specifier === "@oh-my-pi/pi-catalog/discovery")
      return { TYPESAFE_DEFAULT_BASE_URL: "https://api.typesafe.ai" };
    if (specifier === "bun")
      return {
        YAML: {
          stringify() {
            throw new Error("Full text-prompt rendering is not exercised");
          },
        },
      };
    if (specifier === "../tool-errors")
      return { throwIfAborted: (signal) => signal?.throwIfAborted() };
    if (
      relative.endsWith("/judgment/typesafe.ts") &&
      specifier === "../auth-retry"
    )
      return { withAuth: (key, operation) => operation(key) };
    if (relative.endsWith("/judgment/typesafe.ts") && specifier === "../error")
      return { ProviderHttpError, ProviderResponseError };
    if (
      relative.endsWith("/judgment/typesafe.ts") &&
      specifier === "../utils/retry-after"
    ) {
      return {
        getRetryAfterMsFromHeaders: (headers) =>
          headers.has("retry-after")
            ? Number(headers.get("retry-after")) * 1000
            : undefined,
      };
    }
    if (specifier.startsWith(".")) {
      const next = path.posix.normalize(
        path.posix.join(path.posix.dirname(relative), specifier),
      );
      return load(next.endsWith(".md") ? next : `${next}.ts`);
    }
    throw new Error(`Undeclared probe dependency: ${specifier}`);
  };
  const compiled = transformSync(source, {
    loader: "ts",
    format: "cjs",
    target: "es2022",
    logLevel: "silent",
  }).code;
  const execute = vm.runInContext(
    `(function(require,module,exports){${compiled}\n})`,
    context,
    { filename: relative },
  );
  execute(localRequire, module, module.exports);
  return module.exports;
}
const keyword = load(`${base}keywords.ts`);
const lexical = load(`${base}lexical.ts`);
const tree = load(`${base}tree.ts`);
const passage = load(`${base}passages.ts`);
const text = load(`${base}text.ts`);
const { runCascade } = load(`${base}cascade.ts`);
const { tokenUsage } = load("packages/ai/src/judgment/types.ts");
const parser = load("packages/ai/src/judgment/text.ts");
const { TypeSafeJudge } = load("packages/ai/src/judgment/typesafe.ts");
const results = {};

const terms = keyword.keywords(
  'Where running handlers "JWT verify" 123 你好 x',
  ["x", "123", "TLS"],
);
assert(
  terms.includes("runn") &&
    terms.includes("你好") &&
    terms.includes("jwt verify"),
);
assert(terms.includes("x") && terms.includes("123") && terms.includes("tls"));
assert(!keyword.keywordsFromQuery("x 123").length);
results.keywords = {
  terms: Array.from(terms),
  extra_keywords_bypass_query_length_and_number_filters: true,
};
assert.deepEqual(Array.from(keyword.keywordsFromQuery("étés")), ["étés"]);
results.unicode_stemming = {
  query: "étés",
  omp_keywords: Array.from(keyword.keywordsFromQuery("étés")),
  proposed_stem: "été",
  javascript_utf16_units: "été".length,
  rust_utf8_bytes: Buffer.byteLength("été"),
  rust_source_rule:
    "grep.rs stem accepts base.len() >= 4 bytes, so this input becomes été",
  note: "OMP function executed; Rust outcome derived from inspected source, not a compiled Rust run.",
};
results.eligibility = Object.fromEntries(
  [
    ".env",
    ".env.example",
    "credentials.json",
    "Credentials.json",
    "pnpm-lock.yaml",
    "src/program.ts",
  ].map((name) => [name, tree.eligibleFile(name, 100, true)]),
);
assert.equal(results.eligibility["credentials.json"], false);
assert.equal(results.eligibility["Credentials.json"], true);
corpus = {
  "credentials.json": "needle synthetic fixture",
  "src/program.ts": "needle code",
};
const index = await lexical.grepIndex("/synthetic", ["needle"], {
  includeHidden: false,
});
assert(index.perFileKw.has("credentials.json"));
assert(
  !Object.keys(scanOptions).some((key) =>
    /exclude|eligible|allowlist/i.test(key),
  ),
);
results.scan_scope = {
  indexed_paths: Array.from(index.perFileKw.keys()),
  note: "Native scan is doubled; source call lacks the separate eligibility filter. No credential file opened.",
};
const sampleWindows = Array.from({ length: 8 }, (_, i) => ({
  start: i + 1,
  end: i + 1,
  text: "",
  score: 0,
}));
assert.deepEqual(
  Array.from(passage.selectWindows(sampleWindows, 3), (entry) => entry.start),
  [1, 4, 8],
);
const merged = passage.mergeHeat(
  [
    { start: 1, end: 2, p: 0.3, snippet: "first" },
    { start: 3, end: 4, p: 0.8, snippet: "stronger" },
    { start: 6, end: 6, p: 0.7, snippet: "gap" },
  ],
  0.2,
);
assert.equal(merged[0].end, 4);
assert.equal(merged[0].p, 0.8);
assert.equal(merged[0].snippet, "first");
assert.equal(merged.length, 2);
results.windows_and_ranges = {
  zero_match_selected_lines: [1, 4, 8],
  merged: JSON.parse(JSON.stringify(merged)),
  utf8_clip: text.clipBytes("é中Z", 4),
};
assert.equal(results.windows_and_ranges.utf8_clip, "é");

function phase(request) {
  return request.state.tree !== undefined
    ? "names"
    : request.state.files !== undefined
      ? "sketches"
      : "verification";
}
async function cascade(files, decide) {
  corpus = files;
  const requests = [];
  const judge = {
    async judge(request) {
      const record = { phase: phase(request), request };
      requests.push(record);
      const value = await decide(record, requests);
      return {
        answers: Object.fromEntries(
          Object.keys(request.questions).map((key) => [
            key,
            { type: "noul", noul: value },
          ]),
        ),
        usage: tokenUsage(10, 0, 0.001),
      };
    },
  };
  const result = await runCascade({
    root: "/synthetic",
    query: "where is it",
    extraKeywords: [],
    includeHidden: false,
    judge,
  });
  return { result, requests };
}
const candidates = Object.fromEntries(
  Array.from({ length: 150 }, (_, i) => [
    `a${String(i).padStart(3, "0")}.ts`,
    "ordinary source\n",
  ]),
);
candidates["z-target.ts"] = "intended target\n";
const capped = await cascade(candidates, () => 0.9);
assert(!JSON.stringify(capped.requests).includes("z-target.ts"));
assert.equal(capped.result.stats.judged, 128);
results.lexical_cap = {
  listed: capped.result.stats.listed,
  name_judged: capped.result.stats.judged,
  files_read: capped.result.stats.filesRead,
  target_ever_shown_to_judge: false,
};

const large = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [
    `f${String(i).padStart(2, "0")}.ts`,
    "const unrelated = 1;\n".repeat(1100),
  ]),
);
let sketchCalls = 0;
const outage = await cascade(large, ({ phase: stage }) => {
  if (stage === "sketches" && ++sketchCalls === 1)
    throw new Error("Synthetic sketch outage");
  return 0.9;
});
assert(outage.result.stats.mapCards > 40);
assert.equal(outage.result.stats.windowsJudged, 40);
assert(outage.result.stats.windowsPruned > 0);
results.sketch_outage = {
  cards: outage.result.stats.mapCards,
  verified: outage.result.stats.windowsJudged,
  pruned: outage.result.stats.windowsPruned,
  failed_calls: outage.result.stats.errors,
  hit_files: outage.result.hits.length,
  note: "Unknown scores become1 but the global cap still drops candidates.",
};
const failedVerification = await cascade(
  { "source.ts": "function source() {}\n" },
  ({ phase: stage }) => {
    if (stage === "verification")
      throw new Error("Synthetic verification outage");
    return 0.9;
  },
);
assert.equal(failedVerification.result.hits.length, 0);
assert.equal(failedVerification.result.stats.requests, 3);
assert.equal(failedVerification.result.stats.errors, 1);
results.verification_outage = {
  hits: 0,
  requests: 3,
  errors: 1,
  all_requests_failed_condition: false,
  note: "runCascade exercised; tool source classifies this as useless, not all-failed error.",
};
const longLine = await cascade(
  { "long.ts": `${"x".repeat(20000)} END_MARKER` },
  () => 0.9,
);
const fullState = longLine.requests.find(
  (request) => request.phase === "verification",
).request.state;
assert(!JSON.stringify(fullState).includes("END_MARKER"));
assert.equal(longLine.result.hits[0].truncated, false);
results.long_line_coverage = {
  original_bytes: 20011,
  judged_line_count: longLine.result.hits[0].linesSeen,
  advertised_partial: false,
  tail_marker_sent: false,
  note: "Scripted positive verdict; line-count completeness misses byte clipping.",
};

results.text_answers = ["yes", "no", "Not yes, actually no", "uncertain"].map(
  (reply) => {
    try {
      return {
        reply,
        answer: parser.parseAnswer(
          "q",
          { type: "noul", instructions: "Relevant?" },
          reply,
        ),
      };
    } catch {
      return { reply, parse_error: true };
    }
  },
);
assert.equal(results.text_answers[0].answer.noul, 1);
assert.equal(results.text_answers[1].answer.noul, 0);
assert.equal(results.text_answers[2].answer.noul, 1);
assert.equal(results.text_answers[3].parse_error, true);
const request = {
  state: { passage: "synthetic source" },
  questions: { p00: { type: "noul", instructions: "Relevant?" } },
};
const nativeCalls = [];
function fakeFetch(answer = 0.7) {
  return async (url, options) => {
    nativeCalls.push({
      url,
      body: JSON.parse(options.body),
      bearer_is_fixture: options.headers.Authorization === "Bearer fixture-key",
    });
    return new Response(
      JSON.stringify({
        model: "fixture-version",
        answers: Object.fromEntries(
          Object.keys(JSON.parse(options.body).questions).map((key) => [
            key,
            { type: "noul", noul: answer },
          ]),
        ),
        usage: { input_tokens: 10, output_tokens: 1, cost: 0 },
      }),
      { status: 200 },
    );
  };
}
for (const api of ["typesafe", "openrouter-decisions"]) {
  const judge = new TypeSafeJudge({
    api,
    baseUrl: "https://fixture.invalid/root/",
    model: "fixture-alias",
    apiKey: "fixture-key",
    fetch: fakeFetch(),
  });
  const answer = await judge.judge(request);
  assert.equal(answer.model, "fixture-version");
  assert.equal(answer.answers.p00.noul, 0.7);
}
assert.equal(nativeCalls[0].url, "https://fixture.invalid/root/v1/systemone");
assert.equal(nativeCalls[1].url, "https://fixture.invalid/root/decisions");
results.native_wire = nativeCalls.slice();
corpus = { "one.ts": "one\n", "two.ts": "two\n" };
const invalidJudge = new TypeSafeJudge({
  baseUrl: "https://fixture.invalid",
  apiKey: "fixture-key",
  fetch: fakeFetch(2),
});
assert.equal((await invalidJudge.judge(request)).answers.p00.noul, 2);
const invalid = await runCascade({
  root: "/synthetic",
  query: "where is it",
  extraKeywords: [],
  includeHidden: false,
  judge: invalidJudge,
});
assert.equal(invalid.hits.length, 0);
assert(invalid.stats.errors > invalid.stats.requests);
assert.equal(invalid.stats.failures.length, 0);
results.invalid_native_probability = {
  client_accepted_out_of_range: true,
  requests: invalid.stats.requests,
  errors: invalid.stats.errors,
  failure_messages: 0,
  all_requests_failed_condition:
    invalid.stats.errors === invalid.stats.requests,
};
let attempts = 0;
const retryJudge = new TypeSafeJudge({
  baseUrl: "https://fixture.invalid",
  apiKey: "fixture-key",
  fetch: async (url, options) => {
    attempts++;
    if (attempts < 3)
      return new Response("Synthetic overload", {
        status: 503,
        headers: { "Retry-After": "60" },
      });
    return fakeFetch()(url, options);
  },
});
await retryJudge.judge(request);
assert.equal(attempts, 3);
assert.deepEqual(delays, [5000, 5000]);
results.native_retry = {
  attempts,
  requested_delay_ms: delays,
  note: "Sleep and credential resolution doubled; real elapsed timeout/auth rotation not exercised.",
};
console.log(
  JSON.stringify(
    {
      revision,
      scope:
        "Unchanged pinned TypeScript with explicit native-I/O/model/auth/timer doubles; no provider network request",
      source_hashes: hashes,
      results,
    },
    null,
    2,
  ),
);
