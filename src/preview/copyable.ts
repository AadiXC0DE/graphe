/** The second thing a click can give you: the element, ready to paste.
 *
 * Pointing already resolves a click to a name and a place. This takes the same
 * element and hands back its markup and the rules that describe it, tidied to
 * the state a person would have written them in.
 *
 * Nothing we put on the page comes back out. A designer pasting into a file or
 * a message must never find our marks in what they pasted.
 *
 * No browser here: the caller hands over the markup and the resolved values as
 * plain data, which is what makes the tidying testable.
 */

/** Property → value, as the browser resolved them. */
export type StyleValues = Readonly<Record<string, string>>;

export type ElementSource = {
  /** The element's own markup, exactly as the page holds it. */
  html: string;
  /** What the browser worked the values out to be. */
  styles?: StyleValues;
  /** What to call the rule. Left off, taken from the element itself. */
  selector?: string;
};

export type Copyable = {
  /** Re-indented markup, with everything of ours taken out. */
  markup: string;
  /** One rule, or an empty string when there was nothing worth saying. */
  styles: string;
  /** What the selector ended up being. */
  selector: string;
  /** Both, in the order you would paste them. */
  text: string;
};

export type TidyOptions = {
  /** Spaces per level. */
  indent?: number;
};

/**
 * The values worth carrying across.
 *
 * Everything a browser resolves is hundreds of properties, nearly all of them
 * inherited defaults; pasting that is worse than pasting nothing. This is the
 * list the injected script asks for and the order the rule is written in.
 */
export const WORTH_COPYING: readonly string[] = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'gap',
  'flex',
  'order',
  'grid-template-columns',
  'grid-template-rows',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'aspect-ratio',
  'box-sizing',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'background-color',
  'background-image',
  'box-shadow',
  'opacity',
  'overflow',
  'object-fit',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration',
  'white-space',
  'color',
  'cursor',
  'transform',
  'transition',
];

/** Values that say nothing. Written out, they are noise in the paste. */
const DULL: Readonly<Record<string, string>> = {
  position: 'static',
  'z-index': 'auto',
  'flex-direction': 'row',
  'flex-wrap': 'nowrap',
  'justify-content': 'normal',
  'align-items': 'normal',
  gap: 'normal',
  order: '0',
  'min-width': '0px',
  'min-height': '0px',
  'max-width': 'none',
  'max-height': 'none',
  'aspect-ratio': 'auto',
  'margin-top': '0px',
  'margin-right': '0px',
  'margin-bottom': '0px',
  'margin-left': '0px',
  'padding-top': '0px',
  'padding-right': '0px',
  'padding-bottom': '0px',
  'padding-left': '0px',
  'border-width': '0px',
  'border-style': 'none',
  'border-radius': '0px',
  'background-color': 'rgba(0, 0, 0, 0)',
  'background-image': 'none',
  'box-shadow': 'none',
  opacity: '1',
  overflow: 'visible',
  'object-fit': 'fill',
  'font-style': 'normal',
  'line-height': 'normal',
  'letter-spacing': 'normal',
  'text-transform': 'none',
  'text-decoration': 'none',
  'white-space': 'normal',
  cursor: 'auto',
  transform: 'none',
  transition: 'all 0s ease 0s',
};

const VOID: readonly string[] = [
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source',
  'track', 'wbr',
];

/** Contents that are text rather than markup. */
const RAW: readonly string[] = ['script', 'style', 'textarea', 'title'];

/** Where the spacing is the content. Left exactly as it was found. */
const KEEPS_SPACE: readonly string[] = ['pre', 'textarea'];

/** Short enough to read on one line with its tags around it. */
const ONE_LINE_MAX = 96;

/** Usable in a selector without escaping. */
const PLAIN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Names a build tool invented, which mean nothing tomorrow. */
const MADE_UP = /^(?:css|sc|emotion|jsx|svelte|styled|hash)[-_]|[0-9].*[0-9].*[0-9]/;

type Attr = { name: string; value: string | null };

type Element = {
  kind: 'element';
  tag: string;
  attrs: Attr[];
  children: Node[];
  empty: boolean;
  /** Contents of a script or a style, held as written. */
  raw: string | null;
};

