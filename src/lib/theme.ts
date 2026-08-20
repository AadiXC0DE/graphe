/** Light, dark, or whatever the computer is set to.
 *
 * The palette has had both themes since the beginning and nothing in the app
 * ever let anybody choose — the only code that set `data-theme` was the
 * component gallery, so a person got whatever macOS was doing and had no say.
 *
 * Pure. Reading the computer's own setting and writing the attribute both
 * happen at the edge; this only decides what the answer means.
 */

export type Theme = 'system' | 'light' | 'dark';

export const THEME_WORDS = {
  name: 'Light or dark',
  note: 'Follow this computer, or pick one and keep it.',
  system: 'Match this computer',
  light: 'Light',
  dark: 'Dark',
} as const;

export const THEMES: readonly { id: Theme; label: string }[] = [
  { id: 'system', label: THEME_WORDS.system },
  { id: 'light', label: THEME_WORDS.light },
  { id: 'dark', label: THEME_WORDS.dark },
];

/** Anything unreadable means "follow the computer" — the answer somebody gets
 *  when they have never chosen, which is the one that surprises nobody. */
export function themeFrom(stored: unknown): Theme {
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/**
 * What to stamp on the document, or null to stamp nothing.
 *
 * Null matters: with no attribute the stylesheet's own
 * `prefers-color-scheme` block decides, so following the computer means
 * *removing* the mark rather than working out which one to write. A stamp that
 * guessed would stop tracking the moment the computer changed.
 */
export function markFor(theme: Theme): 'light' | 'dark' | null {
  return theme === 'system' ? null : theme;
}

/** Which palette is actually on screen, given a choice and what the computer
 *  says. Used for what the row reads under its own name. */
export function showing(theme: Theme, computerIsDark: boolean): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return computerIsDark ? 'dark' : 'light';
}
