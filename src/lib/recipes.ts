/** Recipes — the sentences somebody can send without typing them again.
 *
 * Pure data and parsing. The shell reads the markdown files off disk; this
 * decides what each one is called, which ones survive to the row of buttons
 * under the composer, and which of them arrived with the folder rather than
 * from the person sitting there.
 */

export type Recipe = {
  id: string;
  name: string;
  prompt: string;
  /** Ours, or something the user wrote. Shown differently, and never merged
   *  as if they were the same thing. */
  from: 'graphe' | 'yours';
};

/**
 * The set we ship with.
 *
 * Written at the size and register of the examples on the first screen: a real
 * request somebody would send, not a demonstration of a feature. The name is
 * what fits on a button; the prompt is the whole sentence, and pressing one
 * puts it in the box rather than sending it.
 */
export const STARTERS: readonly Recipe[] = [
  {
    id: 'phone',
    name: 'Make it work on a phone',
    prompt:
      'Go through this page at phone width and fix what breaks — anything overflowing, text that has gone too small to read, and controls sitting too close together to tap.',
    from: 'graphe',
  },
  {
    id: 'contrast',
    name: 'Check the contrast',
    prompt:
      'Check the text on this page against what sits behind it, and tell me which pairs are too faint to read comfortably before changing anything.',
    from: 'graphe',
  },
  {
    id: 'brand-colours',
    name: 'Match my brand colours',
    prompt:
      'Replace the one-off colours on this page with the ones from our palette, and tell me about anything that has no equivalent rather than guessing at it.',
    from: 'graphe',
  },
  {
    id: 'spacing',
    name: 'Tidy the spacing',
    prompt:
      'Find everything on this page that sits off our spacing scale and bring it back onto the nearest step.',
    from: 'graphe',
  },
  {
    id: 'states',
    name: 'Fill in the missing states',
    prompt:
      'Give every button, link and field on this page the hover, focus and disabled treatment the rest of the work already has.',
    from: 'graphe',
  },
  {
    id: 'type-scale',
    name: 'Put the type on one scale',
    prompt:
      'Pull the headings and body text on this page onto a single type scale, and show me what changed size.',
    from: 'graphe',
  },
];

/* ------------------------------------------------------------ reading a file */

type Front = { name?: string; description?: string; body: string };

/** Frontmatter is a fenced block at the very top or it is not frontmatter at
 *  all — an unclosed fence is read as ordinary text rather than swallowing the
 *  file. Values are read line by line: nothing here is a YAML parser. */
function frontmatter(contents: string): Front {
  const text = contents.replace(/^\uFEFF/, '');
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const block = match?.[1];
  if (match === null || block === undefined) return { body: text };

  const front: Front = { body: text.slice(match[0].length) };
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = unquote(trimmed.slice(colon + 1).trim());
    if (value === '') continue;
    if (key === 'name') front.name = value;
    else if (key === 'description') front.description = value;
  }
  return front;
}

function unquote(value: string): string {
  const first = value[0];
  if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function stem(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  return base.replace(/\.md$/i, '');
}

/** `check-the-contrast` reads as "Check the contrast". Only the first letter is
 *  touched, and not even that when the word carries its own capitals — `iOS`
 *  should not come back as `IOS`. */
function sentenceCase(slug: string): string {
  const joined = slug
    .split(/[-_\s]+/)
    .filter((word) => word !== '')
    .join(' ');
  const first = joined[0];
  const second = joined[1];
  if (first === undefined) return '';
  if (second !== undefined && second !== second.toLowerCase()) return joined;
  return first.toUpperCase() + joined.slice(1);
}

function firstLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.replace(/^\s*#+\s*/, '').trim();
    if (trimmed !== '') return trimmed;
  }
  return '';
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'recipe' : slug;
}

/**
 * One of pi's prompt-template files, read as a recipe.
 *
 * The name comes from the frontmatter when there is one, then the filename,
 * then the opening line — a button has to say something, and the filename is
 * the only part of a template every file is guaranteed to have. A file with
 * nothing to send is not a recipe, so it comes back null.
 */
export function parseTemplate(filename: string, contents: string): Recipe | null {
  const front = frontmatter(contents);
  const prompt = front.body.trim();
  if (prompt === '') return null;

  const slug = stem(filename);
  const name = front.name ?? front.description ?? orElse(sentenceCase(slug), firstLine(prompt));
  if (name === '') return null;

  // Namespaced so a file called `contrast.md` cannot collide with ours in a
  // list the window keys by id.
  return { id: `yours:${slug === '' ? slugify(name) : slug}`, name, prompt, from: 'yours' };
}

function orElse(value: string, fallback: string): string {
  return value === '' ? fallback : value;
}

/* -------------------------------------------------------------- the short row */

/** These are buttons under a composer, not a menu. Past eight they stop being
 *  a shortcut and become something else to read. */
const MOST_WE_SHOW = 8;

function sameName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The user's own first, then ours, with anything they have named themselves
 * winning over the starter of the same name — someone who wrote their own
 * "check the contrast" meant theirs.
 */
export function merge(
  mine: readonly Recipe[],
  starters: readonly Recipe[] = STARTERS,
): readonly Recipe[] {
  const kept: Recipe[] = [];
  const seen = new Set<string>();
  for (const recipe of [...mine, ...starters]) {
    const key = sameName(recipe.name);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    kept.push(recipe);
    if (kept.length === MOST_WE_SHOW) break;
  }
  return kept;
}

/* ------------------------------------------------------------ what to look at */

/** Where a recipe or a skill was found. */
export type Untrusted = { name: string; where: 'project' | 'home' };

/**
 * The ones worth a look before they are used.
 *
 * A file in the user's own home directory is something they put there. A file
 * inside the folder they opened arrived with that folder — it can be written by
 * whoever sent the work over, and it is read as instructions all the same.
 */
export function needsReview(sources: readonly Untrusted[]): readonly Untrusted[] {
  return sources.filter((source) => source.where === 'project');
}

/** The one line shown above them. Null when there is nothing to say. */
export function reviewWarning(sources: readonly Untrusted[]): string | null {
  const review = needsReview(sources);
  const only = review[0];
  if (only === undefined) return null;
  if (review.length === 1) {
    return `“${only.name}” came with the folder you opened rather than from you. Worth a read before you use it.`;
  }
  return 'Some of these came with the folder you opened rather than from you. Worth a read before you use them.';
}
