{{#each rows}}{{#each lines}}{{#if @first}}{{#if ../user}}User{{else}}Assistant{{/if}}: {{this}}{{else}}
  {{this}}{{/if}}{{/each}}{{#unless @last}}
{{/unless}}{{/each}}