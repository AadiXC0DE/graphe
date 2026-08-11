/** Reading a Figma file: the frames as pictures, the variables as values.
 *
 * Two halves that never touch. The pure half — `parseFigmaUrl`, `toTokens`,
 * `describeForModel` — is all of the thinking and none of the network, so the
 * awkward parts (every shape of Figma address, a variables payload where any
 * field may be missing) can be tested exhaustively. The thin half, `createReader`,
 * makes exactly two kinds of request and turns everything that can go wrong into
 * a sentence a designer can act on.
 */

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

/** The parts of a Figma address that are worth anything: which file, and which
 *  frame inside it. */
export type FigmaTarget = { fileKey: string; nodeId: string | null };

/** Every kind of Figma document that has a file key in its address. */
const PLACES = new Set(['file', 'design', 'proto', 'board', 'slides', 'deck']);

/**
 * The file and frame behind a pasted Figma link, or null if it is not one.
 *
 * Node ids travel through addresses with their colon written as a hyphen
 * (`1-23`) or escaped (`1%3A23`); the API only answers to `1:23`, so that is
 * what comes back.
 */
export function parseFigmaUrl(url: string): FigmaTarget | null {
  const text = url.trim();
  if (text === '') return null;

  let address: URL;
  try {
    address = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = address.hostname.toLowerCase();
  if (host !== 'figma.com' && !host.endsWith('.figma.com')) return null;

  const segments = address.pathname.split('/').filter((segment) => segment !== '');
  // A community file sits one level deeper: /community/file/KEY/Name.
  const start = segments[0]?.toLowerCase() === 'community' ? 1 : 0;
  const place = (segments[start] ?? '').toLowerCase();
  if (!PLACES.has(place)) return null;

  const fileKey = segments[start + 1] ?? '';
  if (!/^[\w-]+$/.test(fileKey)) return null;

  return { fileKey, nodeId: normalizeNodeId(address.searchParams.get('node-id')) };
}

/** Figma writes node ids into addresses with every colon turned into a hyphen. */
function normalizeNodeId(raw: string | null): string | null {
  if (raw === null) return null;
  let value = raw.trim();
  if (value === '') return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    // Already decoded, or decoded far enough to read.
  }
  const restored = value.replace(/-/g, ':');
  return /^[A-Za-z]?\d+:\d+(?:;[A-Za-z]?\d+:\d+)*$/.test(restored) ? restored : null;
}

/* -------------------------------------------------------------------------- */
/* What comes back                                                             */
/* -------------------------------------------------------------------------- */

/** One frame, rendered. The image is an address Figma serves for a while. */
export type Frame = { id: string; name: string; image: string };

/** A file's published variables, flattened into values a stylesheet could use.
 *  Numbers arrive as pixels, colours as hex. */
export type TokenSet = {
  colors: Record<string, string>;
  spacing: Record<string, string>;
  text: Record<string, string>;
};

export type FigmaReader = {
  frames(fileKey: string, nodeIds: readonly string[]): Promise<readonly Frame[]>;
  tokens(fileKey: string): Promise<TokenSet>;
};

/* -------------------------------------------------------------------------- */
/* Variables to values                                                         */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Names arrive as Figma groups them — `color/brand/Primary 500` — and leave as
 *  something that can sit in a stylesheet. */
function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

function channel(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function byte(value: number): string {
  return Math.round(value * 255)
    .toString(16)
    .padStart(2, '0');
}

/** Figma keeps colour as four floats between nought and one. Alpha is only
 *  written out when it would change anything. */
function toHex(value: unknown): string | null {
  const color = asRecord(value);
  if (color === null) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  }
  const r = channel(color['r']);
  const g = channel(color['g']);
  const b = channel(color['b']);
  if (r === null || g === null || b === null) return null;
  const alpha = channel(color['a']) ?? 1;
  const base = `#${byte(r)}${byte(g)}${byte(b)}`;
  return alpha >= 1 ? base : `${base}${byte(alpha)}`;
}

/** Names that describe type rather than layout, so a number lands in the right
 *  group. */
const TYPOGRAPHIC = /(^|-)(font|fonts|text|typography|leading|tracking|line|letter|paragraph)(-|$)/;

const ALIAS_HOPS = 5;

type Meta = {
  variables: Map<string, Record<string, unknown>>;
  defaultModes: Map<string, string>;
};

