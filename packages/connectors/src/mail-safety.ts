import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Resolver used to check a custom mail server. Injectable so tests never touch the network. */
export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
export const systemResolver: Resolver = host => dnsLookup(host, { all: true, verbatim: true });

const ipv4Parts = (ip: string) => ip.split('.').map(Number);
function blockedV4(ip: string): boolean {
  const [a, b, c] = ipv4Parts(ip);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

/** Eight 16-bit groups of an IPv6 address (handles "::" and a trailing dotted IPv4), or null if it is not valid. */
function groupsV6(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) { const [a, b, c, d] = ipv4Parts(tail[1]); text = `${text.slice(0, -tail[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`; }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [], rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill('0'), ...rest].map(g => parseInt(g, 16));
  return all.length === 8 && all.every(g => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? all : null;
}
function blockedV6(ip: string): boolean {
  const g = groupsV6(ip);
  if (!g) return true;
  const v4 = (hi: number, lo: number) => blockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  if (g.every(x => x === 0) || (g.slice(0, 7).every(x => x === 0) && g[7] === 1)) return true;        // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00) return true; // unique local, link-local, multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                                              // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true;                       // discard
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return v4(g[6], g[7]);                   // IPv4-mapped
  if (g[0] === 0x0064 && g[1] === 0xff9b) return v4(g[6], g[7]);                                     // NAT64
  if (g[0] === 0x2002) return v4(g[1], g[2]);                                                         // 6to4
  return false;
}
/** True only for an address on the public internet. Anything unparsable counts as not public. */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  return version === 4 ? !blockedV4(ip) : version === 6 ? !blockedV6(ip) : false;
}

const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const INTERNAL_SUFFIX = /\.(?:local|localhost|internal|lan|home|corp|intranet|private|arpa|test|invalid|example)$/;
/** A plain public-looking DNS name: no port, path, address literal, single label or internal-only suffix. */
export const isPlausibleMailHost = (host: unknown): host is string => typeof host === 'string' && HOSTNAME.test(host) && !INTERNAL_SUFFIX.test(host);

export class UnsafeMailHost extends Error { constructor(readonly why: 'name' | 'private' | 'unresolved') { super(`Mail server not allowed: ${why}`); } }

/** Resolves a custom mail server and returns an address to connect to. Every address it resolves to must be public. */
export async function resolvePublicMailHost(host: string, resolve: Resolver = systemResolver): Promise<string> {
  const name = typeof host === 'string' ? host.trim().toLowerCase() : '';
  if (!isPlausibleMailHost(name)) throw new UnsafeMailHost('name');
  let found: { address: string; family: number }[];
  try { found = await resolve(name); } catch { throw new UnsafeMailHost('unresolved'); }
  if (!found.length) throw new UnsafeMailHost('unresolved');
  if (found.some(f => !isPublicAddress(f.address))) throw new UnsafeMailHost('private');
  return (found.find(f => f.family === 4) ?? found[0]).address;
}
