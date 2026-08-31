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
 *  - **Reads are allow-only too, on macOS.** The disk is refused, and then the
 *    places anything at all needs to run are opened again: the loader and the
 *    system libraries, the developer tools, the language runtimes, the folder
 *    the work is in. The rest of the person's home — their other projects,
 *    their mail, another app's saved logins — is not readable, so a command
 *    that has been talked into copying something out has nothing to copy.
 *    Names and dates stay visible everywhere, because a folder cannot be walked
 *    without them.
 *  - **Nothing leaves by default.** `reach: 'secure'` opens outbound 443 and
 *    nothing else — no other port, no listening socket. `Bounds.through` points
 *    it at a single address on this machine instead, which is how the reachable
 *    hosts get filtered by name rather than by port. `reach: 'serving'` is the
 *    exception: a server somebody asked to start gets the ordinary network, the
 *    same as it would from a terminal.
 *
 * Folders travel as `-D` parameters rather than inside the profile text, so a
 * project folder whose name contains a quote or a parenthesis cannot rewrite the
 * rules it is bound by.
 */

import { homedir } from 'node:os';
import { dirname } from 'node:path';

/**
 * What may leave the machine, and what may arrive.
 *
 * `serving` is for a server somebody asked to start: a port on this machine for
 * a browser on this machine to knock on, and the ordinary outbound network its
 * own code needs to answer on it. Nothing on the network outside can reach the
 * port it binds, and it is asked for by name rather than being what every
 * command gets — `secure`, which is what everything else runs under, still
 * leaves by 443 or by the doorway alone.
 */
export type Reach = 'nothing' | 'secure' | 'serving';

export type Bounds = {
  /** The folders work may write into. Everything else on the disk is read-only. */
  writable: readonly string[];
  reach: Reach;
  /** Places holding keys that nothing may read. Defaults to the usual ones. */
  private?: readonly string[];
  /** Folders this run may read on top of the ones every run gets. */
  readable?: readonly string[];
  /** A port on this machine every outbound connection has to go through, so the
   *  addresses it may reach are checked by name. Without one, reach is a port. */
  through?: number;
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
    // Where the other coding tools on this machine keep their saved logins.
    '.codex',
    '.config/opencode',
    '.local/share/opencode',
  ].map((place) => `${home}/${place}`);
}

/**
 * Key-shaped folders anywhere, named relative to a root.
 *
 * Deliberately not `.env`: a project's own code reads it to run, so covering it
 * over would stop the thing being built rather than protect it. The Guard
 * refuses `.env` on the way in, which is the right layer for a file that has to
 * stay readable by the project itself.
 */
export function credentialFoldersIn(root: string): string[] {
  return ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config/gcloud', '.password-store'].map(
    (place) => `${root}/${place}`,
  );
}

/** The parts of the machine that have to be readable for anything to run at
 *  all: the loader, the system libraries, the shells, the developer tools and
 *  the usual places a package manager installs into. All public. */
const SYSTEM_READS = [
  // The loader looks at the root itself before it looks anywhere else.
  '(literal "/")',
  '(subpath "/usr/lib")',
  '(subpath "/usr/libexec")',
  '(subpath "/usr/share")',
  '(subpath "/usr/bin")',
  '(subpath "/usr/sbin")',
  '(subpath "/bin")',
  '(subpath "/sbin")',
  '(subpath "/System")',
  '(subpath "/Library/Frameworks")',
  '(subpath "/Library/Apple")',
  '(subpath "/Library/Preferences")',
  '(subpath "/private/var/db/dyld")',
  '(subpath "/private/var/db/timezone")',
  '(subpath "/private/var/select")',
  '(subpath "/private/etc")',
  '(subpath "/dev")',
  // Compilers, linkers, and the stub commands that go looking for them.
  '(subpath "/Library/Developer")',
  String.raw`(regex #"^/Applications/Xcode[^/]*\.app/")`,
  '(subpath "/opt/homebrew")',
  '(subpath "/opt/local")',
  '(subpath "/usr/local")',
];

/** Where a personal machine keeps language runtimes and the settings the tools
 *  read on the way past. Everything else in the home folder stays shut. */
export function readablePlaces(home = homedir()): string[] {
  return [
    '.nvm',
    '.volta',
    '.asdf',
    '.bun',
    '.deno',
    '.cargo',
    '.rustup',
    '.pyenv',
    '.rbenv',
    '.gradle',
    '.m2',
    '.sdkman',
    'go',
    '.local/bin',
    '.local/lib',
    '.local/share/mise',
    '.local/share/pnpm',
    '.gitconfig',
    '.config/git',
    '.gitignore_global',
  ].map((place) => `${home}/${place}`);
}

/** The folder the running program lives in, so a bound command can start the
 *  same runtime this one is using. Never the root, however it was installed. */
