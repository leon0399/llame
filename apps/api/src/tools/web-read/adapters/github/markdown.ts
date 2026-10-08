/** A fenced code block whose fence outgrows every backtick run in `content`,
 *  so the content can never close it early. */
export function fencedBlock(content: string, info: string | null): string {
  let longest = 0;
  for (const run of content.matchAll(/`+/gu)) {
    longest = Math.max(longest, run[0].length);
  }
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return [`${fence}${info ?? ''}`, content, fence].join('\n');
}
