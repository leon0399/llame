---
summary: "machine:// locators: files, directories, and shell commands on an operator-configured remote Machine"
read_when:
  - you are passing a machine:// locator to a native tool or as a bash cwd
  - you need to know what a Machine result reports or why a Machine call failed
spec: remote-machines
---

# Machine locators

## Form

A Machine locator is `machine://<name><absolute path>[:selector]`. `<name>` is
the operator's name for one configured Machine (`[a-z0-9-]`, up to 63
characters); the scheme and the name are case-insensitive and are reported in
lowercase. `<absolute path>` is a POSIX path on that Machine, and `[:selector]`
is the ordinary read selector (see [selectors](../selectors.md)), split off
before the path's percent escapes decode once to strict UTF-8 under the
[`file:` alias rules](host-path.md#form). A literal `?`, `#`, or `\`, a C0
control or DEL, `%2F`, and `%00` are refused.

Two forms are listings rather than paths:

| Form                | Addresses                                    |
| ------------------- | -------------------------------------------- |
| `machine://`        | every configured Machine with its status     |
| `machine://<name>`  | that Machine's registered roots, as locators |
| `machine://<name>/` | the absolute path `/` on that Machine        |

A result reports the canonical locator, re-encoding only the characters the
grammar requires (`%`, `#`, `?`, `\`, control characters, and a `:` after the
last separator). The reported locator round-trips: submitting it again
addresses the same file, including a filename that contains `#`.

## Accepted by

`read`, `edit`, and `write` take a locator as their `path`; `bash` takes one as
its `cwd`; `enter_workspace` takes one as its root. A `file:` alias always
addresses the local host, never a Machine.

| Tool              | Locator form        | Mutable |
| ----------------- | ------------------- | ------- |
| `read`            | path, both listings | no      |
| `edit`, `write`   | path only           | yes     |
| `bash`            | `cwd`               | yes     |
| `enter_workspace` | path (a directory)  | no      |

## Authority

A Machine operation runs on the Machine as that Machine's OS user, over the
operator's SSH route, with no sandbox and no sandboxing of the command's
process group. There is no isolation between users of a shared Machine: one
user's files and processes are visible to another's, and hub-held Chat state —
bindings, declarations, attempts, and results — stays owner-scoped as it is for
a local Workspace.

The Machine's registered roots bound addressing only. They are not a security
boundary: the Machine user can change them, and anything running as that user,
including a Machine `bash` command and a Workspace MCP server, can do so. The
SSH destination, any jump host, and every identity are operator-only and never
appear in a result, a listing, or a tool description.

A Machine operation never binds the Run to the local executor, so a worker
without a configured local executor serves Machine locators while a local path
still fails with `executor_unavailable`.

## Behavior

Machine locators behave like the local executor's wherever the same bytes are
involved: the same contents, selectors, listing shape, result bounds, error
types, and media preparation, with every reported path and link target written
as a Machine locator. An image or PDF is read as an attachment exactly as a
local one is, up to the shared media cap.

`edit`, `write`, and Machine `bash` record the durable native attempt before
the request and its one result after, so an interrupted call settles as
`outcome_unknown` and is never replayed automatically; mutations to one Machine
serialize with each other and never block local or Knowledge writes. Every
request carries a relative time budget the Machine measures on its own
monotonic clock and refuses before any effect when it is already spent.

While a Chat is bound to a Machine Workspace, a bare absolute path and an
absolute `bash` `cwd` are that Machine's paths, and a relative path resolves on
the Machine; an omitted `bash` `cwd` runs in the Workspace root on the Machine.
Instruction files, prompt imports, and a Workspace's skills are read from the
Machine, and its Workspace MCP servers run there.

An unreachable Machine does not detach its Workspace: its binding persists and
only operations targeting it fail, with one narrated unavailability and one
recovery. A Machine the operator removed detaches the Workspace as
`executor_absent`.

## Bounds

Reads share the [result bound](../selectors.md#result-bounds) and the
[listing](host-path.md#listing) rules. An image or PDF over 20 MiB,
an image over 40 megapixels, or a PDF over 100 pages fails `media_too_large`;
the same 20 MiB bound applies to the bytes a media read streams. `bash` uses
the local managed bounds.

## Listing

A read of `machine://` lists every configured Machine with its derived status
(`online`, or `offline` with a failure reason) — never an SSH route. A read of
`machine://<name>` lists that Machine's registered roots, each as a
`machine://<name>/…` locator. A Machine directory read lists entries as the
local one does, and a link that points outside the registered roots is not
named.

## Errors

`machine_not_found` for a name the operator did not configure, returned without
opening any connection. `machine_unavailable` for a Machine that could not be
reached, failed host-key or authentication checks, speaks an incompatible
protocol version, or lost its session before a request was sent.
`outcome_unknown` for a mutation or command sent into a session that then
ended: it may have executed, it is not repeated, and the result names nothing
else. `path_not_registered` for any address outside the Machine's registered
roots, with fixed text whether or not the path exists.

`edit` and `write` refuse the two listing forms with `unsupported_operation`
and no effect, and a selector on a mutation is `invalid_selector`. A malformed
locator is `invalid_path`. Every other failure is the shared native vocabulary
in [read](../tools/read.md#errors).

## Configured by

Only the operator can add Machines; without that configuration no Machine
locator resolves, no status is listed, and `machine://` is refused as an
unknown scheme. A Machine is also gated by the `read`, `edit`, `write`, and
`bash` permission groups, which match the canonical locator text; a rule
written against a local path does not admit a Machine address, and a Machine
rule names the Machine it admits.
