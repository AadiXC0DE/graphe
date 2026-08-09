/** Working out what kind of project this is, and how to make it.
 *
 * Pure, and separate from everything that touches a disk, because the awkward
 * part of "See it" is not running a command — it is deciding *which* command,
 * and being willing to say "I do not know" instead of guessing. A guess here
 * opens the wrong thing, or opens nothing, and the person on the other end has
 * no way to tell which.
 *
 * ## The one rule that is not ours to relax
 *
 * notes/strategy/SHARING.md §1: we serve what the project makes, never the
 * thing a developer runs while they are working. That thing has had a filesystem
 * escape roughly every other month since March 2025 — eight CVEs and counting,
 * one of them in CISA's exploited-in-the-wild catalogue — and every one of them
 * reads files the designer never meant to hand out. Nothing in this module may
 * ever return a way to start one, which is why there is no `dev` anywhere below.
 *
 * ## Asking beats guessing
 *
 * `unsure` is a first-class answer. A folder we cannot read the shape of gets a
 * question in the conversation, in the same voice as everything else, and the
 * person answers it in one sentence. That is a much better minute than watching
 * a blank window and wondering whose fault it is.
 */

/** What a `package.json` tells us, as far as we care. */
export type Manifest = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** A glance at the folder. Everything the decision below is allowed to use. */
export type Look = {
  /** Names of the things at the top level of the folder. */
  entries: readonly string[];
  /** The parsed manifest, or null when there is not one (or it is unreadable). */
  manifest: Manifest | null;
};

/** Which tool the folder is set up for. Read from the lock file rather than
 *  asked about — the file is right there and the designer has no idea. */
export type Helper = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type Recipe =
  /** Nothing to make. The folder is the thing to open. */
  | { kind: 'as-is' }
  /** Make it first, then look for what it made in one of `outputs`, in order. */
  | {
      kind: 'make';
      helper: Helper;
      /** The named piece of the manifest that makes the site. */
      script: string;
      /** True when the pieces it needs have not been fetched yet. */
      needsPieces: boolean;
      outputs: readonly string[];
    }
  /** We could not tell. Ask, in these words. */
  | { kind: 'unsure'; question: string };

/** Where each family of project leaves what it made. Ordered: the first one that
 *  exists and has a page in it wins. */
const WHERE_IT_LANDS: readonly { when: string; outputs: readonly string[] }[] = [
  { when: 'next', outputs: ['out', 'dist'] },
  { when: 'nuxt', outputs: ['.output/public', 'dist'] },
  { when: '@sveltejs/kit', outputs: ['build', '.svelte-kit/output/client'] },
  { when: 'gatsby', outputs: ['public'] },
  { when: '@11ty/eleventy', outputs: ['_site'] },
  { when: 'astro', outputs: ['dist'] },
  { when: 'vite', outputs: ['dist'] },
  { when: 'parcel', outputs: ['dist'] },
  { when: 'webpack', outputs: ['dist', 'build'] },
  { when: 'react-scripts', outputs: ['build'] },
];

/** Tried in order when nothing above matched. Broad on purpose: this list is
 *  only consulted after something has actually been made, so a folder on it that
 *  does not exist costs nothing. */
const COMMON_OUTPUTS = ['dist', 'build', 'out', '_site', 'public', 'www'] as const;

/** The names a manifest might give the thing that makes the site. In order of
 *  how likely they are to be the whole job rather than one step of it. */
const MAKING_SCRIPTS = ['build', 'generate', 'export', 'compile'] as const;

const LOCK_FILES: readonly { file: string; helper: Helper }[] = [
  { file: 'pnpm-lock.yaml', helper: 'pnpm' },
  { file: 'yarn.lock', helper: 'yarn' },
  { file: 'bun.lockb', helper: 'bun' },
  { file: 'bun.lock', helper: 'bun' },
  { file: 'package-lock.json', helper: 'npm' },
];

/** Pages a folder can be opened at, in the order a browser would look. */
const OPENABLE = ['index.html', 'index.htm'] as const;

const NOTHING_TO_OPEN =
  'I had a look in that folder and I could not find a page to open, or anything that would make one. If it is somewhere else in there, tell me which folder to look in and I will start from there.';

const NOTHING_TO_MAKE_IT_WITH =
  'That folder looks like a project, but nothing in it says how to make the finished site. Tell me how you normally get it ready to look at, and I will do that from now on.';

export function helperFor(look: Look): Helper {
  const found = LOCK_FILES.find((lock) => look.entries.includes(lock.file));
  return found?.helper ?? 'npm';
}

/** Everything the manifest depends on, in one bag. Which side of the manifest a
 *  framework is listed on is a developer's distinction and not a real one. */
function dependenciesOf(manifest: Manifest | null): Set<string> {
  return new Set([
    ...Object.keys(manifest?.dependencies ?? {}),
    ...Object.keys(manifest?.devDependencies ?? {}),
  ]);
}

/** Where this project's family is known to leave what it makes, then the usual
 *  places. Never empty, so the caller always has somewhere to look. */
export function likelyOutputs(manifest: Manifest | null): readonly string[] {
  const depends = dependenciesOf(manifest);
  const known = WHERE_IT_LANDS.filter((one) => depends.has(one.when)).flatMap(
    (one) => one.outputs,
  );
  return [...new Set([...known, ...COMMON_OUTPUTS])];
}

/**
 * What to do with this folder.
 *
 * The order matters. A folder with a manifest is treated as a project even when
 * it also has a page at the top level, because the page at the top level of a
 * project is usually a template with nothing filled in — opening that would show
 * the designer an empty shell of their own site and let them believe it.
 */
export function readTheFolder(look: Look): Recipe {
  const hasPage = OPENABLE.some((page) => look.entries.includes(page));

  if (look.manifest === null) {
    return hasPage ? { kind: 'as-is' } : { kind: 'unsure', question: NOTHING_TO_OPEN };
  }

  const scripts = look.manifest.scripts ?? {};
  const script = MAKING_SCRIPTS.find((name) => typeof scripts[name] === 'string' && scripts[name]);

  if (script === undefined) {
    // A manifest with no way to make anything. If there is a page sitting there
    // it is very likely a hand-written site that happens to list a tool or two,
    // so open it; otherwise say so rather than run something at random.
    return hasPage ? { kind: 'as-is' } : { kind: 'unsure', question: NOTHING_TO_MAKE_IT_WITH };
  }

  return {
    kind: 'make',
    helper: helperFor(look),
    script,
    needsPieces: !look.entries.includes('node_modules'),
    outputs: likelyOutputs(look.manifest),
  };
}

/** Said when the project made something we cannot find. Not a failure of theirs
 *  and not phrased as one. */
export const COULD_NOT_FIND_IT =
  'I got your project ready, but I could not find the finished pages afterwards. Tell me which folder they end up in and I will look there next time.';
