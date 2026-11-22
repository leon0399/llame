---
status: accepted
---

# The host Machine serves only its registered roots

The host Machine daemon refuses a path outside its registered roots with
`path_not_registered`, as every other Machine daemon does. Before this change,
the in-process host executor could reach every path that the worker's OS user
could read. After the cutover, an operator who wants that reach registers `/`
with `llame-machine roots add /`.

We chose this because the host is now an ordinary Machine. A host that
skipped the root check would make every tool, instruction-file walk, and
permission rule handle two kinds of Machine. Registered roots bound addressing
only. They are not a Sandbox, and the same OS user can change them.

## Considered options

- Pass roots from the llame configuration to the local daemon child. We
  rejected it because the daemon would then have two sources of roots, and
  remote entries would expect the same field.
- Start the host daemon child with `/` as its only root. We rejected it
  because the host would behave differently from every other Machine, which
  undoes the one Machine contract.

## Consequences

Each cutover layer names the host calls that start to fail with
`path_not_registered`. Instruction files on the host load from the registered
root that contains the touched directory, not from the filesystem root.

This was decided in the grilling session for
[feat(machines): the host as a Machine](https://github.com/leon0399/llame/issues/1831)
and is specified in the OpenSpec change
[host-as-machine](../../openspec/changes/host-as-machine/proposal.md).