type Node = Element | { kind: 'text'; text: string } | { kind: 'comment'; text: string };

/* ------------------------------------------------------------------ reading */

function isSpace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
}

type TagRead = { tag: string; attrs: Attr[]; closed: boolean; at: number };

/** From just after the `<`. Never throws: an unterminated tag ends the input. */
function readTag(html: string, from: number): TagRead {
  let at = from;
  let name = '';
  while (at < html.length && !isSpace(html[at] ?? '') && html[at] !== '>' && html[at] !== '/') {
    name += html[at];
    at += 1;
  }

  const attrs: Attr[] = [];
  let closed = false;

  while (at < html.length) {
    while (at < html.length && isSpace(html[at] ?? '')) at += 1;
    const char = html[at];
    if (char === undefined) break;
    if (char === '>') {
      at += 1;
      break;
    }
    if (char === '/') {
      closed = true;
      at += 1;
      continue;
    }

    let attr = '';
    while (
      at < html.length &&
      !isSpace(html[at] ?? '') &&
      html[at] !== '=' &&
      html[at] !== '>' &&
      html[at] !== '/'
    ) {
      attr += html[at];
      at += 1;
    }
    if (attr === '') {
      at += 1;
      continue;
    }

    let value: string | null = null;
    let look = at;
    while (look < html.length && isSpace(html[look] ?? '')) look += 1;
    if (html[look] === '=') {
      look += 1;
      while (look < html.length && isSpace(html[look] ?? '')) look += 1;
      const quote = html[look];
      if (quote === '"' || quote === "'") {
        const end = html.indexOf(quote, look + 1);
        value = end === -1 ? html.slice(look + 1) : html.slice(look + 1, end);
        look = end === -1 ? html.length : end + 1;
      } else {
        let bare = '';
        while (look < html.length && !isSpace(html[look] ?? '') && html[look] !== '>') {
          bare += html[look];
          look += 1;
        }
        value = bare;
      }
      at = look;
    }

    attrs.push({ name: attr, value });
  }

  return { tag: name.toLowerCase(), attrs, closed, at };
}

function parse(html: string): Node[] {
  const roots: Node[] = [];
  const open: Element[] = [];
  const put = (node: Node): void => {
    const parent = open[open.length - 1];
    (parent ? parent.children : roots).push(node);
  };

  let at = 0;
  while (at < html.length) {
    const angle = html.indexOf('<', at);
    if (angle === -1) {
      put({ kind: 'text', text: html.slice(at) });
      break;
    }
    if (angle > at) put({ kind: 'text', text: html.slice(at, angle) });

    if (html.startsWith('<!--', angle)) {
      const end = html.indexOf('-->', angle + 4);
      put({ kind: 'comment', text: end === -1 ? html.slice(angle + 4) : html.slice(angle + 4, end) });
      at = end === -1 ? html.length : end + 3;
      continue;
    }

    // A doctype or a processing instruction is not part of one element.
    if (html.startsWith('<!', angle) || html.startsWith('<?', angle)) {
      const end = html.indexOf('>', angle);
      at = end === -1 ? html.length : end + 1;
      continue;
    }

    if (html.startsWith('</', angle)) {
      const read = readTag(html, angle + 2);
      for (let level = open.length - 1; level >= 0; level -= 1) {
        if (open[level]?.tag === read.tag) {
          open.length = level;
          break;
        }
      }
      at = Math.max(read.at, angle + 1);
      continue;
    }

    if (!/[A-Za-z]/.test(html[angle + 1] ?? '')) {
      put({ kind: 'text', text: '<' });
      at = angle + 1;
      continue;
    }

    const read = readTag(html, angle + 1);
    const element: Element = {
      kind: 'element',
      tag: read.tag,
      attrs: read.attrs,
      children: [],
      empty: read.closed || VOID.includes(read.tag),
      raw: null,
    };
    put(element);
    at = Math.max(read.at, angle + 1);

    if (element.empty) continue;

    if (RAW.includes(read.tag)) {
      const end = html.toLowerCase().indexOf(`</${read.tag}`, at);
      element.raw = end === -1 ? html.slice(at) : html.slice(at, end);
      if (end === -1) {
        at = html.length;
      } else {
        const shut = html.indexOf('>', end);
        at = shut === -1 ? html.length : shut + 1;
      }
      continue;
    }

    open.push(element);
  }

  return roots;
}

