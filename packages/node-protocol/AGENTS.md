# Common Node contract

- Follow root AGENTS.md and openspec/specs/node-access/spec.md.
- Principal comes from the host port; request fields cannot choose authority.
- Admit only concrete owner-read operations; no generic tool/admin forwarding.
- Preserve native bounded evidence instead of inventing scoring or sync parity.
- Runtime parsers, types and OpenAPI extensions must change together.
- Invalid/null/unknown fields, version drift and oversized responses fail closed.
- Run conformance tests and regenerate the real API OpenAPI before release.
