## Context

See [proposal.md](proposal.md) for scope and issue ownership. `resolveEffectiveContext` already persists the rendered system prompt and tool declarations. `turn-context.ts` computes user-turn disclosures; context items persist their final text and replay without re-rendering. Native `read` supports host paths and Knowledge locators, while Bash executes submitted shell text with explicit per-call `cwd`.

The decisions below supersede #770's earlier suggested source tiers, hidden skill backing paths, and content pinning. They do not change Knowledge path privacy or #763's process-frozen permission policy. Model steering remains #782.

## Goals / Non-Goals

The implementation must make multiple skills useful in one task, including their references and executable scripts, with inspectable live reads. It must keep unused bodies out of context and preserve historical observations.

There is no new script executor, command rewriter, automatic dependency installer, per-owner catalog, MCP adapter, or skill-derived permission grant. Loading trusted operator instructions does not promote them above user requests or runtime policy.

## Decisions

### D1: Explicit directory sources, ordered overrides

Add `skills.directories: string[]`, default `[]`, to instance configuration. Each entry is a directory containing immediate skill directories, for example `/opt/skills/pdf/SKILL.md`. Do not require individual package enumeration, search ancestors, or implicitly scan the API account's home. Resolve relative entries against the config file directory; expand a leading `~/` against the operator process home only because the operator explicitly configured it. Do not expand shell commands or arbitrary variables in path strings; existing configuration interpolation remains applicable.

Later configured directories override earlier directories. A package directory's name is its identity and must agree with frontmatter `name`. Reject duplicate YAML keys and malformed metadata. An invalid winning package masks the same name from earlier sources, with an operator diagnostic, rather than silently substituting instructions. Other valid packages survive. An unreadable source makes catalog discovery unavailable rather than pretending its overrides do not exist. Missing configured sources produce the same diagnostic; the application may continue serving other capabilities.

Scan one level, with fixed bounds of 32 configured sources and 10,000 child entries per source. Exceeding a source bound makes discovery unavailable; never resolve precedence from a partial scan. Follow an explicitly configured root symlink to its real directory. A child package symlink is admissible only when its real target is within an explicitly configured real source root. Resource links must remain within the selected real package directory. These rules support deliberate operator placement without admitting arbitrary neighboring files.

Directory configuration uses existing process-start config loading. Editing packages within those roots takes effect without restart. Changing the configured root list requires the existing app restart; this proposal does not add general config hot reload.

### D2: Portable package format and invocation controls

Use Agent Skills frontmatter `name`, `description`, optional `license`, `compatibility`, and `metadata`, plus instructions and supporting files. Enforce the published name rules and 1,024-character description bound. Use the repository's existing YAML dependency where available; do not write a YAML parser. Unknown extension fields are inert and preserved in the loaded file, not interpreted as runtime controls.

Recognize `disable-model-invocation: true` and `agents/openai.yaml` `policy.allow_implicit_invocation: false` as manual-only. Either disabling value wins when both are present. Wrong types or malformed invocation metadata invalidate the package. Default is proactive eligibility. `allowed-tools`, hooks, `context: fork`, model settings, command substitutions, and installation metadata cannot change llame authority or execute during loading. Unsupported executable extensions are reported as unsupported in load metadata, with no claimed vendor-runtime compatibility.

Manual-only skills stay visible in the owner catalog but are omitted from proactive model metadata. A `skill://` body/resource read for one requires an exact explicit selection in the current user turn. This is an invocation control, not a filesystem security boundary: ordinary permitted absolute-path reads remain governed by their own contract.

### D3: Baseline, deltas, and live availability

At the first user turn, inject proactive names, descriptions, and `skill://<name>` locators into the system prompt, with concise guidance to load relevant skills before applying them and to combine skills when useful. Keep this contribution frozen until compaction. Reuse the baseline even when another prompt contribution changes or the model changes; do not accidentally refresh it on every prompt render. On the next user-turn preparation after compaction, resolve current metadata and start a new disclosure baseline. A transition compaction during an already-bound Run keeps that Run's system prompt unchanged; it does not refresh skills mid-Run.

Persist owner-scoped per-Run skill disclosure state: the frozen baseline metadata/text, the epoch's compaction identity, and the last disclosed metadata state including omission information. Link it to the Run and its immutable context snapshot; do not parse the rendered system prompt to recover state. Resolve the prior Run/disclosure epoch before rendering the next prompt, reusing its baseline until a new compaction epoch is observed. Missing state on pre-feature Runs starts the first skill baseline. Persist the new state with user-turn creation so a worker restart does not choose a different baseline.

Before each subsequent user turn, rescan configured directories and compare the observed catalog with the last disclosed state in the chat's disclosure epoch. Append a `skill-catalog` notice for additions, removals, changed descriptions, invocation eligibility, selected source, or `SKILL.md`/invocation-policy content. It includes the new metadata needed to use added/changed entries and tells the model to reload changed instructions when next needed. Existing loaded bodies are not replaced. Reference/script bytes are read live when requested; merely editing a supporting file does not eagerly load it or require a catalog-wide resource inventory.

