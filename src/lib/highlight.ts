/** Syntax colour, arriving late and never in the way.
 *
 * Shiki is a real TextMate engine with real grammars, which is why the code it
 * prints is right where a regex highlighter guesses. It is also several hundred
 * kilobytes, and `UI-DESIGN.md` commits to a window that is usable in under two
 * seconds. Both of those things are true at once, so nothing here is imported
 * until a code block actually exists on screen:
 *
 *  - the engine loads on the first fence, through `import()`, in its own chunk;
 *  - each grammar loads on the first fence that speaks that language;
 *  - the JavaScript regex engine is used rather than the Oniguruma one, so
 *    there is no WebAssembly to fetch and compile before any of it can run;
 *  - a block renders as plain text first and upgrades when the colour is ready,
 *    so a slow highlight costs nobody a paint.
 *
 * The theme is `tokens.css` and nothing else. Shiki's CSS-variables theme emits
 * `var(--code-token-keyword)` instead of a hex, so the palette is defined once
 * in our own stylesheet, follows light and dark for free, and cannot smuggle in
 * somebody's Dracula.
 */

import type { HighlighterCore } from 'shiki/core';

/** Grammars, one dynamic import each. The map is the allowlist: a fence whose
 *  language is not in here never loads anything, it just stays plain. */
const GRAMMARS: Readonly<Record<string, () => Promise<unknown>>> = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  html: () => import('@shikijs/langs/html'),
  markdown: () => import('@shikijs/langs/markdown'),
  bash: () => import('@shikijs/langs/bash'),
  diff: () => import('@shikijs/langs/diff'),
  yaml: () => import('@shikijs/langs/yaml'),
  python: () => import('@shikijs/langs/python'),
  sql: () => import('@shikijs/langs/sql'),
};

export function canHighlight(language: string | null): language is string {
  return language !== null && language in GRAMMARS;
}

const THEME = 'graphe';

let engine: Promise<HighlighterCore> | null = null;

function highlighter(): Promise<HighlighterCore> {
  engine ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
      await Promise.all([import('shiki/core'), import('shiki/engine/javascript')]);

    const theme = createCssVariablesTheme({ name: THEME, variablePrefix: '--code-' });

    /* Three tones, spent where they read.
     *
     * The stock mapping leaves CSS almost entirely one colour and then puts the
     * accent on every colon, which is the opposite of useful: the punctuation
     * shouts and the names whisper. These last rules win over the ones above
     * them and put the emphasis back where the eye needs it — the thing being
     * named takes the accent, values take the tint, and punctuation goes quiet.
     */
    theme.tokenColors ??= [];
    theme.tokenColors.push(
      {
        scope: ['punctuation.separator.key-value', 'punctuation.terminator'],
        settings: { foreground: 'var(--code-token-punctuation)' },
      },
      {
        scope: [
          'entity.other.attribute-name.class',
          'entity.other.attribute-name.id',
          'entity.name.tag',
        ],
        settings: { foreground: 'var(--code-token-keyword)' },
      },
      {
        scope: ['constant.numeric', 'keyword.other.unit', 'support.constant.property-value'],
        settings: { foreground: 'var(--code-token-string)' },
      },
    );

    return createHighlighterCore({
      themes: [theme],
      langs: [],
      // `forgiving` matters more than it sounds: a grammar with a regex the
      // JavaScript engine cannot express should cost that one pattern its
      // colour, not throw in the middle of somebody's reply.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  return engine;
}

const grammars = new Map<string, Promise<void>>();

function grammar(core: HighlighterCore, language: string): Promise<void> {
  let pending = grammars.get(language);
  if (pending === undefined) {
    const load = GRAMMARS[language];
    pending =
      load === undefined
        ? Promise.resolve()
        : // Awaited all the way down, deliberately: `loadLanguage` returns a
          // promise of its own, and letting this resolve before that one did
          // meant the first block of any language asked for a grammar that was
          // still on its way and quietly stayed plain for ever.
          load().then(async (module) => {
            await core.loadLanguage(module as Parameters<HighlighterCore['loadLanguage']>[0]);
          });
    grammars.set(language, pending);
  }
  return pending;
}

/**
 * Coloured HTML for one block, or null if it could not be done.
 *
 * Null is an ordinary answer, not a failure worth reporting: the caller is
 * already showing the code as plain text, and plain text that stays plain is a
 * quieter outcome than a message about a highlighter nobody asked for.
 *
 * The HTML this returns is Shiki's own — it is built from the tokens of the
 * code, escaped by Shiki, and it is the only string in the app that reaches
 * `dangerouslySetInnerHTML`. It is safe for the same reason a syntax
 * highlighter is safe: the input is treated as text throughout, and no part of
 * the model's output survives as markup.
 */
export async function highlight(code: string, language: string): Promise<string | null> {
  if (!canHighlight(language)) return null;
  try {
    const core = await highlighter();
    await grammar(core, language);
    return core.codeToHtml(code, { lang: language, theme: THEME });
  } catch {
    return null;
  }
}

/** One coloured run of a line. The colour is whatever the theme resolved to,
 *  which for our CSS-variables theme is `var(--code-token-…)`. */
export type Token = { text: string; colour: string | null };

/**
 * The same colour as `highlight`, as tokens rather than markup.
 *
 * A diff row is not a block of code: it carries a line number, a sign, a tint
 * for the side it is on, and a word mark inside it. All of that has to sit
 * around the same characters, so the caller needs the runs rather than a
 * finished string of HTML.
 */
export async function tokensOf(
  code: string,
  language: string,
): Promise<readonly (readonly Token[])[] | null> {
  if (!canHighlight(language) || code === '') return null;
  try {
    const core = await highlighter();
    await grammar(core, language);
    const { tokens } = core.codeToTokens(code, { lang: language, theme: THEME });
    return tokens.map((line) => line.map((one) => ({ text: one.content, colour: one.color ?? null })));
  } catch {
    return null;
  }
}
