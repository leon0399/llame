---
type: Reference
title: "Open WebUI"
description: "Multi-user chat, tool access, and provider integration"
resource: "https://github.com/open-webui/open-webui/tree/0a7c15832fb30b1903753e83f81dc7d27e5b0944"
sources:
  - id: backend-open-webui-models-access-grants-py-l25-l45
    resource: "https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/backend/open_webui/models/access_grants.py#L25-L45"
    title: "AccessGrant and permission filtering"
  - id: backend-open-webui-models-access-grants-py-l562-l620
    resource: "https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/backend/open_webui/models/access_grants.py#L562-L620"
    title: "owner, group, public access checks"
  - id: backend-open-webui-routers-tools-py-l135-l190
    resource: "https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/backend/open_webui/routers/tools.py#L135-L190"
    title: "MCP server access and per-user credential resolution"
---

# Open WebUI

- **Stack:** Python/FastAPI, SQLAlchemy, SvelteKit, SQLite or PostgreSQL; Open WebUI License
- **Observed:** 2026-09-10 @ `0a7c15832fb30b1903753e83f81dc7d27e5b0944`

A reference for application-level multi-user sharing and permission-filtered tool
catalogs. Moderate confidence for reuse in future llame sharing capabilities;
its access predicates need to coexist with llame's datastore-enforced isolation.

**Study**

1. **Reusable resource grants.** `AccessGrant` and permission filtering[^backend-open-webui-models-access-grants-py-l25-l45] and owner, group, public access checks[^backend-open-webui-models-access-grants-py-l562-l620] provide a candidate shape for future Knowledge or project sharing.
2. **Tool visibility.** MCP server access and per-user credential resolution[^backend-open-webui-routers-tools-py-l135-l190] demonstrates filtering the catalog before exposing server tools.

**Caution:** Authorization is enforced in application queries, with administrative bypasses; omitting one filter is a security defect. This provides no evidence for tenant isolation or RLS.

[^backend-open-webui-models-access-grants-py-l25-l45]: [`AccessGrant` and permission filtering](https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/backend/open_webui/models/access_grants.py#L25-L45)

[^backend-open-webui-models-access-grants-py-l562-l620]: [owner, group, public access checks](https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/backend/open_webui/models/access_grants.py#L562-L620)

[^backend-open-webui-routers-tools-py-l135-l190]: [MCP server access and per-user credential resolution](https://github.com/open-webui/open-webui/blob/0a7c15832fb30b1903753e83f81dc7d27e5b0944/backend/open_webui/routers/tools.py#L135-L190)