/* ----------------------------------------------------------- taking ours out */

function isOurs(node: Node): boolean {
  return (
    node.kind === 'element' &&
    node.attrs.some((attr) => {
      const name = attr.name.toLowerCase();
      return name === 'data-graphe' || name.startsWith('data-graphe-');
    })
  );
}

function ourAttr(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'data-graphe' || lower.startsWith('data-graphe-');
}

/** Our marks off this element, and anything of ours below it gone entirely. */
function clean(node: Node): Node {
  if (node.kind !== 'element') return node;
  return {
    ...node,
    attrs: node.attrs.filter((attr) => !ourAttr(attr.name)),
    children: node.children.filter((child) => !isOurs(child)).map(clean),
  };
}

/* ------------------------------------------------------------------ writing */

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function quoted(value: string): string {
  return `"${value.replace(/"/g, '&quot;')}"`;
}

function openTag(node: Element): string {
  const attrs = node.attrs
    .map((attr) => (attr.value === null ? attr.name : `${attr.name}=${quoted(attr.value)}`))
    .join(' ');
  const head = attrs === '' ? node.tag : `${node.tag} ${attrs}`;
  return node.empty ? `<${head} />` : `<${head}>`;
}

function onlyText(node: Element): string | null {
  if (node.raw !== null) return null;
  let text = '';
  for (const child of node.children) {
    if (child.kind !== 'text') return null;
    text += child.text;
  }
  return collapse(text).trim();
}

function write(node: Node, depth: number, pad: string, out: string[]): void {
  const lead = pad.repeat(depth);

  if (node.kind === 'text') {
    const text = collapse(node.text).trim();
    if (text !== '') out.push(lead + text);
    return;
  }

  if (node.kind === 'comment') {
    out.push(`${lead}<!--${collapse(node.text).trim() === '' ? '' : ` ${collapse(node.text).trim()} `}-->`);
    return;
  }

  const head = openTag(node);
  if (node.empty) {
    out.push(lead + head);
    return;
  }

  const close = `</${node.tag}>`;

  if (node.raw !== null) {
    const lines = node.raw.replace(/^\r?\n/, '').replace(/\s+$/, '').split(/\r?\n/);
    const flat = lines.map((line) => line.trim()).filter((line) => line !== '');
    if (flat.length === 0) out.push(lead + head + close);
    else if (flat.length === 1 && (head + flat[0] + close).length + lead.length <= ONE_LINE_MAX) {
      out.push(lead + head + flat[0] + close);
    } else {
      out.push(lead + head);
      const inner = pad.repeat(depth + 1);
      for (const line of flat) out.push(inner + line);
      out.push(lead + close);
    }
    return;
  }

  if (KEEPS_SPACE.includes(node.tag)) {
    const kept = node.children
      .map((child) => (child.kind === 'text' ? child.text : ''))
      .join('');
    out.push(lead + head + kept + close);
    return;
  }

  const flat = onlyText(node);
  if (flat !== null && (lead + head + flat + close).length <= ONE_LINE_MAX) {
    out.push(lead + head + flat + close);
    return;
  }

  out.push(lead + head);
  for (const child of node.children) write(child, depth + 1, pad, out);
  out.push(lead + close);
}

/* --------------------------------------------------------------- the rule */

/** Splits on the semicolons between declarations, not the ones inside a value. */
function declarations(style: string): { property: string; value: string }[] {
  const out: { property: string; value: string }[] = [];
  let depth = 0;
  let quote: string | null = null;
  let piece = '';

  const take = (): void => {
    const colon = piece.indexOf(':');
    if (colon > 0) {
      const property = piece.slice(0, colon).trim().toLowerCase();
      const value = piece.slice(colon + 1).trim();
      if (property !== '' && value !== '') out.push({ property, value });
    }
    piece = '';
  };

  for (const char of style) {
    if (quote !== null) {
      piece += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ';' && depth === 0) {
      take();
      continue;
    }
    piece += char;
  }
  take();
  return out;
}

