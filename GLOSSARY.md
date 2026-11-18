# llame glossary

The domain language of llame's Chats and Runs. Terms here are definitions,
not behavior: OpenSpec owns what each one does.

## Language

**Run**:
One durable execution of a Chat's assistant, from admission to a terminal
state. A Run may produce several Replies.
_Avoid_: job, task, turn

**Segment**:
The part of a Run that produces one Reply, served by one model. A Segment
starts when the Run starts or at a Segment boundary: a delivery into the Run
or, once model failover ships, a model switch.
_Avoid_: step, attempt

**Reply**:
The assistant message that one Segment produces.
_Avoid_: response, answer
