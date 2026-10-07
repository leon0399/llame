## Why

The model can reach the web only through native `read`, which needs a URL it already knows. Search
today means configuring a vendor MCP server, which exposes that vendor's tool name and arguments
(`mcp__brave__brave_web_search`), so swapping vendors changes the model-visible tool and leaves
older chats referencing a tool that no longer exists. That path also cannot fall back between
vendors, fan out across them, or use the hosted search that OpenAI, Codex, and Anthropic models
already provide ([#1102](https://github.com/leon0399/llame/issues/1102)).

## What Changes

- A new code-owned `web_search` tool with one stable schema `{ query, recency?, limit? }`.
  Search operators (`"phrase"`, `site:`, `-site:`, `after:`, `before:`) stay in the query text;
  each engine maps the ones its vendor supports natively. The tool is `read_only`, needs its own
  `tools.allowed` entry, and is authorized per call by `tools.permissions.web_search`.
- One normalized result: `kind: "results"` (title, URL, optional snippet and published date) or
  `kind: "answer"` (answer text plus citations), with the answering engine id and notes about
  ignored options. Results are untrusted tool output under the existing framing.
- A new top-level `webSearch` configuration section: `engines[]`, each with an operator id and a
  `type`, and an ordered `chain[]` of engine ids. Engine types:
  - `brave`, `exa`, `perplexity` (Search API): direct vendor APIs with a required key.
  - `searxng`: a self-hosted SearXNG JSON endpoint at a required `baseUrl`.
  - `exa-mcp`: Exa's hosted MCP endpoint, called by llame code (not the model) through the MCP
    SDK client; the key is optional and raises Exa's rate limits.
  - `duckduckgo`: the HTML endpoint, best-effort and documented as unsupported by the vendor.
  - `aggregate`: runs two or more result engines concurrently, deduplicates by canonical URL, and
    ranks with Reciprocal Rank Fusion.
  - `model-hosted`: a bounded sub-request to a configured `models[]` entry whose provider is
    `openai-responses`, `openai-codex`, or `anthropic-messages`, with that provider's hosted
    search enabled. It runs whatever model the Run uses.
- The chain tries engines in order; a failure or an empty result advances to the next engine. Each
  engine attempt is bounded by its `timeoutSeconds` (default 60); the whole call is bounded by the
  existing `tools.callTimeoutSeconds` (default 120).
- Failures reach the model as one error naming each attempted engine and a fixed failure class;
  upstream bodies, keys, and configured URLs never do.
- Allowlisting `web_search` without a `webSearch.chain` fails startup.
- The web chat renders `web_search` parts with a dedicated renderer: clickable result and
  citation links, the engine label, and notes, live and after reload.
- `tool-calling`'s rule that MCP is the only external-tool path is rewritten to name the two
  code-owned egress paths, native web `read` and `web_search`. The current text already
  contradicts shipped web `read`.
- Hosted search sub-requests are not recorded in Run usage, like title generation.

## Assumptions, confirmed with Leo

Decisions from the 2026-10-07 design session (grilling rounds Q1–Q20):

- Fan-out is the `aggregate` engine; parallel.ai's paid API and keyless MCP are out of scope (Q1).
- Native tool rather than MCP-only configuration; a vendor MCP endpoint may be an engine's
  internal transport (Q2, A2 amendment).
- Model-hosted engines run as separate sub-requests for all three wires, including the Codex
  subscription (Q5=B).
- Configuration is a top-level `webSearch` section (Q6=A), Exa ships as two types (Q7=C), the
  operator configures an explicit chain with no auto-detection (Q10=A), MCP engines use the SDK
  client (Q11=A), Perplexity uses its Search API (Q12=A), DuckDuckGo and SearXNG both ship
  (Q13=C), and an empty result falls through (Q14=B).
- Full normalized results are stored in the tool part as in-conversation context, not a search
  index (Q8=A). The runbook states each vendor's storage terms.
- A dedicated renderer is in scope (Q9=A). Hosted-search cost is not recorded (Q16=C).
- The schema keeps operators in the query text (Q15=A); the tool is `read_only` (Q17=A).
- `aggregate` waits for every child up to the call deadline (Q18=B).
- Deadlines are 60 s per engine and 120 s per call (Q19). This proposal realizes the 120 s as the
  existing `tools.callTimeoutSeconds` default rather than a second key; see design D9.

## Capabilities

### New Capabilities

- `web-search`: the `web_search` tool contract, engine chain and fall-through, the `aggregate`
  fan-out, engine-type behavior including model-hosted sub-requests, failure classes, egress and
  credential boundaries, result storage, and the dedicated chat renderer.

### Modified Capabilities

- `tool-calling`: "Code-owned tools stay internal and own-data while MCP is the only external-tool
  path" is RENAMED to "Code-owned tools stay own-data, and external network access is limited to
  MCP, web read, and web search" and MODIFIED to name native web `read` and `web_search` as the
  code-owned egress paths; its scenarios keep their headings with rewritten bodies. An ADDED
  requirement admits `web_search` into the attempt-local read-only loop, as `conversation_read` and
  `knowledge_search` are.
- `instance-config`: ADDED requirements for the `webSearch` section, engine entry shapes,
  reference validation, and the allowlist dependency.
- `run-usage-accounting`: "Compaction and title spend stay separate categories" also excludes
  hosted web-search sub-requests from assistant message usage.

Deliberately unchanged:

- `tool-call-permissions`: `web_search` uses an ordinary exact-id group; no evaluator change. The
  recommended portable map stays at nine groups, and the web-search runbook documents the
  `web_search` group, so operators who never enable search copy nothing new.
- `native-file-tools`: web `read` behavior is unchanged; search results are handed to `read` as
  ordinary locators.
- `tool-prompt-templates`: the new packaged description follows the existing rule for every
  llame-owned tool.

## Impact

- `apps/api/src/tools`: `web_search` registration, input schema, executor, chain and `aggregate`,
  result normalization, per-engine adapters, and the packaged description under `prompts/tools/`.
- `apps/api/src/instance-config`: `webSearch` raw/resolved types, built-in default, published
  `llame.config.schema.json`, loader validation, and `llame.config.jsonc.example`.
- `apps/api/src/models`: a bounded hosted-search request on the Responses, Codex, and Messages
  clients, using `openai.tools.webSearch` (`@ai-sdk/openai@3.0.97`) and
  `anthropic.tools.webSearch_20250305` (`@ai-sdk/anthropic@3.0.118`).
- `apps/web` and `packages/ui`: the `tool-web_search` renderer and its stories.
- Tests that pin the code-owned inventory or the "no outbound requests" scenario.
- Docs: a new `docs/product/operator/web-search.md` runbook, a reference page under
  `docs/product/reference/tools/`, `SPEC.md`, `README.md`, and dated `CHANGELOG.md` entries.
- New outbound destinations: `api.search.brave.com`, `api.exa.ai`, `mcp.exa.ai`,
  `api.perplexity.ai`, `html.duckduckgo.com`, the operator's SearXNG host, and the hosted-search
  provider endpoints already configured in `providers[]`.

## Non-Goals

- Attaching a provider's hosted search to the Run's own model request (in-loop native search).
- parallel.ai, Tavily, Firecrawl, Kagi, Gemini grounding, xAI, and Perplexity Sonar engines.
- Credential auto-detection, owner-selectable engines, and model-selectable engines.
- A central query parser or post-filter, and a result cache across calls.
- Recording hosted-search token or per-search cost.
- Fetching result pages; that remains native `read`.

## Acceptance

- An operator who allowlists `web_search`, adds a permission group, and configures one engine and
  a chain gets search results in a chat, rendered as clickable links that survive reload.
- Every listed engine type returns normalized output end to end, verified against a deterministic
  fixture server; the chain falls through on failure and on empty results.
- `aggregate` merges concurrent children and is empty only when every child is empty.
- A `model-hosted` engine answers with citations from a Run on a different model, and an answer
  without a URL source is treated as an engine failure.
- A call rejected by `tools.permissions` sends no outbound request; credentials and upstream bodies
  never appear in tool output, logs, or Run events.
