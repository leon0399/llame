---
type: Reference
title: "Vercel Chatbot (formerly ai-chatbot)"
description: "Chat/message schema and request admission"
resource: "https://github.com/vercel/chatbot/tree/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58"
sources:
  - id: lib-db-schema-ts-l28-l53
    resource: "https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/lib/db/schema.ts#L28-L53"
    title: "Chat and Message_v2 schema"
  - id: app-28chat-29-api-chat-route-ts-l70-l133
    resource: "https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/app/%28chat%29/api/chat/route.ts#L70-L133"
    title: "Auth, model allowlist, and owner check"
  - id: app-28chat-29-api-chat-route-ts-l269-l305
    resource: "https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/app/%28chat%29/api/chat/route.ts#L269-L305"
    title: "bounded tool loop"
---

# Vercel Chatbot (formerly ai-chatbot)

- **Stack:** Next.js, React, AI SDK, Drizzle, PostgreSQL, optional Redis; Apache-2.0
- **Observed:** 2026-09-10 @ `c2f8235e1f3ea903ad8b7f61447c4f74164b5c58`

A compact reference for role-plus-parts message persistence and request admission.
High confidence in those implementation comparisons; its route-owned execution
differs from llame's durable pg-boss Runs.

**Study**

1. **Message projection.** `Chat` and `Message_v2` schema[^lib-db-schema-ts-l28-l53] is useful comparative evidence for role-plus-parts persistence and display attachments.
2. **Request policy.** Auth, model allowlist, and owner check[^app-28chat-29-api-chat-route-ts-l70-l133] plus the bounded tool loop[^app-28chat-29-api-chat-route-ts-l269-l305] show a small admission-and-execution boundary.

**Caution:** `getChatById` queries by ID alone, so callers must enforce ownership; the application path has no datastore RLS.

[^lib-db-schema-ts-l28-l53]: [`Chat` and `Message_v2` schema](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/lib/db/schema.ts#L28-L53)

[^app-28chat-29-api-chat-route-ts-l70-l133]: [Auth, model allowlist, and owner check](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/app/%28chat%29/api/chat/route.ts#L70-L133)

[^app-28chat-29-api-chat-route-ts-l269-l305]: [bounded tool loop](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/app/%28chat%29/api/chat/route.ts#L269-L305)
