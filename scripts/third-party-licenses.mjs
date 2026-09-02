// Generates THIRD-PARTY-LICENSES.md from the dependency tree that actually
// ships inside the application bundle.
//
//   node scripts/third-party-licenses.mjs [--check]
//
// Redistributing somebody's MIT-licensed code obliges us to redistribute their
// copyright notice with it. That is not a formality we can satisfy with a
// hand-written list: the list goes stale the first time a transitive dependency
// changes, and a stale licence file is a compliance problem rather than an
// untidiness one. So this walks the real tree.
//
// ## What "the real tree" means here
//
// The runtime dependencies of package.json, and *their* runtime dependencies,
// resolved the way Node resolves them — walking up through `node_modules`
// folders from each dependent. Not `npm ls --json`, because that reports what
// the lockfile intends and this has to report what is on disk about to be
// copied into a .app. Not every folder under node_modules either, because most
// of those are build tools that never leave this machine.
//
// Optional dependencies count. They are installed, they are packaged, and a
// platform-specific binary nobody on this machine loads is still being
// redistributed.
//
// `--check` writes nothing and fails if the file on disk is out of date, which
// is what CI should run.
//
// ## Why the lockfile fingerprint is in the file
//
// The tree only changes when the lockfile changes, so anything else in here
// changing is noise — and it used to rewrite the date on every package, which
// showed up as a modified file after every release and taught everybody to
// commit it without reading it. The fingerprint of the lockfile it was
// generated from travels in the file; a run whose lockfile still matches writes
// nothing at all. `--force` rebuilds anyway.

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const outFile = join(root, 'THIRD-PARTY-LICENSES.md');
const check = process.argv.includes('--check');
const force = process.argv.includes('--force');

/* -------------------------------------------------------------------------- */
/* Finding packages the way Node finds them                                    */
/* -------------------------------------------------------------------------- */

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Walk up from `fromDir` through `node_modules` folders, the way `require`
 *  does, and return the directory the package was resolved to. Null when it is
 *  not installed — which happens legitimately, for an optional dependency on
 *  another platform. */
async function resolvePackageDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    const manifest = await readJson(join(candidate, 'package.json'));
    if (manifest !== null) return { dir: candidate, manifest };
    const parent = dirname(dir);
    if (parent === dir || !dir.startsWith(root.replace(/\/$/, ''))) return null;
    dir = parent;
  }
}

/* -------------------------------------------------------------------------- */
/* Licences                                                                    */
/* -------------------------------------------------------------------------- */

/** Anything a package might reasonably call its licence text. Matched
 *  case-insensitively, because half of npm writes LICENCE and the other half
 *  writes License.md. */
const LICENCE_FILE = /^(licen[cs]e|copying|notice|unlicen[cs]e)([-.].*)?(\.md|\.txt|\.rst)?$/i;

async function licenceTexts(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isFile() || !LICENCE_FILE.test(entry.name)) continue;
    const text = await readFile(join(dir, entry.name), 'utf8').catch(() => null);
    if (text !== null && text.trim() !== '') found.push({ file: entry.name, text: text.trim() });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

/** The `license` field has had three shapes over npm's life and packages in the
 *  tree still use all of them. */
function declaredLicence(manifest) {
  const one = manifest.license ?? manifest.licence;
  if (typeof one === 'string' && one.trim() !== '') return one.trim();
  if (one && typeof one === 'object' && typeof one.type === 'string') return one.type;
  const many = manifest.licenses;
  if (Array.isArray(many)) {
    const types = many.map((it) => (typeof it === 'string' ? it : it?.type)).filter(Boolean);
    if (types.length > 0) return types.join(' OR ');
  }
  return null;
}

/** A repository field can be a URL, a git+ssh remote, or npm's `github:` short
 *  form. Only an http(s) address is a link anybody can follow, so anything that
 *  cannot be turned into one is dropped rather than printed as a broken one. */
function asWebAddress(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const cleaned = value
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/, '');
  const shorthand = /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(cleaned);
  if (shorthand !== null) return `https://github.com/${shorthand[1]}/${shorthand[2]}`;
  for (const [prefix, replacement] of [
    ['git://', 'https://'],
    ['git+ssh://git@', 'https://'],
    ['ssh://git@', 'https://'],
    ['gitlab:', 'https://gitlab.com/'],
    ['bitbucket:', 'https://bitbucket.org/'],
  ]) {
    if (cleaned.startsWith(prefix)) return replacement + cleaned.slice(prefix.length);
  }
  return cleaned.startsWith('http://') || cleaned.startsWith('https://') ? cleaned : null;
}

function homepageOf(manifest) {
  const repo = manifest.repository;
  return (
    asWebAddress(manifest.homepage) ?? asWebAddress(typeof repo === 'string' ? repo : repo?.url)
  );
}

/* -------------------------------------------------------------------------- */
/* The walk                                                                    */
/* -------------------------------------------------------------------------- */

/** Every runtime package reachable from the root manifest, keyed name@version so
 *  two copies of two versions are both reported and one copy reached twice is
 *  not. */
