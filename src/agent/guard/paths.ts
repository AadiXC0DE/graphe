/** Path containment for the Guard.
 *
 * Every check here is pure and lexical. Nothing touches the filesystem: no stat,
 * no realpath, no cwd, no network. That keeps it cheap enough to run on every
 * single tool call and trivial to test.
 *
 * The trade-off is honest: we cannot follow a symlink that already exists on
 * disk, so a link inside the project pointing out of it is invisible to us.
 * That case belongs to the container boundary (notes/strategy/ARCHITECTURE.md, decision 3,
 * layer 2). What we *can* do is refuse to create one, and refuse anything whose
 * destination we cannot work out with confidence.
 *
 * The bias throughout is deliberate: **unsure means outside.** A false "outside"
 * costs the user one extra question. A false "inside" costs them their work.
 */

/** The answer to one question: does this location stay inside the project? */
export type PathCheck = {
  /** True only when we are confident the location stays inside the project. */
  inside: boolean;
  /** The cleaned, resolved location, when we could work one out. */
  resolved: string | null;
  /** Plain-language explanation. Present whenever `inside` is false. */
  reason?: string;
};

const OUTSIDE_PROJECT =
  'This points somewhere outside your project folder, and I only work inside your project.';
const UNRESOLVABLE =
  "I couldn't work out where this would end up, so I treated it as outside your project.";
const SHORTCUT =
  "This location is written as a shortcut I can't check, so I can't be sure it stays inside your project.";
const HOME_FOLDER = 'This points at your home folder rather than your project.';
const NO_ROOT = "I couldn't tell which folder your project lives in, so I stopped.";

/** Nested encoding past this depth is somebody hiding something, not a filename. */
const MAX_DECODE_PASSES = 4;

