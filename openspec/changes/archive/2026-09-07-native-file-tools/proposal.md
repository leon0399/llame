## Why

llame currently exposes a Knowledge-specific read contract while coding-style
agents use a different file workflow. That forces the model to learn separate
path, range, output, and edit conventions for the same ordinary files. The first
native tool layer should give the model one direct local file interface that can
serve coding files, Knowledge files, and later resource adapters.

This alpha slice deliberately trusts the local executor's OS authority. It is
not a multi-user permission design and must not be advertised through an
unrestricted hosted worker as a production isolation boundary.

## What Changes

- Add model-facing `read`, `edit`, and `write` tools for absolute local regular
  file paths.
- Add OMP-inspired selectors `:N-M`, `:N+K`, and `:raw`; selector line numbers
  are one-based and normalize to the existing internal zero-based reader.
- Make ordinary bounded reads include one live source line above and below the
  requested range when available. Context appears in the same returned content;
  details identify requested and shown ranges.
- Return one common result envelope with path, representation, range, and
  truncation details. Raw reads return verbatim content with no generated line
  prefixes or processors.
- Make `edit` an exact unique `oldText` to `newText` replacement. It executes
  sequentially per path, preserves unrelated file changes, and fails without a
  write when the target is missing or ambiguous.
- Make `write` creation-only. Existing files fail instead of being silently
  overwritten.
- Reuse the shared reader underneath `knowledge_read`, mark `knowledge_read`
  deprecated, and track its deletion after parity is proven.
- Keep Markdown ToC/frontmatter, OKF metadata, URL loading, directory listings,
  read-hash enforcement, Git submission, bash, and permission policy as later
  proposals.

## Capabilities

### New Capabilities

- `native-file-tools`: a local absolute-path reader and exact editor with a
  common bounded result format and future source/representation extension seam.

### Modified Capabilities

- `tool-calling`: admit the exact alpha native file tools and prevent a durable
  worker retry from replaying an unknown native mutation.

The existing Knowledge contract remains available during the migration; its
implementation is shared and its deletion is tracked as follow-up work.

## Impact

The primary implementation is a reusable `packages/native-file-tools` package
and its trusted local host adapter. It must not import tenant authorization,
Git, a Sandbox runtime, or a URL client. The model receives native host paths in
this alpha capability by explicit product choice; later `kb://` and
`chats:://` resolvers qualify resource identity and authorization.

The existing Knowledge reader becomes an adapter over the shared line/result
logic. Current `knowledge_read` callers and historical results remain valid
until a later deletion change removes the deprecated tool. No Markdown parser is
introduced in this proposal.
