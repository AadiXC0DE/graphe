/** What changed, in the vocabulary of design.
 *
 * "Spacing on three cards, from 16 to 24" — not "edited Card.tsx". The reader is
 * a designer, so the nouns are the ones they use: spacing, colour, corners.
 *
 * Pure: text in, sentence out. It reads the declarations either side of an edit
 * and never touches a disk, so the same edit always produces the same words.
 */

/** One changed file's text, before and after. */
export type Edit = {
  file: string;
  before: string;
  after: string;
};

export type ChangeKind = 'spacing' | 'colour' | 'type' | 'radius' | 'shadow' | 'layout';

export type Change = {
  kind: ChangeKind;
  /** The CSS property behind it, kebab-cased. */
  property: string;
  /** Values as a designer reads them: a bare `16` rather than `16px`. */
  from: string;
  to: string;
  /** What the file is about, as a noun: `card`, `button`, `page`. */
  where: string;
  /** How many times this same change happened. */
  count: number;
};

/* ------------------------------------------------------------------ reading */

type Declaration = { property: string; value: string };

/** `property: value` in plain CSS and in an object literal alike.
 *
 *  A value runs to the end of the line, or to the comma that starts the next
 *  declaration — the commas inside `rgba(0, 0, 0, 0.08)` belong to the value. */
const DECLARATION =
  /(?:^|[\s{;,])['"`]?([A-Za-z][A-Za-z0-9-]*)['"`]?\s*:\s*((?:[^;{}\n,]|,(?!\s*['"`]?[A-Za-z-][A-Za-z0-9-]*['"`]?\s*:))+)/g;

