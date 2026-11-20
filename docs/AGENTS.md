# Documentation instructions

Rules for writing under `docs/`. [index.md](index.md) is the map of the tree
and says which subtrees are served to the assistant and which source wins a
disagreement. `research/` follows its own [AGENTS.md](research/AGENTS.md) in
addition to the placement and prose rules below. The other rules here govern
`product/` and `development/`.

## Placement

| Content                                                                                       | Location                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| What a tool, locator scheme, or selector does, as the chat owner and the assistant observe it | `product/reference/`                             |
| How an operator enables, restricts, deploys, migrates, or troubleshoots a capability          | `product/operator/`                              |
| Testing, quality gates, runtime choices, design records that outlive their change             | `development/`                                   |
| What a domain term means, and the words to avoid for it                                       | `product/glossary.md`                            |
| Why a hard-to-reverse, surprising architecture decision was made                              | `adr/` (rules in [adr/AGENTS.md](adr/AGENTS.md)) |
| Noncanonical prior art and studies                                                            | `research/`                                      |
| A plan in progress                                                                            | its GitHub issue, not a page                     |

## Rules

- **One rule, one page.** State a behavior on the page that owns it and link
  to it from everywhere else. Reference pages own behavior; operator pages own
  configuration and procedure. Before adding a sentence, search for the rule
  and link it if it already exists.
- **Terms come from the glossary.** Use the term and casing that
  [product/glossary.md](product/glossary.md) defines. Define a new or renamed
  concept there, in the PR that ships it, and never on another page.
- **Reference pages carry nothing an operator does.** No configuration
  procedures, no config keys beyond a tool id, a locator form, or a permission
  group name, no `apps/api` or `dist/` paths, no table names, no pnpm commands,
  no issue or PR numbers. Say "the operator enables this" and link the
  operator page.
- **Every `product/` page opens with frontmatter.** `summary` is the one line a
  listing prints; `read_when` lists the reasons to open the page. Reference
  pages add `spec` (the owning OpenSpec capability directory, or a list) and
  `configured_by`. An operator page that configures behavior documented under
  `product/reference/` adds `behavior`, linking those pages; a page with
  nothing to link, such as a provider runbook, omits it. `index.md` pages need
  only `summary` and `read_when`.
- **Fixed section order.** Pages under `product/reference/tools/` use Purpose,
  Arguments, Locators, Result, Behavior, Bounds, Errors, Configured by. Pages
  under `product/reference/locators/` use Form, Accepted by, Authority,
  Behavior, Bounds, Listing, Errors, Configured by. Omit an empty section; do
  not add another H2.
- **Links are relative Markdown links with the `.md` extension.** Anchors are
  GitHub heading slugs. Renaming a heading breaks inbound anchors; search for
  them first.

## Prose

These rules apply to every page that you write or edit under `docs/`. The
check in `scripts/check-prose.mjs` enforces the mechanical rules on `adr/`.
Older pages in other directories follow the rules as they are edited.

- **One mode per page, set by its directory.** `product/reference/` is
  reference: dry, complete, and without opinion. `product/operator/` is
  how-to: steps toward a goal. `adr/` and `research/` are explanation:
  context, trade-offs, and the reason for a choice.
- **One idea per sentence.** Aim for about 25 words. The check fails a
  sentence of more than 35 words.
- **Name the actor.** Use the active voice unless the actor is unknown or
  does not matter.
- **Name the real thing.** Write the actual symbol, file, flag, or command in
  code font. Call each concept by its glossary name, and only that name.
- **Plain punctuation.** End a sentence with a period. Do not use semicolons,
  em dashes, or en dashes. Use straight quotes.
- **No generated-prose patterns.** Apply the
  [unslop](../.agents/skills/unslop/SKILL.md) skill. Glossary and README terms
  override its word lists.

OpenSpec requirement and scenario text follows Simplified Technical English,
as `openspec/config.yaml` states. Do not apply it to pages under `docs/`. Its
restricted vocabulary and its ban on "would" and "may" do not fit
explanation.

## Changing behavior

- A change to a tool, locator, selector, or permission rule updates its
  reference page in the same PR, and its operator page when configuration
  changes.
- A new packaged tool gets a page under `product/reference/tools/` and a row in
  its [index](product/reference/tools/index.md); the tool-description test
  fails without the page. A new locator scheme gets a page under
  `product/reference/locators/` and a row in that
  [index](product/reference/locators/index.md) and in the `read` page's
  locator table.
- A new operator page gets an entry in
  [operator/index.md](product/operator/index.md); a new development page in
  [development/index.md](development/index.md).

## Verification

Run `pnpm lint:markdown` (markdownlint plus
`scripts/check-markdown-links.mjs`: links, anchors, frontmatter keys, and
`spec`/`configured_by`/`behavior` resolution), `pnpm exec oxfmt --check` on
the changed files, and `git diff --check`.
