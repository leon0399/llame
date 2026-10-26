/**
 * Stage 2: does DeepSeek's `ori_question` change results? For each prompt,
 * takes one model's stage-1 calls and searches DeepSeek three ways: no
 * ori_question, the `concise` objective cut to 128 characters, and the
 * `target120` objective cut to 128 characters.
 *
 * Run from apps/api after stage 1 (see ../index.md):
 *   SPIKE_IN=<stage-1 jsonl> SPIKE_SOURCE_MODEL=<model id> pnpm exec tsx spike/deepseek-ori-question.ts
 * DEEPSEEK_API_KEY comes from the environment or .env.local.
 * Output: spike/out/deepseek.jsonl (titles and URLs for manual review) and an
 * overlap table on stdout.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const ENDPOINT = "https://api.deepseek.com/v1/tools/search";
const MAX = 128;

type Call = {
  model: string;
  variant: "concise" | "target120";
  prompt: string;
  group: string;
  args?: { query?: string; objective?: string };
};
type Hit = { url: string; title: string; rerank_score?: number };
type Arm = "none" | "concise" | "target120";

const cut = (s: string | undefined): string | undefined =>
  s === undefined ? undefined : Array.from(s).slice(0, MAX).join("");

async function search(
  query: string,
  oriQuestion: string | undefined,
): Promise<Array<Hit> | string> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      count: 10,
      ...(oriQuestion && { ori_question: oriQuestion }),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  // Status only: DeepSeek error bodies echo part of the key.
  if (!response.ok) return `HTTP ${response.status}`;
  const payload = (await response.json()) as { results?: Array<Hit> };
  return (payload.results ?? []).map(({ url, title, rerank_score }) => ({
    url,
    title,
    rerank_score,
  }));
}

const top5 = (hits: Array<Hit>): Set<string> =>
  new Set(hits.slice(0, 5).map((h) => h.url));
function overlap(a: Array<Hit>, b: Array<Hit>): number {
  const left = top5(a);
  const right = top5(b);
  const shared = [...left].filter((u) => right.has(u)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 1 : shared / union;
}

async function main(): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY)
    throw new Error("DEEPSEEK_API_KEY is not set");
  const source = process.env.SPIKE_SOURCE_MODEL;
  if (!source)
    throw new Error("SPIKE_SOURCE_MODEL is not set (a model id from stage 1)");
  const calls = readFileSync(
    process.env.SPIKE_IN ?? "spike/out/calls.jsonl",
    "utf8",
  )
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Call)
    .filter((c) => c.model === source && c.args?.query !== undefined);
  const prompts = [...new Set(calls.map((c) => c.prompt))];
  const records: Array<Record<string, unknown>> = [];
  const rows = [
    "| prompt | group | query chars | none vs concise | none vs target120 | note |",
    "|---|---|---|---|---|---|",
  ];
  for (const prompt of prompts) {
    const concise = calls.find(
      (c) => c.prompt === prompt && c.variant === "concise",
    );
    const target = calls.find(
      (c) => c.prompt === prompt && c.variant === "target120",
    );
    const query = concise?.args?.query ?? target!.args!.query!;
    const length = Array.from(query).length;
    if (length > MAX) {
      rows.push(
        `| ${prompt} | ${concise?.group ?? target?.group} | ${length} | - | - | query over 128, engine skipped |`,
      );
      continue;
    }
    const arms: Record<Arm, string | undefined> = {
      none: undefined,
      concise: cut(concise?.args?.objective),
      target120: cut(target?.args?.objective),
    };
    const results = {} as Record<Arm, Array<Hit> | string>;
    for (const arm of Object.keys(arms) as Array<Arm>)
      results[arm] = await search(query, arms[arm]);
    records.push({ prompt, query, oriQuestion: arms, results });
    const ok = (arm: Arm): Array<Hit> | undefined =>
      typeof results[arm] === "string"
        ? undefined
        : (results[arm] as Array<Hit>);
    const format = (arm: Arm): string => {
      const base = ok("none");
      const other = ok(arm);
      if (arms[arm] === undefined) return "no objective";
      return base && other
        ? overlap(base, other).toFixed(2)
        : String(
            typeof results[arm] === "string" ? results[arm] : results.none,
          );
    };
    rows.push(
      `| ${prompt} | ${concise?.group ?? target?.group} | ${length} | ${format("concise")} | ${format("target120")} | |`,
    );
  }
  writeFileSync(
    "spike/out/deepseek.jsonl",
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  process.stdout.write(
    `\nTop-5 Jaccard overlap with the no-ori_question baseline (1.00 = identical):\n${rows.join("\n")}\n`,
  );
}

void main();
