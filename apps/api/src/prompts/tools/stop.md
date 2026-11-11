Stop background jobs and report how each one ended.

<instruction>
`jobs`: 1 to 16 job locators such as `job://bash-4`, each of a job in this Chat. Every job must exist in this Chat, or the whole call fails with `not_found` and stops nothing. A running job gets a stop request from you, and the call waits up to 5 seconds for all of them to settle. A job that already settled keeps its state.
</instruction>

<output>
JSON: `jobs`, one entry per locator in the input order: `job`, `state` (`running`, `succeeded`, `failed`, `cancelled`, `timed_out`, or `lost`), and `stopped_by` when a stop ended the job. A job that still shows `running` has a recorded stop request and ends once its worker proves the stop; you get a notice when it settles. Do not poll it.
</output>

<critical>
A stop ends the command and every process it started. Only stop work that you or the user no longer need.
</critical>
