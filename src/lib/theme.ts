/** Light, dark, or whatever the computer is set to.
 *
 * This used to hold five finishes, and a finish was a palette of its own in
 * `styles/tokens.css`. The palette is derived now, so all that is left here is
 * which way the ladder runs; the five starting points live in
 * `design/appearance.ts` as appearances, where everything else about how the
 * app looks already lived.
 *
 * Pure. Reading the computer's own setting and writing the attribute both
 * happen at the edge; this only decides what the answer means.
 */

export type Theme = 'system' | 'light' | 'dark';

export type ThemeExplicit = Exclude<Theme, 'system'>;

export const THEME_WORDS = {
  name: 'Theme',
  note: 'Light, dark or the computer’s choice, and five starting points.',
  system: 'Match this computer',
  light: 'Light',
  dark: 'Dark',
} as const;

/** The two explicit answers, as a segmented control draws them. */
export const THEMES: readonly { id: ThemeExplicit; label: string }[] = [
  { id: 'light', label: THEME_WORDS.light },
  { id: 'dark', label: THEME_WORDS.dark },
];

/** Anything unreadable means "follow the computer" — the answer somebody gets
 *  when they have never chosen, which is the one that surprises nobody.
 *
 *  The four theme names this app used to ship are the four presets of the same
 *  name, so an old choice arrives as that preset's base. */
export function themeFrom(stored: unknown): Theme {
  if (stored === 'light' || stored === 'pink') return 'light';
  if (stored === 'dark' || stored === 'super' || stored === 'slate') return 'dark';
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
  return theme === 'system' ? null : theme;
}

/** Which palette is actually on screen, given a choice and what the computer
 *  says. Used for what the row reads under its own name. */
export function showing(theme: Theme, computerIsDark: boolean): ThemeExplicit {
  if (theme !== 'system') return theme;
  return computerIsDark ? 'dark' : 'light';
}
