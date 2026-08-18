/** The rules the operating system is asked to hold around a command.
 *
 * The Guard reads tool calls. A process that never asks is invisible to it, so
 * anything we spawn gets a second boundary that the kernel enforces rather than
 * this process: on macOS a Seatbelt profile handed to `sandbox-exec`, on Linux a
 * bubblewrap invocation. Both are built here, as pure functions, so what gets
 * applied can be read and tested without applying it.
 *
 * Three shapes, in the order they matter:
 *
 *  - **Writes are allow-only.** Nothing on the disk is writable except the
 *    folders named in `Bounds.writable` — which is the folder the agent was
 *    given, and that may be a copy rather than the project on screen.
 *  - **Reads are open except the private places.** An agent reads the system it
 *    runs on, so a read allowlist would be a list of everything; instead the
 *    places that hold keys are denied outright, matching the Guard's own list.
 *    This is the honest gap against a full read allowlist.
 *  - **Nothing leaves by default.** `reach: 'secure'` opens outbound 443 and
 *    nothing else — no other port, no listening socket.
 *
 * Folders travel as `-D` parameters rather than inside the profile text, so a
 * project folder whose name contains a quote or a parenthesis cannot rewrite the
 * rules it is bound by.
 */

import { homedir } from 'node:os';

/**
 * What may leave the machine, and what may arrive.
 *
 * `serving` is `secure` plus the one thing a development server needs and the
 * boundary otherwise refuses: a port on this machine, which a browser on this
 * machine can knock on. Local only — nothing on the network outside can reach
 * it, and it is asked for by name rather than being what every command gets.
 */
export type Reach = 'nothing' | 'secure' | 'serving';

export type Bounds = {
  /** The folders work may write into. Everything else on the disk is read-only. */
  writable: readonly string[];
  reach: Reach;
  /** Places holding keys that nothing may read. Defaults to the usual ones. */
  private?: readonly string[];
};

/** A profile and the folder values it refers to by name. */
export type Profile = {
  text: string;
  /** `-D NAME=value` pairs, in the order they are handed over. */
  params: readonly (readonly [string, string])[];
};

/** Where keys live on a personal machine. The same places the Guard refuses to
 *  open, refused again a layer down. */
export function privatePlaces(home = homedir()): string[] {
  return [
    '.ssh',
    '.aws',
    '.gnupg',
    '.kube',
    '.docker',
    '.config/gcloud',
    '.password-store',
    'Library/Keychains',
  ].map((place) => `${home}/${place}`);
}

/** A folder we are willing to name in a profile: absolute, and nothing in it
 *  that a path is not allowed to contain. */
export function usableFolder(candidate: string): string | null {
  const folder = candidate.trim();
  if (folder === '' || !folder.startsWith('/')) return null;
  for (const character of folder) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
  }
  const clean = folder.replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

/** Files that are keys wherever they sit, including inside the project. */
const PRIVATE_BY_NAME = [
  String.raw`/\.env($|\.)`,
  String.raw`/\.netrc$`,
  String.raw`/\.npmrc$`,
  String.raw`/id_(rsa|dsa|ecdsa|ed25519)($|\.)`,
  String.raw`\.(pem|key|p12|pfx|jks|keystore|asc|gpg|ppk)$`,
];

/** The certificate bundles every secure connection is checked against. They are
 *  public, they are named like keys, and without them nothing can reach an
 *  address over https — which fails as a network problem and reads as one. */
const PUBLIC_CERTIFICATES = [
  '(regex #"/(cacert|cert|ca-bundle|ca-certificates|cert-bundle)\\.(pem|crt)$")',
  '(subpath "/etc/ssl")',
  '(subpath "/private/etc/ssl")',
];

/** Character devices a program expects to exist and cannot hurt anyone with. */
const HARMLESS_DEVICES = ['/dev/null', '/dev/zero', '/dev/random', '/dev/urandom', '/dev/dtracehelper', '/dev/tty'];