export function programFolder(binary = process.execPath): string | null {
  const near = usableFolder(dirname(binary));
  if (near === null || near === '/') return null;
  const above = usableFolder(dirname(near));
  return above === null || above === '/' ? near : above;
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

/** A path, as a literal in a Seatbelt regex. */
function asRegex(path: string): string {
  return path.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/** The project's own `.env`, at the root or anywhere under it.
 *
 * Read-only and only inside the project: the code being built reads it to run.
 * Denying it made a dev server start and then fail on every request, which
 * reads as the project being broken. The Guard asks before anything writes one,
 * and `.env` anywhere else on the disk stays refused by name below. */
function projectEnvFiles(roots: readonly string[]): string[] {
  return roots.map((root) => `(regex #"^${asRegex(root)}(/[^/]+)*/\\.env($|\\.)")`);
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

/** macOS reaches a few folders through a shortcut, and the kernel matches the
 *  real path. Both spellings are named, so a caller that has not resolved the
 *  one it was handed still gets the folder it asked for. */
function behindTheShortcut(folder: string): string[] {
  return /^\/(var|tmp|etc)(\/|$)/.test(folder) ? [folder, `/private${folder}`] : [folder];
}

/** A port number we are willing to write into a rule, or nothing. */
function doorway(port: number | undefined): number | null {
  if (port === undefined || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

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
  // Keys kept inside the project itself, as well as the ones in a home folder.
  // The Guard already refuses to read either; this is the floor under it, and a
  // repository with an `.aws` in it is exactly where a bypass would look.
  const alsoPrivate = bounds.writable.flatMap((where) => credentialFoldersIn(where));
  for (const folder of [...(bounds.private ?? privatePlaces()), ...alsoPrivate]) {
    const usable = usableFolder(folder);
    if (usable === null || kept.includes(usable)) continue;
    const name = `PRIVATE${String(kept.length)}`;
    kept.push(usable);
    params.push([name, usable]);
  }

  const readable: string[] = [];
  const wanted = [
    ...bounds.writable,
    ...(bounds.readable ?? []),
    ...readablePlaces(),
    programFolder() ?? '',
  ];
  for (const folder of wanted.flatMap(behindTheShortcut)) {
    const usable = usableFolder(folder);
    if (usable === null || usable === '/' || readable.includes(usable)) continue;
    const name = `READ${String(readable.length)}`;
    readable.push(usable);
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
    // Shut the disk, then open the parts that have to be open. What is left out
    // is the part worth taking: the person's other work, and anybody's saved
    // logins.
    '(deny file-read* (subpath "/"))',
    // A folder cannot be walked into without this, and `pwd` cannot answer.
    // Names and dates only — nothing that is in a file.
    '(allow file-read-metadata)',
    `(allow file-read* ${SYSTEM_READS.join(' ')})`,
  ];

  // Both shapes, because some of these are a single settings file rather than
  // a folder and `subpath` does not answer for one.
  const reads = readable
    .map((_, index) => `(subpath (param "READ${String(index)}")) (literal (param "READ${String(index)}"))`)
    .join(' ');
  if (reads !== '') lines.push(`(allow file-read* ${reads})`);

  for (const pattern of PRIVATE_BY_NAME) {
    lines.push(`(deny file-read* (regex #"${pattern}"))`);
  }
  lines.push(`(allow file-read* ${PUBLIC_CERTIFICATES.join(' ')})`);
  // After the deny, so it wins for these and only these — the same order the
  // certificates use.
  const ownEnv = projectEnvFiles(writable);
  if (ownEnv.length > 0) lines.push(`(allow file-read* ${ownEnv.join(' ')})`);
  // Last, so a key in one of these folders is refused whatever it is called.
  for (let index = 0; index < kept.length; index++) {
    lines.push(`(deny file-read* (subpath (param "PRIVATE${String(index)}")))`);
  }

  const writes = writable.map((_, index) => `(subpath (param "WRITE${String(index)}"))`).join(' ');
  lines.push(`(allow file-write* ${writes}${writes === '' ? '' : ' '}${literals(HARMLESS_DEVICES)})`);
  lines.push('(allow file-write-data (literal "/dev/stdout") (literal "/dev/stderr"))');

  if (bounds.reach === 'secure' || bounds.reach === 'serving') {
    const door = doorway(bounds.through);
    if (door !== null) {
      // One door, on this machine, which checks the address by name before it
      // opens. Nothing else is reachable — including the name service, because
      // the door is what does the looking up. Asked for explicitly, so it holds
      // for `serving` too.
      lines.push(`(allow network-outbound (remote ip "localhost:${String(door)}") (remote unix-socket))`);
    } else if (bounds.reach === 'serving') {
      // A development server is the person's own program, started because they
      // asked for it. It talks to a database on 5432, a pooler on 6543, a cache
      // on 6379, a staging API on 8080 — and holding it to 443 keeps the agent
      // from nothing, because the agent already ran this code by starting it.
      // What it does instead is take the project's own database away with no
      // error that points here: pages serve, and sign-in fails. Linux has given
      // it the whole network all along; this is the same answer on macOS.
      lines.push('(allow network-outbound)');
      lines.push('(allow system-socket)');
    } else {
      // Secure addresses and the name lookup they need, and nothing else. Port
      // rather than address is as far as this gets on its own.
      lines.push('(allow network-outbound (remote tcp "*:443") (remote unix-socket))');
      lines.push('(allow system-socket)');
    }
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
  // the only way to refuse a read is to put nothing where the keys were. Keys
  // kept inside the project count here exactly as they do on the other
  // boundary — covering them on one and not the other is a fix that only holds
  // on the machine it was written on.
  const covered = [
    ...(bounds.private ?? privatePlaces()),
    ...bounds.writable.flatMap((where) => credentialFoldersIn(where)),
  ];
  for (const folder of covered) {
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