Keep the model metadata contribution within 16 KiB, ordered by name using code-point order, retaining complete entries. Disclose omitted entries/counts and support bounded catalog inspection through `read("skill://")`; this listing uses current proactive eligibility and the current turn's explicit selections. Owner catalog inspection includes manual-only entries. Delta overflow returns a bounded current metadata snapshot with an explicit supersession statement; no partial delta may pretend to be complete. New entries promoted from an omitted portion count as additions to disclosed state.

No watcher is required: rescan at user-turn preparation and at skill invocation. A removed or newly invalid package fails the next read immediately even if the prompt still lists it. There are no unsolicited updates before later model requests within the same Run. A file changed during an ongoing read can produce the usual live-filesystem observation; there is no transactional package snapshot.

### D4: One read surface with usable paths

`read("skill://pdf")` addresses `SKILL.md`; `read("skill://pdf/references/formats.md")` addresses a resource. `skill://pdf/` lists its package directory; `skill://` lists catalog metadata. Use the Knowledge locator's segment decoding and validation conventions, with a skill name instead of Space ID. Root/catalog forms have their own explicit grammar. Native range, raw, directory, and truncation conventions remain applicable. `edit` and `write` reject this scheme without side effects.

On every package read, resolve the current winning package and validate the target before opening. Read the requested file once and derive observed content metadata from those bytes. Results carry the logical locator, selected source, absolute `resolvedPath`, and absolute `skillDirectory`. Both paths must reach the model-facing output and owner view, not only internal tool metadata. The model-system-prompts delta explicitly permits these published skill paths in receipts while retaining every private-configuration exclusion. The header states that relative package references resolve against `skillDirectory`. Add a skill-specific native result envelope at the skill dispatch branch in `native-files.ts`; reserve its serialized size before truncating file content, as the Knowledge branch reserves its own envelope. If the envelope alone cannot fit, return a bounded error rather than lose the script base. Do not add these paths to the shared Knowledge envelope. These paths are intentionally public for all configured skill packages; no second publication-path setting is required. Existing Knowledge results keep their private backing paths hidden.

The loader does not interpolate shell text or execute a script. For a skill saying `./scripts/extract.py <input>`, the model can submit:

```json
{
  "command": "python3 /opt/skills/pdf/scripts/extract.py /work/report.pdf",
  "cwd": "/work"
}
```

Using an absolute script path preserves the meaning of task-relative input arguments. A script requiring its own directory as working directory must document that requirement; the model then supplies `cwd` explicitly and resolves input paths accordingly. Imports relative to a script file remain the interpreter's responsibility. Bare `python3 skill://...` receives no special treatment in llame.

Native script execution requires the normal available Bash tool and native executor gate. Skill reads can work without host Bash authority, but a returned file path does not grant execution or guarantee that a different executor has that file. The first-cut deployment requires the API and native executor to share the configured skill filesystem; distributed package transport is deferred.

### D5: Explicit selection and durable observations

Recognize `$<skill-name>` tokens in user-authored text outside fenced code blocks, inline code, and escaped dollar signs; require name boundaries and use the full valid name, not a prefix. Do not search assistant text, quoted tool output, attachments, or system reminders for activation. Multiple mentions activate distinct skills in first-mention order; repeated mentions of one name in a turn load it once. Ordinary prose without the dollar token uses model judgment. No argument substitution is added: the original user text remains available to all selected instructions.

After the exclusive Run claim and before context assembly/window-fit checks and receipt recording, load explicit selections through `runTool` with the bound read declaration and the same trusted execution-context builder and policy dependency used by model-initiated calls. Extract that context builder from the later execution setup so activation cannot invent authority or skip #763. `runTool` itself does not author assistant tool parts; only its normal caller does, so explicit activation records a context item instead. Do not create a parallel read-permission evaluator. A manual-only selection supplies trusted turn context, not a model-set bypass flag. Persist a `skill-activation` context item per result in the triggering user message, including final rendered instructions or a bounded unavailable/permission error. Do not fabricate an assistant tool call. Failure of one selection does not stop other selections or the Run.

Persist each completed explicit activation under an idempotent `(Run, distinct-mention ordinal)` identity before the first provider request and reuse it on recovery. Insert activation parts in their declared producer/mention order before rebuilding model context, preserving existing part relative order and original user text. On partial recovery, reuse completed ordinals and perform only unfinished reads; never repeat a completed failure to see whether it now succeeds. A new invocation reads live bytes; replay of a completed observation uses its stored text, never a new read. Capture selected source, resolved target, observed content identity, and the actual model-visible output, including truncation. This records what was consumed without enforcing version equality on future calls or claiming the script later executed identical bytes.

Context receipts include the frozen catalog contribution, current-turn catalog notices, and activation items. Ordinary model-triggered loads remain tool results. Reuse existing owner-scoped persistence/RLS and stored part ordering. Compaction follows current history rules; no permanent pinning of all previously activated skill bodies. Later relevant tasks can reload live instructions.

