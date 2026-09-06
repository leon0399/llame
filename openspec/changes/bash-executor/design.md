## Context

Native `read`, `edit`, and `write` operate on live absolute local paths. Bash is
the complementary escape hatch for searches and mass changes, but its command
can mutate many files and run arbitrary installed programs. This proposal defines
the managed-executor contract; it does not expose direct host bash until an
enforceable secret and process-isolation boundary exists.

## Goals / Non-Goals

**Goals:**

- One bounded `bash` contract for a managed executor.
- Same working directory and bytes as the native file tools when attached to one
  executor context.
- Explicit command attempt, timeout, cancellation, output, and unknown-outcome
  behavior.
- A future Sandbox adapter that preserves command/result semantics.

**Non-Goals:**

- A direct native host bash implementation.
- Git submission, commit staging, PRs, or Knowledge acceptance.
- A Sandbox implementation in this proposal; the adapter seam is the contract.
- Automatic package installation, model-runtime management, network brokering,
  secrets policy, or environment-definition editing.

## Decisions

### D1: Bash waits for a managed executor boundary

The model-facing bash tool remains unavailable until a managed executor proves a
secret boundary, process isolation, output filtering, bounded resources, and a
trusted workspace mount. The model supplies only command text and bounded
arguments; it cannot select an executor, host path, environment, or policy.
Direct host bash is intentionally deferred because finite output limits cannot
prevent `env`, credential-file reads, or encoded secrets from reaching context.

### D2: Same executor means same directory

When bash and native file tools are attached to one executor context, both resolve
the same current working directory and observe the same live bytes. A successful
bash mutation is visible to the next `read` or `edit`; a successful `edit` is
visible to the next bash command. The host does not return a stale server copy or
silently substitute another directory.

A future managed Sandbox maps the trusted workspace into its configured working
directory. The model does not receive a host bind path or choose a mount.

Native file mutations and Knowledge submit use the same executor mutation gate.
While a bash process is running, submit waits for a known terminal command
result. If command termination is unknown, the workspace is fenced and submit is
refused until recovery proves that no process can still mutate it.

### D3: Bound command execution and result shaping

The command request contains command text, optional arguments, and no raw
executor selection. The host applies finite timeout, output, process, and input
bounds. The result includes status, exit code when known, bounded stdout/stderr,
working-directory attribution appropriate to the alpha host, and truncation
metadata. Secrets and raw stack traces are excluded from model-visible output.

The command may use ordinary installed tools such as `grep`, `rg`, `jq`, Python,
or Git. Bash is not made the canonical editor; native `edit` remains the safe
single-replacement path for small changes.

The known-result shape is:

```json
{
  "status": "success",
  "operation": "bash",
  "executor": "native",
  "exitCode": 0,
  "stdout": "matched line\n",
  "stderr": "",
  "truncated": false
}
```

Known non-zero exits use `status: "error"` with the exit code and bounded
streams. Unknown termination uses:

```json
{
  "status": "error",
  "type": "outcome_unknown",
  "attemptId": "<opaque-id>",
  "message": "Command outcome could not be established; it was not replayed."
}
```

Host paths and raw runtime diagnostics are omitted from model-visible output.

### D4: Attempt before execution, unknown after uncertain termination

The host records an opaque attempt identity and trusted command metadata before
starting the process. A normal exit after the process tree is known stopped is a
known result. Timeout, host crash, failed cancellation, or uncertain descendant
termination produces `outcome_unknown`. The host never automatically reruns an
unknown command under a new model tool-call ID.

The containing run may continue only when the executor proves the process tree
has stopped. A failed proof fences the executor context until an operator/runtime
recovery path resolves it. Bash output is never treated as a Git or Knowledge
commit receipt.

### D5: Future Sandbox compatibility is a transport seam

The future managed Sandbox adapter receives the same command, working-directory,
input-bound, output-bound, cancellation, and result contract. It may change the
executor class, environment definition, network policy, and process isolation,
but it cannot change the meaning of a successful or unknown command. Sandbox
definition revisions, instance identity, placement, and FileView mounts belong
to a later capability and remain separate from this command schema.

## Risks / Trade-offs

- [Native bash has broad OS authority] -> label it explicitly and keep it in the
  alpha/native host capability; do not advertise it as multi-user isolation.
- [Mass commands can change many files] -> keep native edit as the constrained
  editing path, return bounded diffs only through later tooling, and let Git
  submission remain explicit.
- [Unknown commands cannot be safely retried] -> durable attempt before start,
  process-tree termination proof, and terminal `outcome_unknown`.
- [A future Sandbox may not share native semantics] -> contract-test same-path
  observations and refuse adapters that expose stale or alternate workspaces.

## Migration Plan

1. Land the command contract and alpha native adapter behind explicit host setup.
2. Add same-context tests with native file tools.
3. Add a separate managed-Sandbox implementation only after its threat model and
   environment policy are approved.

## Open Questions

- Exact default numeric bounds can follow the executor's existing conventions;
  behavior must remain finite and observable.
- Stronger network, secret, device, and environment-definition policy belongs in
  the later managed-Sandbox proposal.

## Revision history

- **v2 (2026-09-06):** Added explicit command result schemas, native tool-loop
  admission/retry deltas, and submit coordination while commands are active or
  unresolved.