function literals(paths: readonly string[]): string {
  return paths.map((path) => `(literal "${path}")`).join(' ');
}

/**
 * The Seatbelt profile for one run.
 *
 * Last rule wins in this language, so every `deny` sits after the `allow` it
 * carves out of.
 */
export function seatbeltProfile(bounds: Bounds): Profile {
  const params: (readonly [string, string])[] = [];
  const writable: string[] = [];
  for (const folder of bounds.writable) {
    const usable = usableFolder(folder);
    if (usable === null || writable.includes(usable)) continue;
    const name = `WRITE${String(writable.length)}`;
    writable.push(usable);
    params.push([name, usable]);
  }

  const kept: string[] = [];
  for (const folder of bounds.private ?? privatePlaces()) {
    const usable = usableFolder(folder);
    if (usable === null || kept.includes(usable)) continue;
    const name = `PRIVATE${String(kept.length)}`;
    kept.push(usable);
    params.push([name, usable]);
  }

  const lines = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow signal (target self))',
    '(allow file-read*)',
  ];

  for (const pattern of PRIVATE_BY_NAME) {
    lines.push(`(deny file-read* (regex #"${pattern}"))`);
  }
  lines.push(`(allow file-read* ${PUBLIC_CERTIFICATES.join(' ')})`);
  // Last, so a key in one of these folders is refused whatever it is called.
  for (let index = 0; index < kept.length; index++) {
    lines.push(`(deny file-read* (subpath (param "PRIVATE${String(index)}")))`);
  }

  const writes = writable.map((_, index) => `(subpath (param "WRITE${String(index)}"))`).join(' ');
  lines.push(`(allow file-write* ${writes}${writes === '' ? '' : ' '}${literals(HARMLESS_DEVICES)})`);
  lines.push('(allow file-write-data (literal "/dev/stdout") (literal "/dev/stderr"))');

  if (bounds.reach === 'secure' || bounds.reach === 'serving') {
    // Secure addresses and the name lookup they need, and nothing else. Port
    // rather than address is as far as this goes without a proxy in the middle.
    lines.push('(allow network-outbound (remote tcp "*:443") (remote unix-socket))');
    lines.push('(allow system-socket)');
  }

  if (bounds.reach === 'serving') {
    // A port here, reachable from here. Everything a development server is for,
    // and nothing an outside machine can use: `localhost` is the whole filter,
    // so a bind to 0.0.0.0 — the one that would put it on the network — is
    // refused by the kernel rather than by us noticing afterwards.
    lines.push('(allow network-bind (local ip "localhost:*"))');
    lines.push('(allow network-inbound (local ip "localhost:*"))');
    // Servers talk to each other: a front end to its own API, an API to a
    // database already running here.
    lines.push('(allow network-outbound (remote ip "localhost:*"))');
  }

  return { text: `${lines.join('\n')}\n`, params };
}

/** The arguments that put a command inside bubblewrap. */
export function bubblewrapArgs(
  bounds: Bounds,
  command: string,
  commandArgs: readonly string[],
): string[] {
  const args = [
    '--die-with-parent',
    '--new-session',
    '--unshare-ipc',
    '--unshare-uts',
    '--ro-bind',
    '/',
    '/',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/tmp',
  ];

  const seen: string[] = [];
  for (const folder of bounds.writable) {
    const usable = usableFolder(folder);
    if (usable === null || seen.includes(usable)) continue;
    seen.push(usable);
    args.push('--bind', usable, usable);
  }

  // An empty folder over each private one: bubblewrap has no read denial, so
  // the only way to refuse a read is to put nothing where the keys were.
  for (const folder of bounds.private ?? privatePlaces()) {
    const usable = usableFolder(folder);
    if (usable === null) continue;
    args.push('--tmpfs', usable);
  }

  // All or nothing here. Without a proxy there is no port filter to apply, so
  // `secure` on Linux is the whole network — see the note in this folder.
  if (bounds.reach === 'nothing') args.push('--unshare-net');

  args.push('--', command, ...commandArgs);
  return args;
}
