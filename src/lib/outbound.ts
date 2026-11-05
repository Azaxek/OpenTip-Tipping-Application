import { lookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * Guard for URLs an administrator types in and the server later calls (the Slack/Discord alert webhook).
 * Without it, a mistyped or malicious address could make the server probe its own network or a cloud metadata endpoint
 * (server-side request forgery). Rule: https on the default port, a real public hostname, and EVERY address that name
 * resolves to must be public.
 *
 * Residual risk, accepted and documented in SECURITY.md: the check happens just before the request, so a hostile DNS server
 * could in theory answer differently the second time (DNS rebinding). Only administrators can set this URL.
 */
export class UnsafeUrlError extends Error {}

const v4 = (ip: string): number[] => ip.split('.').map(Number);

/** Expands any valid IPv6 text form into eight 16-bit groups. */
function groupsOfV6(ip: string): number[] {
  let text = ip.split('%')[0]; // drop a zone id such as fe80::1%eth0
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/); // embedded IPv4, e.g. ::ffff:10.0.0.1
  if (tail) {
    const [a, b, c, d] = v4(tail[1]);
    text = `${text.slice(0, -tail[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split('::');
  const left = head ? head.split(':') : [];
  const right = rest === undefined ? [] : rest ? rest.split(':') : [];
  const fill = rest === undefined ? [] : Array(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((h) => Number.parseInt(h || '0', 16));
}

/** True for every address a webhook must never reach: loopback, private, link-local (incl. 169.254.169.254), CGNAT, multicast, reserved, and IPv6 equivalents. */
export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b, c] = v4(ip);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 || // "this" network, private, loopback, multicast + reserved + broadcast
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) // documentation ranges
    );
  }
  if (kind === 6) {
    const g = groupsOfV6(ip);
    if (g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1)) return true; // :: and ::1
    if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return true; // unique-local, link-local, multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPrivateAddress(embedded); // IPv4-mapped (::ffff:10.0.0.1)
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateAddress(embedded); // NAT64
    return false;
  }
  return true; // not an address at all: refuse rather than guess
}

const INTERNAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

type Resolve = (host: string) => Promise<{ address: string }[]>;
const resolveAll: Resolve = (host) => lookup(host, { all: true });

/** Returns the parsed URL if it is safe to call, otherwise throws UnsafeUrlError with a message an administrator can act on. */
export async function assertPublicHttpsUrl(raw: string, resolve: Resolve = resolveAll): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('That is not a valid web address.');
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('The webhook address must start with https://');
  if (url.username || url.password) throw new UnsafeUrlError('Remove the username and password from the address.');
  if (url.port && url.port !== '443') throw new UnsafeUrlError('Use the standard https port (no :port in the address).');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError('That address points inside a private network. Use the public address your chat service gave you.');
    return url;
  }
  if (!host.includes('.') || host === 'localhost' || INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError('That is not a public web address. Use the address your chat service gave you.');
  }
  let addresses: { address: string }[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new UnsafeUrlError('That address could not be found. Check it for typos.');
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError('That address points inside a private network. Use the public address your chat service gave you.');
  }
  return url;
}
