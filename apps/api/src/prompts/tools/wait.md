Wait for one or more background jobs to settle.

<instruction>
- Supply 1 to 16 `job://<executor>-<n>` record locators. Do not include an output name.
- `timeout` is an integer number of seconds from 1 to 3600; if omitted, the wait can last up to one hour.
- The wait ends at the first listed job settlement, the timeout, or an interruption. A wait does not stop jobs.
- A `job://` locator must belong to this Chat. Unknown or foreign jobs are not found.
- A result for a running job may promise a notice only while that job remains running.
</instruction>