/** Anything a shell would swap out for something else before touching the disk. */
const SHELL_EXPANSION = /[$`]/;
/** The Windows form of the same idea: %USERPROFILE%, %APPDATA%, %TEMP%. */
const WINDOWS_EXPANSION = /%[A-Za-z_][A-Za-z0-9_]*%/;

/** Windows drive letters. `C:\Users\...` is never inside a project on any OS we ship to. */
const DRIVE_LETTER = /^[A-Za-z]:/;

/** Files that hold keys, passwords and sign-in details. We never read these,
 *  even when they sit inside the project. Secrets go through the named form. */
const CREDENTIAL_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.env.test',
  '.envrc',
  '.npmrc',
  '.yarnrc',
  '.netrc',
  '_netrc',
  '.pgpass',
  '.git-credentials',
  '.htpasswd',
  'credentials',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'known_hosts',
  'authorized_keys',
  'keychain',
  'wallet.dat',
]);

const CREDENTIAL_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.jks',
  '.keystore',
  '.asc',
  '.gpg',
  '.ppk',
]);

/** Folders that only ever hold machine credentials. */
const CREDENTIAL_FOLDERS = new Set([
  '.ssh',
  '.aws',
  '.gnupg',
  '.kube',
  '.docker',
  '.config/gcloud',
  'keychains',
  '.password-store',
]);

/** Windows and shell both accept backslashes; the rest of this file speaks one
 *  separator only. A real file with a backslash in its name is vanishingly rare,
 *  and treating it as a separator is the strict direction. */
export function toPosix(input: string): string {
  return input.replace(/\\/g, '/');
}

export function isAbsolutePath(input: string): boolean {
  return input.startsWith('/') || DRIVE_LETTER.test(input);
}

/** Resolve `.` and `..` without asking the disk anything. */
export function normalizePosixPath(input: string): string {
  const absolute = input.startsWith('/');
  const out: string[] = [];
  for (const segment of input.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  if (absolute) return `/${out.join('/')}`;
  return out.length === 0 ? '.' : out.join('/');
}

/** Where a location would land if the project folder were the starting point. */
export function resolveAgainst(projectRoot: string, candidate: string): string {
  const clean = toPosix(candidate);
  const joined = isAbsolutePath(clean) ? clean : `${toPosix(projectRoot)}/${clean}`;
  return normalizePosixPath(joined);
}

function hasControlCharacters(input: string): boolean {
  for (const character of input) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function hasExpansion(input: string): boolean {
  return SHELL_EXPANSION.test(input) || WINDOWS_EXPANSION.test(input);
}

/** Peel percent-encoding until it stops changing.
 *
 * Catches `%2e%2e%2f`, the double-encoded `%252e%252e%252f`, and overlong UTF-8
 * tricks like `%c0%af` (which fail to decode at all, and so are refused). A
 * filename with a stray `%` in it also gets refused. That is the deliberate
 * direction: one extra question beats a path escape. */
function fullyDecode(input: string): string | null {
  let current = input;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
    if (!current.includes('%')) return current;
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  return null;
}

function within(root: string, target: string): boolean {
  if (root === '/') return target.startsWith('/');
  return target === root || target.startsWith(`${root}/`);
}

/**
 * The one question the Guard asks about every location it is handed.
 *
 * Both the text as written and its decoded form have to land inside the project.
 * Checking both means `assets/my%20photo.png` still works, while `%2e%2e/` does not.
 */
export function containsPath(projectRoot: string, candidate: string): PathCheck {
  const rootText = projectRoot.trim();
  if (rootText === '' || hasExpansion(rootText) || hasControlCharacters(rootText)) {
    return { inside: false, resolved: null, reason: NO_ROOT };
  }
  const root = normalizePosixPath(toPosix(rootText));
  if (!root.startsWith('/')) {
    return { inside: false, resolved: null, reason: NO_ROOT };
  }

  const raw = candidate.trim();
  if (raw === '') return { inside: false, resolved: null, reason: UNRESOLVABLE };
  if (hasControlCharacters(raw)) return { inside: false, resolved: null, reason: UNRESOLVABLE };
  if (raw.startsWith('~')) return { inside: false, resolved: null, reason: HOME_FOLDER };
  if (hasExpansion(raw)) return { inside: false, resolved: null, reason: SHORTCUT };

  const decoded = fullyDecode(raw);
  if (decoded === null) return { inside: false, resolved: null, reason: UNRESOLVABLE };
  if (hasControlCharacters(decoded)) return { inside: false, resolved: null, reason: UNRESOLVABLE };
  if (decoded.trim().startsWith('~')) {
    return { inside: false, resolved: null, reason: HOME_FOLDER };
  }
  if (hasExpansion(decoded)) return { inside: false, resolved: null, reason: SHORTCUT };

  const forms = raw === decoded ? [raw] : [raw, decoded];
  let resolved: string | null = null;
  for (const form of forms) {
    const candidateResolved = resolveAgainst(root, form);
    if (!within(root, candidateResolved)) {
      return { inside: false, resolved: candidateResolved, reason: OUTSIDE_PROJECT };
    }
    resolved = candidateResolved;
  }
  return { inside: true, resolved };
}

export function isInsideProject(projectRoot: string, candidate: string): boolean {
  return containsPath(projectRoot, candidate).inside;
}

/** Is this the project folder itself, rather than something in it? */
export function isProjectRoot(projectRoot: string, candidate: string): boolean {
  const check = containsPath(projectRoot, candidate);
  if (!check.inside || check.resolved === null) return false;
  return check.resolved === normalizePosixPath(toPosix(projectRoot.trim()));
}

/** Does this file hold keys, passwords or sign-in details? */
export function isCredentialPath(candidate: string): boolean {
  const path = toPosix(candidate).toLowerCase();
  const segments = path.split('/').filter((segment) => segment !== '');
  const basename = segments[segments.length - 1] ?? '';

  if (CREDENTIAL_BASENAMES.has(basename)) return true;
  // .env.whatever, however it is suffixed.
  if (basename.startsWith('.env')) return true;
  if (basename.startsWith('id_rsa') || basename.startsWith('id_ed25519')) return true;
  if (basename.includes('serviceaccount') && basename.endsWith('.json')) return true;

  const dot = basename.lastIndexOf('.');
  if (dot > 0 && CREDENTIAL_EXTENSIONS.has(basename.slice(dot))) return true;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] ?? '';
    if (CREDENTIAL_FOLDERS.has(segment)) return true;
    const pair = `${segment}/${segments[index + 1] ?? ''}`;
    if (CREDENTIAL_FOLDERS.has(pair)) return true;
  }
  return false;
}

/** Is this the agent's own folder — the skills, extensions and packages it was
 *  installed with?
 *
 *  Somebody installed those on purpose, and a feature that cannot be read is a
 *  feature that quietly does nothing. The shape is recognised as well as the
 *  folder we are told about, so a caller that never says where its own folder
 *  is still gets the ordinary one. This answers a question about reading:
 *  nothing here grants a write. */
export function isAgentFolder(candidate: string, agentFolder?: string): boolean {
  const path = normalizePosixPath(toPosix(candidate));
  if (!path.startsWith('/')) return false;

  const given = (agentFolder ?? '').trim();
  if (given !== '') {
    const root = normalizePosixPath(toPosix(given));
    if (root.startsWith('/') && root !== '/' && within(root, path)) return true;
  }

  const segments = path.split('/');
  return segments.some((segment, index) => segment === '.pi' && segments[index + 1] === 'agent');
}

/** The one file in that folder that is nobody's instructions: where the
 *  sign-ins are kept. */
export function isSignInStore(candidate: string): boolean {
  const segments = toPosix(candidate).toLowerCase().split('/');
  return (segments[segments.length - 1] ?? '') === 'auth.json';
}

/** The private record a project's history is kept in.
 *
 *  Worth its own answer because in a second copy of a project that record is a
 *  pointer back to the original: a write landing in it reaches straight into the
 *  folder somebody is looking at, while looking for all the world like a write
 *  inside this copy. `.gitignore` and `.github` are ordinary files and do not
 *  match — only the folder itself, or the pointer standing in for it. */
export function isHistoryStore(candidate: string): boolean {
  const path = toPosix(candidate).toLowerCase();
  return path.split('/').some((segment) => segment === '.git');
}

/** Files that end up in the browser, where anyone visiting the site can read them.
 *  Used to decide whether a key in a file is merely private or actually exposed. */
const BROWSER_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.astro',
  '.html',
  '.htm',
  '.css',
  '.json',
]);

/** Folders whose contents run on the user's own machine, not the visitor's. */
const SERVER_MARKERS = ['/api/', '/server/', '/scripts/', '/functions/', '/migrations/', '/db/'];

export function shipsToBrowser(candidate: string): boolean {
  const path = toPosix(candidate).toLowerCase();
  const segments = path.split('/').filter((segment) => segment !== '');
  const basename = segments[segments.length - 1] ?? '';

  // Anything served as-is is readable by anyone, whatever its extension.
  if (segments.includes('public') || segments.includes('static') || segments.includes('dist')) {
    return true;
  }
  if (SERVER_MARKERS.some((marker) => path.includes(marker))) return false;
  if (basename.includes('.server.')) return false;

  const dot = basename.lastIndexOf('.');
  if (dot <= 0) return false;
  return BROWSER_EXTENSIONS.has(basename.slice(dot));
}
