---
status: accepted
---

# Paths are machine-local, and permission rules match canonical locators

A bare absolute path, a relative path, and a `file:///` URI all refer to the
current Machine. The current Machine is the Machine of the Chat's Workspace,
or the installation's default Machine when no Workspace is bound.
`machine://<name>/...` is the only form that names a particular Machine. Every
tool result and permission decision records that form.

Permission rules match the tool's own parameters after this normalization. A
path rule is therefore written against the canonical locator.
`^machine://[^/]+/opt/secret(/|$)` covers every Machine, and a bare `^/...`
pattern fails at boot.

We chose this because the same text, `/etc/hosts`, names a different file
inside a dev container, on a remote Machine, and on the host. A rule that
matched raw paths would silently widen an allow written for one computer to
every Machine. `file:` follows RFC 8089, where the host that reads a file URI
interprets it. It is no longer a way to reach the API host from a Machine
Workspace.

## Considered options

- Treat a raw-path pattern as a pattern for every Machine. It is shorter, but
  an allow written for a laptop would also admit that path on every
  provisioned and shared Machine without any notice.
- Add an admission-only field that names the Machines a rule covers. We
  rejected it because rules must map one-to-one to tool call parameters.

## Consequences

Every existing path rule is rewritten once in canonical form. A context-rail
reminder tells the model the current Machine whenever it changes and after
each compaction.

This was decided in
[Host Machine naming and stored executor ids](https://github.com/leon0399/llame/issues/1783).
