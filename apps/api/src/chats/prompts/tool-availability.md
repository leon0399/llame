{{#if initial}}Some eligible tools are unavailable for this turn:{{else}}The available tools were changed since the last turn:{{/if}}
{{#if added}}

Added tools:{{#each added}}
- `{{this}}`{{/each}}
{{/if}}
{{#if removed}}

Removed tools:{{#each removed}}
- `{{this}}`{{/each}}
{{/if}}
{{#if unavailable}}

Unavailable tools:{{#each unavailable}}
- `{{this.id}}`: "{{this.label}}"{{/each}}
{{/if}}
{{#if becameUnavailable}}

Became unavailable:{{#each becameUnavailable}}
- `{{this.id}}`: "{{this.label}}"{{/each}}
{{/if}}
{{#if nowAvailable}}

Now available:{{#each nowAvailable}}
- `{{this.id}}`: "{{this.label}}"{{/each}}
{{/if}}

Do not simulate removed or unavailable tools or invent their results.
