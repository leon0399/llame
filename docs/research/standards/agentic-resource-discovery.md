---
type: Reference
title: "Agentic Resource Discovery and AI Catalog"
description: "Publishing, indexing and searching MCP servers, A2A agents, skills and plugins"
resource: "https://agenticresourcediscovery.org"
observed:
  date: "2026-09-27"
  revision: "b76f235a8f461876ad4f1e77abd0eb0eb302b48d"
sources:
  - id: ard-spec
    resource: "https://github.com/ards-project/ard-spec/blob/b76f235a8f461876ad4f1e77abd0eb0eb302b48d/spec/ard.md#L1-L35"
    title: "Agentic Resource Discovery specification v0.91"
  - id: ard-discovery
    resource: "https://github.com/ards-project/ard-spec/blob/b76f235a8f461876ad4f1e77abd0eb0eb302b48d/spec/ard.md#L185-L280"
    title: "ARD static discovery, ingestion and search"
  - id: ard-how
    resource: "https://agenticresourcediscovery.org/how_ard_works/"
    title: "How ARD works"
  - id: ard-governance
    resource: "https://agenticresourcediscovery.org/governance/"
    title: "ARD governance"
  - id: ai-catalog-readme
    resource: "https://github.com/Agent-Card/ai-catalog/blob/04a99cd1ac9a20dd6586c6196e87f5e4570303b1/README.md"
    title: "AI Catalog README"
  - id: ai-catalog-format
    resource: "https://github.com/Agent-Card/ai-catalog/blob/04a99cd1ac9a20dd6586c6196e87f5e4570303b1/specification/ai-catalog.md#L90-L162"
    title: "AI Catalog document format"
  - id: ai-catalog-discovery
    resource: "https://github.com/Agent-Card/ai-catalog/blob/04a99cd1ac9a20dd6586c6196e87f5e4570303b1/specification/ai-catalog.md#L1217-L1245"
    title: "AI Catalog location and well-known URI"
  - id: ai-catalog-trust
    resource: "https://github.com/Agent-Card/ai-catalog/blob/04a99cd1ac9a20dd6586c6196e87f5e4570303b1/specification/ai-catalog.md#L491-L1000"
    title: "AI Catalog Trust Manifest"
  - id: ai-catalog-governance
    resource: "https://github.com/Agent-Card/ai-catalog/blob/04a99cd1ac9a20dd6586c6196e87f5e4570303b1/GOVERNANCE.md"
    title: "AI Catalog governance"
  - id: mcp-server-json
    resource: "https://github.com/modelcontextprotocol/registry/blob/bf4e88cbe8d1a635c06144ccea1d24cb52fa6186/docs/reference/server-json/generic-server-json.md"
    title: "MCP Registry server.json"
---

# Agentic Resource Discovery and AI Catalog

- **Status:** ARD v0.91 proposal dated 2026-08-26, Apache-2.0, oversight board
  from Google, Hugging Face, Microsoft, Amazon and Cisco[^ard-spec][^ard-governance].
  AI Catalog is a Linux Foundation working repository with a technical steering
  committee seated by Google, Microsoft, Anthropic and PulseMCP plus MCP and A2A
  nominees; no released version beyond the document's
  `specVersion: "1.0"`[^ai-catalog-readme][^ai-catalog-governance]

Two layers of the same idea. **AI Catalog** is a static, nestable envelope
(`application/ai-catalog+json`, servable from any URL, with
`/.well-known/ai-catalog.json` as an optional discovery location[^ai-catalog-discovery]) listing
heterogeneous artifacts: A2A Agent Cards, MCP Server Cards, Agent Skills and
plugin bundles, each by `url` or inline `data`[^ai-catalog-format]. **ARD** adds
search: its own entry format at `/.well-known/ard.json`, registries that ingest
entries and a federated `POST /search`[^ard-discovery]. ARD treats AI Catalog as
its predecessor: every ARD entry is a catalog entry, and consumers may still read
the catalog locations.