const CLASS_ATTRIBUTE = /(?:class|className)\s*=\s*\{?\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;

/** Camel to kebab, so `fontSize` and `font-size` are one property. */
function propertyName(raw: string): string {
  return raw.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Values as they would be said out loud. Pixels lose their unit, colours lose
 *  their capitals, and anything with several parts is left exactly as written. */
function tidyValue(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/[,;]+$/, '')
    .trim()
    .replace(/^['"`]/, '')
    .replace(/['"`]$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^-?\d*\.?\d+px$/i.test(trimmed)) return trimmed.slice(0, -2);
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}

function kindOf(property: string): ChangeKind | null {
  if (/^(padding|margin)(-(top|right|bottom|left|inline|block|inline-start|inline-end))?$/.test(property)) {
    return 'spacing';
  }
  if (/^(gap|row-gap|column-gap)$/.test(property)) return 'spacing';
  if (/^border(-(top|bottom)-(left|right))?-radius$/.test(property)) return 'radius';
  if (property === 'box-shadow') return 'shadow';
  if (/^(color|background|background-color|outline-color)$/.test(property)) return 'colour';
  if (/^border(-(top|right|bottom|left))?-color$/.test(property)) return 'colour';
  if (/^(font-size|font-weight|font-family|line-height|letter-spacing)$/.test(property)) return 'type';
  if (/^(display|position|flex|grid)(-|$)/.test(property)) return 'layout';
  if (/^(justify-content|align-items|align-content|justify-items|place-items)$/.test(property)) {
    return 'layout';
  }
  return null;
}

function declarationsIn(text: string): Declaration[] {
  const found: Declaration[] = [];
  for (const match of text.matchAll(DECLARATION)) {
    const property = propertyName(match[1] ?? '');
    if (kindOf(property) === null) continue;
    const value = tidyValue(match[2] ?? '');
    if (value === '') continue;
    found.push({ property, value });
  }
  return found;
}

/* ---------------------------------------------------------------- Tailwind */

const SIZES = new Set([
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
]);

const WEIGHTS = new Set([
  'thin',
  'extralight',
  'light',
  'normal',
  'medium',
  'semibold',
  'bold',
  'extrabold',
  'black',
]);

const DISPLAYS = new Set([
  'block',
  'inline',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'flex',
  'grid',
  'contents',
  'hidden',
]);

const POSITIONS = new Set(['static', 'fixed', 'absolute', 'relative', 'sticky']);

const SIDES: Readonly<Record<string, string>> = {
  '': '',
  x: '-inline',
  y: '-block',
  t: '-top',
  r: '-right',
  b: '-bottom',
  l: '-left',
};

/** Tailwind's spacing scale is quarters of a rem, which is what a designer sees
 *  in the inspector: `p-4` is 16. */
function spacingValue(raw: string): string {
  const arbitrary = /^\[(.+)\]$/.exec(raw);
  if (arbitrary !== null) return tidyValue((arbitrary[1] ?? '').replace(/_/g, ' '));
  if (raw === 'px') return '1';
  if (/^\d*\.?\d+$/.test(raw)) return String(Number(raw) * 4);
  return raw;
}

function scaleValue(raw: string): string {
  const arbitrary = /^\[(.+)\]$/.exec(raw);
  return arbitrary === null ? raw : tidyValue((arbitrary[1] ?? '').replace(/_/g, ' '));
}

/** One class, as the declaration it stands for. Null for the many classes that
 *  are not a design decision anybody would mention. */
function classAsDeclaration(raw: string): Declaration | null {
  const token = (raw.split(':').pop() ?? '').replace(/^!/, '');
  if (token === '') return null;

  const box = /^(p|m)([xytrbl]?)-(.+)$/.exec(token);
  if (box !== null) {
    const stem = box[1] === 'p' ? 'padding' : 'margin';
    return {
      property: `${stem}${SIDES[box[2] ?? ''] ?? ''}`,
      value: spacingValue(box[3] ?? ''),
    };
  }

  const gap = /^gap(?:-([xy]))?-(.+)$/.exec(token);
  if (gap !== null) return { property: 'gap', value: spacingValue(gap[2] ?? '') };

  const space = /^space-[xy]-(.+)$/.exec(token);
  if (space !== null) return { property: 'gap', value: spacingValue(space[1] ?? '') };

  const text = /^text-(.+)$/.exec(token);
  if (text !== null) {
    const rest = text[1] ?? '';
    if (SIZES.has(rest)) return { property: 'font-size', value: rest };
    if (['left', 'center', 'right', 'justify'].includes(rest)) {
      return { property: 'text-align', value: rest };
    }
    return { property: 'color', value: scaleValue(rest) };
  }

  const font = /^font-(.+)$/.exec(token);
  if (font !== null) {
    const rest = font[1] ?? '';
    if (WEIGHTS.has(rest)) return { property: 'font-weight', value: rest };
    return { property: 'font-family', value: rest };
  }

  const leading = /^leading-(.+)$/.exec(token);
  if (leading !== null) return { property: 'line-height', value: scaleValue(leading[1] ?? '') };

  const tracking = /^tracking-(.+)$/.exec(token);
  if (tracking !== null) return { property: 'letter-spacing', value: tracking[1] ?? '' };

  const background = /^bg-(.+)$/.exec(token);
  if (background !== null) return { property: 'background', value: scaleValue(background[1] ?? '') };

  const border = /^border-(.+)$/.exec(token);
  if (border !== null) {
    const rest = border[1] ?? '';
    // Widths and sides, which are not colours and rarely worth saying.
    if (/^\d+$/.test(rest) || rest === 'px' || /^[trblxyse]$/.test(rest)) return null;
    return { property: 'border-color', value: scaleValue(rest) };
  }

  const rounded = /^rounded(?:-(?:t|r|b|l|tl|tr|br|bl))?(?:-(.+))?$/.exec(token);
  if (rounded !== null) return { property: 'border-radius', value: scaleValue(rounded[1] ?? 'default') };

  const shadow = /^shadow(?:-(.+))?$/.exec(token);
  if (shadow !== null) return { property: 'box-shadow', value: scaleValue(shadow[1] ?? 'default') };

  if (DISPLAYS.has(token)) return { property: 'display', value: token };
  if (POSITIONS.has(token)) return { property: 'position', value: token };

  const flex = /^flex-(.+)$/.exec(token);
  if (flex !== null) return { property: 'flex-direction', value: flex[1] ?? '' };

  const columns = /^grid-cols-(.+)$/.exec(token);
  if (columns !== null) return { property: 'grid-template-columns', value: columns[1] ?? '' };

  const items = /^items-(.+)$/.exec(token);
  if (items !== null) return { property: 'align-items', value: items[1] ?? '' };

  const justify = /^justify-(.+)$/.exec(token);
  if (justify !== null) return { property: 'justify-content', value: justify[1] ?? '' };

  return null;
}

function classListsIn(text: string): string[] {
  const lists: string[] = [];
  for (const match of text.matchAll(CLASS_ATTRIBUTE)) {
    lists.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return lists;
}

function classDeclarations(lists: readonly string[]): Declaration[] {
  const found: Declaration[] = [];
  for (const list of lists) {
    for (const token of list.split(/\s+/)) {
      if (token === '') continue;
      const declaration = classAsDeclaration(token);
      if (declaration !== null && declaration.value !== '') found.push(declaration);
    }
  }
  return found;
}

/* ------------------------------------------------------------------ pairing */

function byProperty(declarations: readonly Declaration[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const one of declarations) {
    const values = grouped.get(one.property);
    if (values === undefined) grouped.set(one.property, [one.value]);
    else values.push(one.value);
  }
  return grouped;
}

/** Same property, same position in the file: one rule, before and after. */
function differences(
  before: readonly Declaration[],
  after: readonly Declaration[],
): { property: string; from: string; to: string }[] {
  const older = byProperty(before);
  const newer = byProperty(after);
  const found: { property: string; from: string; to: string }[] = [];

  for (const [property, values] of newer) {
    const wasValues = older.get(property);
    if (wasValues === undefined) continue;
    const many = Math.min(wasValues.length, values.length);
    for (let at = 0; at < many; at += 1) {
      const from = wasValues[at];
      const to = values[at];
      if (from === undefined || to === undefined || from === to) continue;
      found.push({ property, from, to });
    }
  }

  return found;
}

/* -------------------------------------------------------------------- where */

/** File names that describe the filing rather than the thing. */
const FILING = new Set([
  'index',
  'main',
  'app',
  'style',
  'styles',
  'global',
  'globals',
  'layout',
  'root',
  'theme',
  'tokens',
  'base',
  'common',
  'shared',
  'component',
  'components',
]);

/** What the file is about, as a noun somebody would say: `Card.module.css` is a
 *  card, `ProductCard.tsx` is a card, `styles.css` is the page. */
function nounFor(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  const stem = base
    .replace(/\.[^.]+$/, '')
    .replace(/\.module$/, '')
    .replace(/\.stories$/, '');
  const words = stem
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
  const last = words[words.length - 1];
  if (last === undefined) return 'page';
  return FILING.has(last) ? 'page' : last;
}

/* ------------------------------------------------------------------- the read */

/**
 * Every design change across a set of edits, identical ones grouped and counted.
 *
 * Anything it cannot classify is left out rather than guessed at — a file of
 * prose or a binary produces nothing, which downstream reads as "no design
 * change to describe" and gets an honest sentence instead of a confident one.
 */
export function readChanges(edits: readonly Edit[]): readonly Change[] {
  const grouped = new Map<string, Change>();

  for (const edit of edits) {
    if (edit.before === edit.after) continue;

    const beforeLists = classListsIn(edit.before);
    const afterLists = classListsIn(edit.after);
    const before = declarationsIn(edit.before);
    const after = declarationsIn(edit.after);

    // A bare class list is a file with no attributes and no declarations to
    // confuse it with, so it is safe to read the whole text as classes.
    const bare =
      beforeLists.length === 0 &&
      afterLists.length === 0 &&
      before.length === 0 &&
      after.length === 0;
    const tidy = (text: string): string[] =>
      text.split(/\s+/).map((token) => token.replace(/^[.'"`(]+|[;,'"`)]+$/g, ''));

    const beforeAll = [
      ...before,
      ...classDeclarations(bare ? [tidy(edit.before).join(' ')] : beforeLists),
    ];
    const afterAll = [
      ...after,
      ...classDeclarations(bare ? [tidy(edit.after).join(' ')] : afterLists),
    ];

    const where = nounFor(edit.file);
    for (const one of differences(beforeAll, afterAll)) {
      const kind = kindOf(one.property);
      if (kind === null) continue;
      const key = `${kind}|${one.property}|${one.from}|${one.to}|${where}`;
      const already = grouped.get(key);
      if (already === undefined) {
        grouped.set(key, { kind, property: one.property, from: one.from, to: one.to, where, count: 1 });
      } else {
        already.count += 1;
      }
    }
  }

  return [...grouped.values()];
}

/* --------------------------------------------------------------- the sentence */

const NUMBERS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
] as const;

function counted(many: number): string {
  return NUMBERS[many] ?? String(many);
}

function plural(noun: string): string {
  if (/(s|x|z|ch|sh)$/.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/** The words for the thing that moved. Specific where being specific helps —
 *  "text size" rather than "type" — and general where it does not. */
function nameOf(change: Change): string {
  switch (change.kind) {
    case 'spacing':
      return 'Spacing';
    case 'radius':
      return 'Corners';
    case 'shadow':
      return 'Shadow';
    case 'layout':
      return 'Layout';
    case 'colour':
      if (change.property.startsWith('background')) return 'Background';
      if (change.property.includes('border')) return 'Border colour';
      if (change.property.includes('outline')) return 'Outline colour';
      return 'Colour';
    case 'type':
      switch (change.property) {
        case 'font-size':
          return 'Text size';
        case 'font-weight':
          return 'Weight';
        case 'line-height':
          return 'Line height';
        case 'letter-spacing':
          return 'Letter spacing';
        default:
          return 'Typeface';
      }
  }
}

const RANK: Readonly<Record<ChangeKind, number>> = {
  spacing: 0,
  type: 1,
  colour: 2,
  radius: 3,
  shadow: 4,
  layout: 5,
};

function clauseFor(change: Change): string {
  const place =
    change.count === 1 ? `the ${change.where}` : `${counted(change.count)} ${plural(change.where)}`;
  return `${nameOf(change)} on ${place}, from ${change.from} to ${change.to}`;
}

function midSentence(clause: string): string {
  const first = clause[0];
  const second = clause[1];
  if (first === undefined) return clause;
  if (second !== undefined && first === first.toUpperCase() && second === second.toUpperCase()) {
    return clause;
  }
  return first.toLowerCase() + clause.slice(1);
}

/** When there is nothing we can honestly call a design change. Better than a
 *  confident sentence about the wrong thing. */
export const NOTHING_TO_SAY = 'Nothing here I can put in design words.';

/**
 * The changes as one sentence.
 *
 * Two clauses at most: past that it is a list, and a list is read as a wall
 * rather than as an answer. What is left over is counted rather than dropped,
 * so the sentence never quietly hides half the work.
 */
export function inDesignWords(changes: readonly Change[]): string {
  const ordered = [...changes].sort(
    (one, other) =>
      other.count - one.count ||
      RANK[one.kind] - RANK[other.kind] ||
      one.property.localeCompare(other.property),
  );

  const first = ordered[0];
  if (first === undefined) return NOTHING_TO_SAY;

  const second = ordered[1];
  const said =
    second === undefined
      ? clauseFor(first)
      : `${clauseFor(first)} and ${midSentence(clauseFor(second))}`;

  const left = Math.max(0, ordered.length - 2);
  if (left === 0) return `${said}.`;
  return left === 1 ? `${said}, plus one more change.` : `${said}, plus ${counted(left)} more changes.`;
}
