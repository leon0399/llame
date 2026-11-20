---
status: accepted
---

# A failed send with a started tool call continues and is never sent again

llame starts a tool call as soon as its complete tool-call part streams, while
the send that emitted it is still open. When that send then fails, the Run
waits until each started call settles. It keeps the send's parts through the
last settled tool part and asks the model for the next step. It never sends
the failed request again, for any failure class.

We chose this because a re-send makes the model emit the call a second time,
and the call has often run already. A file written twice, a command run twice,
or an MCP request sent twice cannot be undone by the harness. Continuing
cannot repeat an effect, because the next request carries every result.

The Run also waits for every started call before it fails. An `auth` failure
during a ten-minute build therefore fails the Run only after the build ends.
The failed reply then holds real results instead of `outcome_unknown`, so an
owner Continue resumes from what actually happened.

## Considered options

- Re-send when every started call provably did not run, as oh-my-pi does with
  its `executed: false` results. oh-my-pi starts tools only after a message
  ends, so a broken send there never has a running call. In llame such a send
  is almost always one whose calls the permission policy rejected, and the
  model should see that rejection. One path is simpler to keep correct.
- Cancel the running calls and continue at once. A cancelled `bash` or MCP
  call is `outcome_unknown`, and the model must inspect state that a short
  wait would have reported.
- Fail the Run, the earlier rule. The owner had to press Continue by hand after
  every provider hiccup in a long Run.

## Consequences

- A provider that breaks after each tool call still ends the Run: the next
  step uses the request-retry budget of the failed request.
- A worker restart during the wait follows the shipped redelivery rules, and
  the retry count starts again.
- A model role that fails over to its next candidate continues the same way,
  in a new segment.

This was decided in
[Failing over a request whose stream broke mid-output](https://github.com/leon0399/llame/issues/1777)
and in the grilling for
[continue a Run after a send that broke with started tool calls](https://github.com/leon0399/llame/issues/1828).
