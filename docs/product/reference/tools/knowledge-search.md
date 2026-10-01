---
summary: "knowledge_search finds Markdown matches in Knowledge Spaces and returns kb:// read coordinates"
read_when:
  - you need to find a note in a Knowledge Space and then open the passage
  - you need to know what knowledge_search scans, returns, or refuses
spec: knowledge-tools
configured_by: ../../operator/knowledge.md
---

# knowledge_search

## Purpose

`knowledge_search` scans Markdown across one Knowledge Space, or across every
Space the Run owner currently owns, and returns bounded matches with the
coordinates that open them. The note itself is read with the native
[`read`](read.md) tool; see [kb locators](../locators/kb.md).

## Arguments

- `query`: a literal string. It is not a pattern.
- `limit`: 1-10 results; optional.
- `knowledgeSpaceId`: one Space to scan; optional.
- `cursor`: an opaque continuation cursor from a previous result; optional.

Without `knowledgeSpaceId` the search scans all currently owned spaces in
deterministic pages under shared bounds. Access is resolved live under RLS.

## Locators

Every match carries a one-based inclusive `locator`
(`kb://<knowledgeSpaceId>/<path>:N-M`), which is a ready `read` argument: drop
the `:N-M` suffix to read the whole note. A reserved character in the filename
is emitted as its percent escape only, and a colon-named Markdown file is
searched normally. See [kb locators](../locators/kb.md) for the escaping
grammar.

## Result

Each result carries the current space ID and name, the relative path, the
`locator`, and an excerpt capped at 500 Unicode code points. Cropped excerpts
show ellipses while the locator still addresses the full passage.

The result is an excerpt plus coordinates, not the file itself. Content is
untrusted and may be stale, and it carries the untrusted-content warning
rather than being neutralized. A result never exposes host paths, owner IDs,
credentials, or raw filesystem errors.

An unscoped search may return usable matches with `complete: false` when one
space fails safely, and a cursor is a live keyset continuation rather than a
snapshot.

## Behavior

Scanning is case-insensitive and literal: no regex, subprocess, Markdown
parser, index, or embeddings. Each occurrence includes at most one adjacent
line on each side; touching windows merge and split at 2,000 lines. Only
Markdown is indexed, and an oversized or invalid-UTF-8 `.md` file warns per
Space.

A search hit never triggers an instruction file. `knowledge_search` is a
bounded Markdown scanner, not an index, an embeddings store, or a Git revision
contract.

## Bounds

- `limit` is 1-10.
- An excerpt is capped at 500 Unicode code points.
- A match window is the occurrence plus one adjacent line on each side;
  touching windows merge and split at 2,000 lines.

## Errors

An explicit target failure, total failure, no inventory, a timeout or
cancellation, an invalid cursor, and a global-limit failure are top-level and
closed; they return no partial passages as complete.

## Configured by

[Personal Knowledge](../../operator/knowledge.md) — the Knowledge root and the
`knowledge_search` allowlist entry.