export async function collect(rootDir = root) {
  const rootManifest = await readJson(join(rootDir, 'package.json'));
  if (rootManifest === null) throw new Error(`No package.json in ${rootDir}`);

  const packages = new Map();
  const queue = Object.keys(rootManifest.dependencies ?? {}).map((name) => ({
    name,
    from: rootDir,
  }));
  const missing = [];

  while (queue.length > 0) {
    const wanted = queue.shift();
    const resolved = await resolvePackageDir(wanted.name, wanted.from);
    if (resolved === null) {
      // Legitimate for an optional dependency built for another platform.
      missing.push(wanted.name);
      continue;
    }

    const { dir, manifest } = resolved;
    const key = `${manifest.name}@${manifest.version}`;
    if (packages.has(key)) continue;

    packages.set(key, {
      name: manifest.name,
      version: manifest.version ?? '0.0.0',
      licence: declaredLicence(manifest),
      homepage: homepageOf(manifest),
      texts: await licenceTexts(dir),
    });

    for (const next of Object.keys({
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {}),
    })) {
      queue.push({ name: next, from: dir });
    }
  }

  return {
    packages: [...packages.values()].sort((a, b) =>
      a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
    ),
    missing: [...new Set(missing)].sort(),
  };
}

/* -------------------------------------------------------------------------- */
/* The file                                                                    */
/* -------------------------------------------------------------------------- */

const PREAMBLE = `# Third-party licences

Every package redistributed inside the Graphe application bundle, with its licence.

**This file is generated.** Run \`npm run licenses\` to rebuild it; packaging runs it for you.
Editing it by hand only means the next release quietly reverts you. The prose introduction to
what we depend on and why lives in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Graphe is not a fork of any of these projects. We depend on them as published packages and have
not modified their source. Their names and marks belong to their respective owners.
`;

/** The lockfile, as one short string. Missing counts as "unknown", which is
 *  never equal to anything and so always rebuilds. */
export async function lockFingerprint(rootDir = root) {
  const text = await readFile(join(rootDir, 'package-lock.json'), 'utf8').catch(() => null);
  if (text === null) return 'unknown';
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** The fingerprint a generated file says it was built from. */
export function fingerprintIn(text) {
  return /^\d+ packages, generated .* from package-lock\.json ([0-9a-f]+|unknown)\.$/m.exec(text)?.[1] ?? null;
}

export function render(collected, at = new Date(), lock = 'unknown') {
  const { packages, missing } = collected;
  const lines = [PREAMBLE];

  lines.push(
    `${packages.length} packages, generated ${at.toISOString().slice(0, 10)} from package-lock.json ${lock}.`,
    '',
    '## Summary',
    '',
    '| Package | Version | Licence |',
    '| --- | --- | --- |',
  );

  for (const one of packages) {
    const name = one.homepage === null ? one.name : `[${one.name}](${one.homepage})`;
    lines.push(`| ${name} | ${one.version} | ${one.licence ?? '— see text below'} |`);
  }

  if (missing.length > 0) {
    lines.push(
      '',
      '## Not installed on this machine',
      '',
      'Optional dependencies for other platforms. They are not in this build, so nothing of theirs',
      'is redistributed by it — listed only so the absence is deliberate rather than a gap.',
      '',
      ...missing.map((name) => `- \`${name}\``),
    );
  }

  lines.push('', '## Licence texts', '');

  for (const one of packages) {
    lines.push(`### ${one.name} ${one.version}`, '');
    if (one.homepage !== null) lines.push(`<${one.homepage}>`, '');
    lines.push(`Licence: ${one.licence ?? 'not declared in package.json'}`, '');
    if (one.texts.length === 0) {
      lines.push(
        '> No licence file is published in this package. The declared licence above is the whole',
        '> of what its author provided.',
        '',
      );
      continue;
    }
    for (const text of one.texts) {
      lines.push('```', text, '```', '');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* -------------------------------------------------------------------------- */

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const lock = await lockFingerprint();
  const existing = await readFile(outFile, 'utf8').catch(() => '');
  const sameTree = fingerprintIn(existing) === lock;

  if (check) {
    if (!sameTree) {
      console.error(
        'THIRD-PARTY-LICENSES.md was generated from a different package-lock.json. Run `npm run licenses` and commit the result.',
      );
      process.exit(1);
    }
    // The fingerprint says the tree; this says the file actually describes it.
    const collected = await collect();
    const undated = (text) => text.replace(/^\d+ packages, generated .*$/m, '');
    if (undated(existing) !== undated(render(collected, new Date(), lock))) {
      console.error(
        'THIRD-PARTY-LICENSES.md is out of date. Run `npm run licenses` and commit the result.',
      );
      process.exit(1);
    }
    console.log(`THIRD-PARTY-LICENSES.md is up to date (${collected.packages.length} packages).`);
    process.exit(0);
  }

  if (sameTree && !force) {
    console.log(`THIRD-PARTY-LICENSES.md already describes package-lock.json ${lock} — nothing to do`);
    process.exit(0);
  }

  const collected = await collect();
  await writeFile(outFile, render(collected, new Date(), lock));
  console.log(`wrote THIRD-PARTY-LICENSES.md — ${collected.packages.length} packages`);

  const undeclared = collected.packages.filter((one) => one.licence === null && one.texts.length === 0);
  if (undeclared.length > 0) {
    console.warn(
      `\n${undeclared.length} package(s) publish no licence at all. Check before releasing:`,
    );
    for (const one of undeclared) console.warn(`  ${one.name}@${one.version}`);
  }
}