**Mechanics**

1. **Entries.** `identifier` (usually `urn:air:<publisher>:...`), `type` as the
   artifact media type, and `url` or `data`. The native card stays authoritative
   for transport, tools and auth; the entry only points at it.
2. **ARD discovery signals.** `representativeQueries`, capabilities and tags
   drive semantic ranking. Sources include `ard.json`, in-page JSON-LD, a
   `robots.txt` `Agentmap:` line, `<link rel="ard">` and DNS service
   binding[^ard-how].
3. **Scores.** An ARD search `score` is relevance only; the spec says it is not
   a trust or safety score.
4. **Trust.** AI Catalog's Trust Manifest is optional, and a manifest may carry
   attestations or provenance without a signature. A signed one must include a
   `subject` with the media type and digest; `subject.url` is optional, so an
   inline `data` artifact is bound by its canonical digest alone. The detached
   JWS is over JCS, with keys from DID, JWKS, SPIFFE or DNS; verification still
   needs an out-of-band trust anchor[^ai-catalog-trust]. ARD delegates signing
   to the declared framework.
5. **MCP Registry.** `server.json` and the registry's REST API are a separate,
   MCP-specific package index[^mcp-server-json]; a catalog can point at MCP
   artifacts but does not replace it.

**llame fit: watch.** Every executor, MCP server and skill in llame is
operator-configured. A catalog could become an import format for that
configuration, and ARD's relevance-versus-trust split matches llame's rule that
relevance is never authorization. Open-web discovery that adds tools at run time
would need tenant scope, permission groups and provenance first.

**Caution:** both are pre-1.0 and overlap with MCP Server Cards and
`server.json`, which have not converged. A signed manifest without an anchored
identity proves integrity, not publisher authenticity.

[^ard-spec]: [Agentic Resource Discovery specification v0.91](https://github.com/ards-project/ard-spec/blob/b76f235a8f461876ad4f1e77abd0eb0eb302b48d/spec/ard.md#L1-L35)

[^ard-discovery]: [ARD static discovery, ingestion and search](https://github.com/ards-project/ard-spec/blob/b76f235a8f461876ad4f1e77abd0eb0eb302b48d/spec/ard.md#L185-L280)

[^ard-how]: [How ARD works](https://agenticresourcediscovery.org/how_ard_works/)

[^ard-governance]: [ARD governance](https://agenticresourcediscovery.org/governance/)

[^ai-catalog-readme]: [AI Catalog README](https://github.com/Agent-Card/ai-catalog/blob/04a99cd1ac9a20dd6586c6196e87f5e4570303b1/README.md)

[^ai-catalog-format]: [AI Catalog document format](https://github.com/Agent-Card/ai-catalog/blob/04a99cd1ac9a20dd6586c6196e87f5e4570303b1/specification/ai-catalog.md#L90-L162)

[^ai-catalog-trust]: [AI Catalog Trust Manifest](https://github.com/Agent-Card/ai-catalog/blob/04a99cd1ac9a20dd6586c6196e87f5e4570303b1/specification/ai-catalog.md#L491-L1000)

[^ai-catalog-governance]: [AI Catalog governance](https://github.com/Agent-Card/ai-catalog/blob/04a99cd1ac9a20dd6586c6196e87f5e4570303b1/GOVERNANCE.md)

[^mcp-server-json]: [MCP Registry server.json](https://github.com/modelcontextprotocol/registry/blob/bf4e88cbe8d1a635c06144ccea1d24cb52fa6186/docs/reference/server-json/generic-server-json.md)

[^ai-catalog-discovery]: [AI Catalog location and well-known URI](https://github.com/Agent-Card/ai-catalog/blob/04a99cd1ac9a20dd6586c6196e87f5e4570303b1/specification/ai-catalog.md#L1217-L1245)
