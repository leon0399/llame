# apps/web and packages/ui

`apps/web` is a Next.js 16 App Router thin client. It owns NO database — a DB import here
is an automatic reject.

Check: server state goes through TanStack Query key factories, not ad-hoc fetches;
`proxy.ts` stays a cookie-presence UX gate and never calls the API per request or touches
auth logic (apps/api guards are authoritative); generated Orval modules are consumed only
from `lib/services/` and `lib/api/`, never from components or routes; optimistic cache
patches only where the next state is client-computable, and never for creations needing
server-assigned fields; a test that renders a component and asserts DOM belongs in a
Storybook play function, not a jsdom test.

`packages/ui` is the shared shadcn/ui library consumed by the apps.

Check: generated shadcn and AI Elements primitives are treated as vendored — composed
around rather than edited, except for the intentional JSDoc fork; every story an agent
writes carries the `ai-generated` tag and never has it removed; a story-only dependency is
added to BOTH `optimizeDeps.include` and `apps/storybook`'s devDependencies; an a11y rule
suppression carries a justifying comment and, at story level, spreads the inherited meta
rules rather than replacing them; no ad-hoc colors — use the semantic OKLCH tokens in
`DESIGN.md`.
