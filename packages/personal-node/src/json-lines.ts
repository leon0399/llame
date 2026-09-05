import { CliError } from './errors';

/** Bounded framing before JSON.parse, including split UTF-8 and partial lines. */
export class JsonLines {
  private pending = Buffer.alloc(0);
  constructor(private readonly limit: number, private readonly receive: (value: unknown) => void) {}
  push(chunk: Buffer): void {
    this.pending = Buffer.concat([this.pending, chunk]);
    for (;;) {
      const end = this.pending.indexOf(10);
      if (end < 0) break;
      if (end > this.limit) throw new CliError('protocol_limit', 'Node protocol frame exceeds its byte limit.');
      const line = this.pending.subarray(0, end);
      this.pending = this.pending.subarray(end + 1);
      if (!line.length) continue;
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
      catch { throw new CliError('protocol_json', 'Invalid UTF-8 JSON frame.'); }
      this.receive(value);
    }
    if (this.pending.length > this.limit) throw new CliError('protocol_limit', 'Node protocol frame exceeds its byte limit.');
  }
}
