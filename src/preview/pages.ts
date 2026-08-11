/** The screens a project has, worked out from the files it keeps them in.
 *
 * A designer's index of a project is not its folders — it is its pages. This
 * turns a list of file paths into that index, for the frameworks a designer is
 * likely to be handed: Next's two routers, SvelteKit, Astro, and a folder of
 * plain HTML.
 *
 * Pure, and separate from anything that touches a disk: the shell reads the
 * folder, this decides what the folder means.
 */

/** One screen, as the rail lists it. */
export type Page = {
  /** What to put after the preview's address. Always starts with a slash. */
  route: string;
  /** The file it lives in, relative to the project. */
  file: string;
  /** What to call it on screen. */
  name: string;
};

const FOLDERS_TO_SKIP = /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.svelte-kit|coverage)(\/|$)/;

/** Framework files that sit among the pages without being one. */
const NOT_A_PAGE = /(^|\/)(_app|_document|_error|404|500|index\.d)\.[jt]sx?$/;

const PAGE_EXTENSION = /\.(tsx|jsx|ts|js|svelte|astro|vue|mdx)$/;

/** `(marketing)` and `(app)` group files without appearing in the address. */
function withoutGroups(segments: readonly string[]): string[] {
  return segments.filter((part) => !(part.startsWith('(') && part.endsWith(')')));
}

function route(segments: readonly string[]): string {
  const kept = withoutGroups(segments).filter((part) => part !== '');
  return kept.length === 0 ? '/' : `/${kept.join('/')}`;
}

/** The words for a route. `/case-studies/[slug]` is "Case studies", because the
 *  part that changes is not a name anybody would recognise. */
export function nameOf(path: string): string {
  const named = withoutGroups(path.split('/')).filter(
    (part) => part !== '' && !part.startsWith('[') && !part.startsWith(':'),
  );
  const last = named[named.length - 1];
  if (last === undefined) return 'Home';
  const words = last.replace(/\.html$/, '').replace(/[-_]+/g, ' ').trim();
  if (words === '') return 'Home';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One file, read as the page it is — or null when it is not one. */
function pageOf(file: string): Page | null {
  if (FOLDERS_TO_SKIP.test(file) || file.startsWith('.')) return null;
  const parts = file.split('/');
  const leaf = parts[parts.length - 1] ?? '';

  // A folder of plain HTML. The address is the file itself, because that is how
  // a static server serves it.
  if (leaf.endsWith('.html')) {
    const where = route(parts);
    const address = leaf === 'index.html' ? route(parts.slice(0, -1)) : where;
    return { route: address, file, name: nameOf(address === '/' ? '' : address) };
  }

  if (!PAGE_EXTENSION.test(leaf) || NOT_A_PAGE.test(file)) return null;

  // Next's app router and SvelteKit both name the file and put the address in
  // the folders above it.
  if (/^(page|\+page)\./.test(leaf)) {
    const under = parts.slice(0, -1);
    const root = under.findIndex((part) => part === 'app' || part === 'routes');
    if (root === -1) return null;
    const where = route(under.slice(root + 1));
    return { route: where, file, name: nameOf(where === '/' ? '' : where) };
  }

  // Next's pages router and Astro put the address in the filename.
  const root = parts.findIndex((part) => part === 'pages');
  if (root === -1) return null;
  const bare = leaf.replace(PAGE_EXTENSION, '');
  const under = [...parts.slice(root + 1, -1), ...(bare === 'index' ? [] : [bare])];
  const where = route(under);
  return { route: where, file, name: nameOf(where === '/' ? '' : where) };
}

/**
 * Every screen in the project, home first and the rest alphabetical.
 *
 * Two files claiming one address — an `index.html` beside an `index.astro` —
 * keep the first, because guessing which one the server would win with is
 * worse than showing one of them.
 */
export function pagesIn(files: readonly string[]): readonly Page[] {
  const found = new Map<string, Page>();
  for (const file of files) {
    const page = pageOf(file.replace(/\\/g, '/'));
    if (page === null || found.has(page.route)) continue;
    found.set(page.route, page);
  }
  return [...found.values()].sort((a, b) => {
    if (a.route === '/') return -1;
    if (b.route === '/') return 1;
    return a.route.localeCompare(b.route);
  });
}