function readMeta(input: unknown): Meta {
  const root = asRecord(input);
  const meta = root === null ? null : (asRecord(root['meta']) ?? root);
  const variables = new Map<string, Record<string, unknown>>();
  const defaultModes = new Map<string, string>();
  if (meta === null) return { variables, defaultModes };

  const raw = meta['variables'];
  const entries: unknown[] = Array.isArray(raw) ? raw : Object.values(asRecord(raw) ?? {});
  for (const [index, entry] of entries.entries()) {
    const variable = asRecord(entry);
    if (variable === null) continue;
    const id = typeof variable['id'] === 'string' ? variable['id'] : `#${String(index)}`;
    variables.set(id, variable);
  }

  const collections = asRecord(meta['variableCollections']) ?? {};
  for (const [id, entry] of Object.entries(collections)) {
    const collection = asRecord(entry);
    const mode = collection?.['defaultModeId'];
    if (typeof mode !== 'string') continue;
    defaultModes.set(id, mode);
    // Some payloads key collections by something other than their own id.
    if (typeof collection?.['id'] === 'string') defaultModes.set(collection['id'], mode);
  }
  return { variables, defaultModes };
}

/** The value a variable holds in its collection's default mode, following an
 *  alias to whatever it points at. */
function valueOf(variable: Record<string, unknown>, meta: Meta, hop = 0): unknown {
  const modes = asRecord(variable['valuesByMode']);
  let value: unknown = modes === null ? variable['value'] : undefined;

  if (modes !== null) {
    const collection = variable['variableCollectionId'];
    const preferred = typeof collection === 'string' ? meta.defaultModes.get(collection) : undefined;
    value =
      preferred !== undefined && preferred in modes ? modes[preferred] : Object.values(modes)[0];
  }

  const alias = asRecord(value);
  if (alias?.['type'] === 'VARIABLE_ALIAS' && typeof alias['id'] === 'string') {
    if (hop >= ALIAS_HOPS) return null;
    const target = meta.variables.get(alias['id']);
    return target === undefined ? null : valueOf(target, meta, hop + 1);
  }
  return value ?? null;
}

function kindOf(variable: Record<string, unknown>, value: unknown): string {
  const declared = variable['resolvedType'] ?? variable['resolvedDataType'] ?? variable['type'];
  if (typeof declared === 'string' && declared !== '') return declared.toUpperCase();
  // Nothing said what it is, so let the value say.
  const color = asRecord(value);
  if (color !== null && typeof color['r'] === 'number') return 'COLOR';
  if (typeof value === 'number') return 'FLOAT';
  if (typeof value === 'string') return 'STRING';
  return '';
}

/**
 * A file's published variables as flat maps of name to value.
 *
 * The payload is deep and every level of it is optional, so nothing here trusts
 * a field to exist. Anything that cannot be read is left out rather than
 * guessed at or thrown over.
 */
export function toTokens(variables: unknown): TokenSet {
  const tokens: TokenSet = { colors: {}, spacing: {}, text: {} };
  const meta = readMeta(variables);

  for (const variable of meta.variables.values()) {
    const rawName = variable['name'];
    if (typeof rawName !== 'string') continue;
    const name = kebab(rawName);
    if (name === '') continue;

    const value = valueOf(variable, meta);
    if (value === null || value === undefined) continue;

    switch (kindOf(variable, value)) {
      case 'COLOR': {
        const hex = toHex(value);
        if (hex !== null) tokens.colors[name] = hex;
        break;
      }
      case 'FLOAT': {
        if (typeof value !== 'number' || !Number.isFinite(value)) break;
        const measurement = `${String(Number(value.toFixed(4)))}px`;
        if (TYPOGRAPHIC.test(name)) tokens.text[name] = measurement;
        else tokens.spacing[name] = measurement;
        break;
      }
      case 'STRING': {
        if (typeof value === 'string' && value.trim() !== '') tokens.text[name] = value.trim();
        break;
      }
      default:
        break;
    }
  }
  return tokens;
}

/* -------------------------------------------------------------------------- */
/* Saying what was read                                                        */
/* -------------------------------------------------------------------------- */

/** Enough of a group to be useful, short of filling a context window with a
 *  design system. */
const LISTED = 40;

function listGroup(title: string, values: Record<string, string>): string[] {
  const names = Object.keys(values);
  if (names.length === 0) return [];
  const shown = names.slice(0, LISTED).map((name) => `- ${name}: ${values[name] ?? ''}`);
  if (names.length > LISTED) {
    shown.push(`- and ${String(names.length - LISTED)} more`);
  }
  return [`${title} (${String(names.length)})`, ...shown];
}

/** The summary handed to the model after a file has been read. */
export function describeForModel(frames: readonly Frame[], tokens: TokenSet): string {
  const lines: string[] = [];

  if (frames.length > 0) {
    lines.push(`Frames read from Figma (${String(frames.length)})`);
    for (const frame of frames) lines.push(`- ${frame.name} [${frame.id}] ${frame.image}`);
  } else {
    lines.push('No frames were read from this file.');
  }

  const groups = [
    ...listGroup('Colours', tokens.colors),
    ...listGroup('Spacing and sizes', tokens.spacing),
    ...listGroup('Type', tokens.text),
  ];
  lines.push('');
  if (groups.length === 0) lines.push('This file publishes no variables I could read.');
  else lines.push(...groups);

  return lines.join('\n').trim();
}

