# Personal node experiment

Lightweight single-owner local Node runtime. This app must not import NestJS,
PostgreSQL repositories, pg-boss, or hosted tenant assumptions.

Commands:

```bash
pnpm --filter personal-node test
pnpm --filter personal-node typecheck
pnpm --filter personal-node lint
```

The embedded store is node-local. Network surfaces bind to loopback by default,
authenticate every protocol request, derive node/Realm identity from trusted local
configuration, and never accept caller-supplied identity as authorization.
