/** Light, dark, or whatever the computer is set to.
 *
 * The palette has had both themes since the beginning and nothing in the app
 * ever let anybody choose — the only code that set `data-theme` was the
 * component gallery, so a person got whatever macOS was doing and had no say.
 *
 * Pure. Reading the computer's own setting and writing the attribute both
 * happen at the edge; this only decides what the answer means.
 */

export type Theme = 'system' | 'light' | 'graphe' | 'super' | 'pink' | 'slate' | 'dark';

export type ThemeExplicit = Exclude<Theme, 'system'>;

export const THEME_WORDS = {
  name: 'Theme',
  note: 'Five finishes — light, graphe, super, pink and slate. Pick one and keep it.',
  system: 'Match this computer',
  light: 'Light',
  graphe: 'Graphe',
  super: 'Super',
  pink: 'Pink',
  slate: 'Slate',
} as const;

/** The five explicit finishes, as a segmented control draws them.
 *  Each carries a tiny preview palette (Slack-style) so the row reads as
 *  swatches rather than words — bg / raised / border / text / accent. */
export const THEMES: readonly {
  id: ThemeExplicit;
  label: string;
  preview: { bg: string; raised: string; border: string; text: string; accent: string };
}[] = [
  {
    id: 'light',
    label: THEME_WORDS.light,
    preview: { bg: '#fbfbfa', raised: '#ffffff', border: '#e4e4e1', text: '#1a1a19', accent: '#b8492c' },
  },
  {
    id: 'graphe',
    label: THEME_WORDS.graphe,
    preview: { bg: '#131312', raised: '#1c1c1a', border: '#2b2b28', text: '#f2f2ef', accent: '#e0714d' },
  },
  {
    id: 'super',
    label: THEME_WORDS.super,
    preview: { bg: '#0a0a0b', raised: '#18181b', border: '#27272a', text: '#fafafa', accent: '#f59e0b' },
  },
  {
    id: 'pink',
    label: THEME_WORDS.pink,
    preview: { bg: '#fff1f2', raised: '#ffffff', border: '#fecdd3', text: '#1a0a13', accent: '#be123c' },
  },
  {
    id: 'slate',
    label: THEME_WORDS.slate,
    preview: { bg: '#0f172a', raised: '#1e293b', border: '#334155', text: '#f8fafc', accent: '#38bdf8' },
  },
];

/** Anything unreadable means "follow the computer" — the answer somebody gets
 *  when they have never chosen, which is the one that surprises nobody.
 *  'dark' is the historic name for graphe and still maps there. */
export function themeFrom(stored: unknown): Theme {
  if (stored === 'light') return 'light';
  if (stored === 'graphe' || stored === 'dark') return 'graphe';
  if (stored === 'super') return 'super';
  if (stored === 'pink') return 'pink';
  if (stored === 'slate') return 'slate';
  return 'system';
}

/**
 * What to stamp on the document, or null to stamp nothing.
 *
 * Null matters: with no attribute the stylesheet's own
 * `prefers-color-scheme` block decides, so following the computer means
 * *removing* the mark rather than working out which one to write. A stamp that
 * guessed would stop tracking the moment the computer changed.
 */
export function markFor(theme: Theme): ThemeExplicit | null {
  if (theme === 'system') return null;
  if (theme === 'dark') return 'graphe';
  return theme;
}

/** Which palette is actually on screen, given a choice and what the computer
 *  says. Used for what the row reads under its own name. */
export function showing(theme: Theme, computerIsDark: boolean): ThemeExplicit {
  if (theme !== 'system') return theme === 'dark' ? 'graphe' : theme;
  return computerIsDark ? 'graphe' : 'light';
}
