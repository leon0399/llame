## Why

Every tool call is decided by the operator's `tools.permissions` policy, and a call that matches no
allow is rejected with no way for the owner to proceed short of an operator config edit and a
restart ([#977](https://github.com/leon0399/llame/issues/977)). For an owner doing trusted work on
their own host, such as a refactor that needs `git reset --hard` or a read outside the allowlisted
roots, the policy's text rejects stop legitimate work, and the only escape is to loosen the policy
for every user and every Run.

The policy guards against model mistakes more than it separates users. Under the recommended
portable map, `bash` is whole-tool allowed with only the textual rejects B1–B8, so credential paths
that F1 protects for `read` are already reachable through `bash`. What an owner lacks is a way to
say, for one message, "run this without the guardrails", and what the operator lacks is a way to
decide whether owners may say that at all.

## What Changes

- A chat send (`POST /api/v1/chats/:id/messages`) accepts an optional top-level `permissionMode`,
  `"default"` or `"bypass"`. Omitted means `default`. The mode is validated after `modelId` and
  `effort`; a mode the operator has not enabled returns 422 `permission_mode_not_available` and
  creates no message and no Run.
- The operator enables modes with `tools.permissionModes`, an ordered list that defaults to
  `["default"]` and must contain `default`. A fresh install never offers `bypass`.
- The accepted mode is fixed on the Run, persisted, and returned on `RunResponse` and the context
  receipt response. Retries and recovery attempts of the Run reuse it; changing a running Run's
  mode is [#998](https://github.com/leon0399/llame/issues/998).
- Under `bypass`, no `tools.permissions` group is evaluated anywhere a Run's tool execution
  consults one: the per-call gate, web-read derived locators and resolved addresses, the
  `enter_workspace` submitted and canonical paths, and the per-attempt Workspace re-check. Every
  other gate stays: `tools.allowed` availability, owner and tenant authorization, the native
  recovery fence, execution bounds, and MCP environment isolation.
- Each bypassed call and derived locator records an `allow` decision with the static reason
  `permission_mode_bypass`, the executing process's policy-instance ID, and no clause reference,
  so the owner-private tool record shows which calls ran unchecked.
- A worker whose own configuration does not enable `bypass` evaluates a queued `bypass` Run's
  calls under its policy and records those decisions.
- The mode is not model-visible: it is not rendered into the system prompt or receipt, and a
  mode change between turns is not a context event.
- `GET /api/v1/permission-modes` lists the enabled modes so the web client can offer only those.
- The web composer gains a permission-mode selector at the left of its toolbar. It renders nothing
  when only `default` is enabled, starts at `default` on every new chat and page load, and uses the
  destructive style while `bypass` is selected. A `bypass` turn's usage badge reads
  `model · effort · Bypass · latency`.

Not in scope: the model-judged `auto` mode
([#999](https://github.com/leon0399/llame/issues/999)); changing a running Run's mode (#998);
restoring the composer's selections when a chat reopens
([#997](https://github.com/leon0399/llame/issues/997)); per-user gating, which waits for an
instance-level authorization signal ([#158](https://github.com/leon0399/llame/issues/158));
interactive approvals ([#778](https://github.com/leon0399/llame/issues/778)); and any other mode
such as accept-edits or plan.

## Capabilities

### New Capabilities

- `permission-modes`: the per-send permission mode, its acceptance and operator gate, its
  persistence on the Run, the enabled-mode listing, its absence from model context, and its owner
  display in the composer and usage badge.

### Modified Capabilities

- `tool-call-permissions`: a `bypass` Run evaluates no permission group at any evaluation site and
  records `permission_mode_bypass` decisions; the per-process policy rule extends to the
  per-process mode gate, so a worker that does not enable `bypass` applies its policy.
- `instance-config`: optional `tools.permissionModes`, validated at startup.

## Impact

- `apps/api/src/chats`: `CreateMessageDto.permissionMode`, accept-time validation in
  `chat-loop.service.ts`, and the 422 mapping in the controller.
- `apps/api/src/db`: a `runs.permission_mode` column with a check constraint and one generated
  migration; existing rows become `default`.
- `apps/api/src/tools`: the permission context threaded to every evaluation site
  (`runner.ts`, `web-read/admission.ts`, `workspace.ts`) and the new decision reason, including
  durable transcript reconstruction in `runs/assistant-transcript.ts`.
- `apps/api/src/runs`: claim returns the persisted mode, the Workspace re-check honours it, turn
  telemetry and `RunResponse` carry it.
- `apps/api/src/instance-config`: the `tools.permissionModes` key, loader validation, JSON Schema,
  and `llame.config.json.example`.
- A new `GET /api/v1/permission-modes` controller and regenerated OpenAPI client.
- `apps/web`: a `PermissionModeSelector`, `ChatContext` state, the send transport, and the usage
  badge.
- Docs: `README.md`, `SPEC.md` §8 and §13, `docs/product/operator/native-files.md`, and `CHANGELOG.md` on ship.
- Closes [#977](https://github.com/leon0399/llame/issues/977).