### D6: Trust, availability, and owner inspection

Global roots contain operator-trusted, intentionally shared content. Keep credentials and user-private files outside them. Preserve the common known-secret protection and delimiter framing; do not promise a general secret detector for arbitrary operator-authored content. Skill trust does not change permissions, expose process credentials, or permit cross-owner Knowledge access.

`tools.allowed` still owns availability. Extend the native candidate admission currently owned by `KnowledgeToolCandidateResolver` so configured skill sources make only `read` eligible; do not apply the broader Knowledge-root condition to all native tools. Keep absolute host execution checks in their existing dispatch branch. The advertised read declaration must remain usable to discover newly added packages within configured roots. Both explicit and proactive loading require `read` to be admitted and permitted. Catalog and activation items carry their own precedence/no-authority-expansion statement even with an operator-replaced system prompt. Neutralize reserved delimiters in operator metadata and loaded instruction content before composing/persisting prompt or context-item text; derive the raw observed identity before that transformation. Replay uses the final persisted text without another sanitization pass. Native tool reads retain their existing model-projection neutralization. Match permissions against the submitted logical locator, not the resolved host path; absolute-path reads and Bash commands retain their existing rules. No new tool ID or implicit grant is needed. Coordinate this additional locator projection with #763's implementation; do not silently bypass its admission path.

Add authenticated `GET /api/v1/skills` for current owner inspection: bounded entries with name, description, invocation eligibility, source directory/path, availability, and continuation metadata. It is a read-only system catalog, not an owner mutation API. Existing owner-visible context/tool views show actual loaded content and paths; a dedicated picker/autocomplete UI is deferred.

Removing a configured source after restart or deleting a package prevents new skill-locator loads. Removing a source does not delete its files or revoke ordinary Bash/absolute-path access to surviving files. Operator ownership and OS permissions protect installed packages; skill invocation and owner-scoped Knowledge tools cannot mutate the global catalog. An explicitly enabled host Bash retains its documented host authority.

## Risks / Trade-offs

- R1: Trusted packages can disclose secrets placed inside them. Operator procedures must treat every published package as shared; existing credential protection remains mandatory.
- R2: Files can change between instruction reads and script execution. Live behavior is intentional; receipts record observations, not immutable executable packages.
- R3: Manual-only metadata can conflict across vendors. A disabling flag wins; unsupported execution extensions do not acquire semantics accidentally.
- R4: Polling adds directory I/O. Bound discovery and catalog output; do not introduce watchers or a cache that weakens invocation-time removal checks.
- R5: Old bodies may remain in history after an update. Next-user-turn reminders tell the model to reload; deleting past context or steering an active Run is outside scope.

## Migration Plan

Default empty directories preserve current behavior. Add configuration/schema documentation, then implement the catalog and read path before activation/reminders. Any required persistence columns use normal generated migrations and existing owner isolation. Deploy skill packages with operator-owned filesystem permissions on each participating executor host. Disable by emptying the configured directory list and restarting; existing observations remain replayable.

Update #770's acceptance text to the agreed live-read, path-publication, configured-precedence contract when this proposal is published. Keep #772 and #782 separate; neither blocks the first cut.

## Sources

Observed 2026-09-11. Primary-source inspection; upstream tests were read, not executed.

- S1: [Agent Skills specification](https://agentskills.io/specification) defines the portable package, references, and scripts. Invocation-disabling controls below are extensions, not standard fields.
- S2: [Codex skills](https://learn.chatgpt.com/docs/build-skills) supplies metadata-first explicit/proactive loading and `allow_implicit_invocation`.
- S3: [Claude Code skills](https://code.claude.com/docs/en/skills) supplies `disable-model-invocation`, multi-skill invocation, and package-directory addressing. Its executable hooks and dynamic substitutions are not adopted.
- S4: [OMP URI expansion](https://github.com/can1357/oh-my-pi/blob/8d01d3b79099a0ad10d050538a08bd4c22886dd7/packages/coding-agent/src/tools/bash-skill-urls.ts#L259-L347) rewrites skill URIs into shell paths; llame deliberately retains literal Bash commands instead.
- S5: [OpenCode v2 registry](https://github.com/anomalyco/opencode/blob/6bb4b353997b3c57cfa0e7fb739f44b6f75a65e1/packages/core/src/skill.ts) separates source identity and activation guidance. Its remote source machinery is outside this slice.
- S6: [OpenClaw discovery](https://github.com/openclaw/openclaw/blob/af73c58582b559187c94f86275402f54e5ccae58/docs/tools/skills.md) informs configured directories; llame uses the user's simpler ordered operator-only sources.

## Revision history

- v2 (2026-09-11): Clarified per-item framing, delimiter handling, receipt path publication, persisted baseline state, explicit-activation admission/recovery, skill-only result/candidate branches, and next-user-turn rebaseline after transition compaction following two independent reviews.
- v1 (2026-09-11): Initial proposal from the completed grilling decisions.