function same(a: string, b: string): boolean {
  return collapse(a).trim().toLowerCase() === collapse(b).trim().toLowerCase();
}

function worthSaying(property: string, value: string, all: StyleValues): boolean {
  const said = collapse(value).trim();
  if (said === '' || said === 'initial') return false;
  const dull = DULL[property];
  if (dull !== undefined && same(said, dull)) return false;
  // A colour for a border nobody can see is a value about nothing.
  if (property === 'border-color') {
    const style = all['border-style'];
    if (style === undefined || same(style, 'none')) return false;
  }
  return true;
}

function order(a: string, b: string): number {
  const known = (property: string): number => {
    const index = WORTH_COPYING.indexOf(property);
    return index === -1 ? WORTH_COPYING.length : index;
  };
  return known(a) - known(b) || a.localeCompare(b);
}

/** The rule for one element, or an empty string when there is nothing to say. */
export function styleRules(selector: string, styles: StyleValues, options: TidyOptions = {}): string {
  const pad = ' '.repeat(Math.max(0, options.indent ?? 2));
  const kept = Object.keys(styles)
    .filter((property) => worthSaying(property.toLowerCase(), styles[property] ?? '', styles))
    .sort(order);
  if (kept.length === 0) return '';
  const lines = kept.map((property) => `${pad}${property.toLowerCase()}: ${collapse(styles[property] ?? '').trim()};`);
  return `${selector} {\n${lines.join('\n')}\n}`;
}

/* ------------------------------------------------------------ the selector */

function madeUp(name: string): boolean {
  return MADE_UP.test(name);
}

function selectorFor(root: Element | null): string {
  if (root === null) return '.element';
  const id = root.attrs.find((attr) => attr.name.toLowerCase() === 'id')?.value ?? '';
  if (id !== '' && PLAIN.test(id) && !madeUp(id)) return `#${id}`;

  const classes = (root.attrs.find((attr) => attr.name.toLowerCase() === 'class')?.value ?? '')
    .split(/\s+/)
    .filter((name) => name !== '' && PLAIN.test(name) && !madeUp(name));
  const chosen = classes[0];
  return chosen === undefined ? root.tag : `.${chosen}`;
}

/* --------------------------------------------------------------- the verb */

function firstElement(nodes: readonly Node[]): Element | null {
  for (const node of nodes) if (node.kind === 'element') return node;
  return null;
}

/**
 * An element, ready to put on the clipboard.
 *
 * Anything the rule already says is taken out of the element's own `style`, so
 * the same declaration is never pasted twice. Whatever the rule has nothing to
 * say about stays where it was.
 */
export function copyable(source: ElementSource, options: TidyOptions = {}): Copyable {
  const pad = ' '.repeat(Math.max(0, options.indent ?? 2));
  const styles = source.styles ?? {};

  let roots: Node[];
  try {
    roots = parse(typeof source.html === 'string' ? source.html : '');
  } catch {
    roots = [{ kind: 'text', text: '' }];
  }

  // Our marks come off whatever was clicked; anything of ours beneath it goes.
  const kept = roots.map(clean);
  const root = firstElement(kept);

  const selector = source.selector ?? selectorFor(root);
  const rule = styleRules(selector, styles, { indent: options.indent });

  if (root !== null && rule !== '') {
    const said = new Set(
      Object.keys(styles).filter((property) =>
        worthSaying(property.toLowerCase(), styles[property] ?? '', styles),
      ).map((property) => property.toLowerCase()),
    );
    root.attrs = root.attrs.flatMap((attr) => {
      if (attr.name.toLowerCase() !== 'style' || attr.value === null) return [attr];
      const left = declarations(attr.value).filter((one) => !said.has(one.property));
      if (left.length === 0) return [];
      return [{ name: attr.name, value: left.map((one) => `${one.property}: ${one.value}`).join('; ') }];
    });
  }

  const lines: string[] = [];
  for (const node of kept) write(node, 0, pad, lines);
  const markup = lines.join('\n').trim();

  const text = [markup, rule].filter((part) => part !== '').join('\n\n');
  return { markup, styles: rule, selector, text };
}

/** The markup on its own, tidied. */
export function tidyMarkup(html: string, options: TidyOptions = {}): string {
  return copyable({ html }, options).markup;
}