/* -------------------------------------------------------------------------- */
/* The client                                                                  */
/* -------------------------------------------------------------------------- */

const API = 'https://api.figma.com/v1';

/** Frames come back at twice their size, which is what a screen wants and what
 *  a model can still read small type in. */
const IMAGE_SCALE = 2;

/** Every way this can fail, said once. No status codes: a number is not an
 *  explanation, and these sentences are read by the person who pasted the link. */
const SAY = {
  noAccount: 'No Figma account is connected yet, so there is nothing for me to read the file with.',
  unreachable: 'I could not reach Figma. Check the connection and try again.',
  notShared: 'That file is not shared with the account you connected.',
  signedOut: 'The Figma account you connected is not signed in any more. Connect it again and I will try that file.',
  missing: 'I could not find that file in Figma. The link may have changed, or the file may have been moved.',
  tooFast: 'Figma is asking me to slow down. Give it a minute and I will try again.',
  busy: 'Figma is having trouble at the moment. It is worth trying again shortly.',
  refused: 'Figma would not answer that request.',
  unreadable: 'Figma answered with something I could not make sense of.',
  noPictures: 'Figma could not turn those frames into pictures.',
} as const;

function whyRefused(status: number): string {
  if (status === 401) return SAY.signedOut;
  if (status === 403) return SAY.notShared;
  if (status === 404) return SAY.missing;
  if (status === 429) return SAY.tooFast;
  if (status >= 500) return SAY.busy;
  return SAY.refused;
}

export function createReader(options: {
  token: string;
  fetch?: typeof globalThis.fetch;
}): FigmaReader {
  const token = options.token.trim();
  const chosen = options.fetch;
  // Wrapped rather than passed along, so an unbound global fetch cannot object
  // to being called without its own object.
  const send: typeof globalThis.fetch =
    chosen !== undefined ? chosen : (input, init) => globalThis.fetch(input, init);

  async function get(path: string): Promise<unknown> {
    if (token === '') throw new Error(SAY.noAccount);

    let response: Response;
    try {
      response = await send(`${API}${path}`, { headers: { 'X-Figma-Token': token } });
    } catch {
      throw new Error(SAY.unreachable);
    }
    if (!response.ok) throw new Error(whyRefused(response.status));

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new Error(SAY.unreadable);
    }
  }

  /** Frame names live on the file, not on the pictures. A file that will not
   *  give them up costs a nicety, never the frames themselves. */
  async function namesOf(fileKey: string, ids: string): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    try {
      const body = asRecord(await get(`/files/${encodeURIComponent(fileKey)}/nodes?ids=${ids}`));
      const nodes = asRecord(body?.['nodes']) ?? {};
      for (const [id, entry] of Object.entries(nodes)) {
        const name = asRecord(asRecord(entry)?.['document'])?.['name'];
        if (typeof name === 'string' && name.trim() !== '') names.set(id, name.trim());
      }
    } catch {
      // The ids stand in for the names.
    }
    return names;
  }

  return {
    async frames(fileKey: string, nodeIds: readonly string[]): Promise<readonly Frame[]> {
      const wanted = nodeIds.map((id) => id.trim()).filter((id) => id !== '');
      if (fileKey.trim() === '' || wanted.length === 0) return [];

      const ids = wanted.map((id) => encodeURIComponent(id)).join(',');
      const body = asRecord(
        await get(
          `/images/${encodeURIComponent(fileKey)}?ids=${ids}&format=png&scale=${String(IMAGE_SCALE)}`,
        ),
      );
      const complaint = body?.['err'];
      if (typeof complaint === 'string' && complaint.trim() !== '') throw new Error(SAY.noPictures);

      const images = asRecord(body?.['images']);
      if (images === null) throw new Error(SAY.noPictures);

      const names = await namesOf(fileKey, ids);
      const frames: Frame[] = [];
      for (const id of wanted) {
        const image = images[id];
        if (typeof image !== 'string' || image === '') continue;
        frames.push({ id, name: names.get(id) ?? id, image });
      }
      return frames;
    },

    async tokens(fileKey: string): Promise<TokenSet> {
      if (fileKey.trim() === '') return { colors: {}, spacing: {}, text: {} };
      return toTokens(await get(`/files/${encodeURIComponent(fileKey)}/variables/published`));
    },
  };
}
