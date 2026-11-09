The owner interrupted your previous step. Your response stopped before it was complete.
{{#if stoppedCalls}}

Stopped calls:{{#each stoppedCalls}}
- `{{this.toolName}}`, call id {{this.callId}}{{/each}}

These calls started and were stopped. Their effects are unknown. Inspect the current state before you repeat one.
{{/if}}
