import { isIP } from 'node:net';

/** An IP literal URL host, without IPv6 brackets, or undefined for a name. */
export function hostLiteralAddress(url: URL): string | undefined {
  const hostname = url.hostname;
  const address =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
  const family = isIP(address);
  return family === 4 || family === 6 ? address : undefined;
}

/** The canonical policy text and URL host spelling for one resolved address. */
export type CanonicalAddress = {
  readonly text: string;
  readonly host: string;
};

export function canonicalAddress(address: string): CanonicalAddress {
  const zoneDelimiter = address.indexOf('%');
  const unzoned =
    zoneDelimiter === -1 ? address : address.slice(0, zoneDelimiter);
  if (isIP(unzoned) === 4) return { text: unzoned, host: unzoned };

  const hostname = new URL(`http://[${unzoned}]/`).hostname;
  const text = hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/iu.exec(text);
  if (mapped !== null) {
    const highText = mapped[1];
    const lowText = mapped[2];
    if (highText !== undefined && lowText !== undefined) {
      const high = Number.parseInt(highText, 16);
      const low = Number.parseInt(lowText, 16);
      const ipv4 = [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join('.');
      return { text: ipv4, host: ipv4 };
    }
  }
  return { text, host: hostname };
}

/** Replaces only the request host, leaving its scheme, port, path, and query. */
export function addressLocator(requestUrl: string, address: string): string {
  const request = new URL(requestUrl);
  const host = canonicalAddress(address).host;
  const port = request.port === '' ? '' : `:${request.port}`;
  return `${request.protocol}//${host}${port}${request.pathname}${request.search}`;
}
