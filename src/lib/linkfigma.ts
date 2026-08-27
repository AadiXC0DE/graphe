/** What somebody has to do to let Graphe into Figma, said once.
 *
 * Figma keeps one step for itself: nothing can put a helper into somebody's
 * Figma on their behalf, short of publishing it to Figma's own directory. So
 * there is a step, and a step that is not written down plainly is a step nobody
 * takes. This is that writing, in one place, so the panel and the composer
 * cannot drift into saying it two different ways.
 *
 * It names Figma's own menu items on purpose. "Point Figma at it from its own
 * menu" is the kind of sentence somebody reads while hunting through four menus
 * for a word we would not say — the rule against naming machinery is about our
 * machinery, not about the menu another app is asking them to open.
 */

export const LINK_FIGMA = {
  /** Said where somebody has just shown us a Figma file we cannot open yet. */
  cannot: 'I cannot open Figma files yet.',
  link: 'Let me in',
  linking: 'Getting it ready…',

  title: 'Two things, once. Then never again.',
  steps: [
    'In Figma: Plugins → Development → Import plugin from manifest… and choose the file below. This tells Figma the helper exists.',
    'Then Plugins → Development → Figwright, in whichever file you want me working in. A small panel opens and says Connected.',
  ],
  where: 'The file to choose:',
  after:
    'Figma remembers the first one. The second is how you let me into a particular file, so you do that whenever you want me in a new one.',
  /** When it could not even be fetched, so the steps would be a lie. */
  failed: 'I could not fetch the helper, so there is nothing to point Figma at yet.',
} as const;
