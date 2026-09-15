/** The system prompt, put together in sections.
 *
 * Pi hands back one string: its own instructions, whatever an add-on appended,
 * the project's instruction files, the list of skills it found, and the working
 * directory. This turns that back into named sections, in a fixed order of
 * precedence, so what gives way when the prompt is long is decided by what a
 * piece is rather than by where its characters happened to land.
 *
 * The rules:
 *
 *  - A required section is never dropped, and never silently cut. Where one is
 *    longer than the section may carry, the head travels and the rest is named
 *    by path: a read away rather than gone.
 *  - Optional notes give way first, and the prompt says so in its own text, so
 *    a person reading it can see what was left out.
 *  - Sizes are characters and a rough count, because a token count right for
 *    one model is wrong for the next. Nothing here claims to know the model's
 *    window; `PROMPT_BUDGET` is this app's own working aim.
 *
 * Pure: strings in, string out. What Pi put in the prompt is found by the
 * markers Pi writes, never guessed at by offset, and a Pi version that renders
 * them differently leaves the text alone, which is the safe direction to fail
 * in.
 */

import { AGENTS_BUDGET, PROMPT_BUDGET, standingWords, withinBudget } from './standing';

/** Which piece of the prompt this is. */
export type SectionKind = 'runtime' | 'repository' | 'skills' | 'extensions' | 'plan' | 'memory';

/** What is kept longest to what gives way first. */
export const PRECEDENCE: readonly SectionKind[] = [
  'runtime',
  'repository',
  'skills',
  'extensions',
  'plan',
  'memory',
];

/** What this app's own notes may carry before the rest is folded away. */
export const MEMORY_BUDGET = 4_000;

export type Section = {
  of: SectionKind;
  /** Said above the text, where the text does not name itself. */
  heading?: string | null;
  text: string;
  /** Where the rest of it is, when it is longer than `most`. */
  at?: string | null;
  /** How much of it travels before the rest becomes a line saying where it is. */
  most?: number | undefined;
  /** False for the notes this app carries itself: they give way, the
   *  instructions do not. Left out or true means required. */
  required?: boolean;
};

export type AssembledSection = {
  of: SectionKind;
  /** Characters sent, or nought when it was dropped or empty. */
  size: number;
  /** Sent as a head, with the rest named in place. */
  shortened: boolean;
  /** Left out whole, which only ever happens to an optional section. */
  dropped: boolean;
};

export type Assembled = {
  systemPrompt: string;
  /** Characters sent, which is what can be counted without a tokeniser. */
  characters: number;
  sections: readonly AssembledSection[];
  /** One sentence about what gave way, or null when nothing did. */
  saidSo: string | null;
};

/** One section as it will be sent: its heading, then either all of it or its
 *  head followed by where the rest is. */
function asSent(section: Section): { text: string; shortened: boolean } {
  const body = section.text.trim();
  if (body === '') return { text: '', shortened: false };
  const heading = section.heading?.trim() ?? '';
  const above = heading === '' ? '' : `${heading}\n`;
  const most = section.most;
  if (most === undefined || body.length <= most) return { text: `${above}${body}`, shortened: false };
  const where = section.at?.trim() ?? '';
  const at = where === '' ? standingWords.agentsTrimmed : standingWords.rest(where);
  return { text: `${above}${withinBudget(body, most, at)}`, shortened: true };
}

/**
 * The prompt, in precedence order, with the optional parts that would not fit
 * left out and said so.
 *
 * `foot` is Pi's own closing line, put back at the end of the prompt where Pi
 * had it.
 */
export function assemblePrompt(
  sections: readonly Section[],
  budget = PROMPT_BUDGET,
  foot = '',
): Assembled {
  const ordered = sections
    .map((section, at) => ({ section, at }))
    .sort(
      (one, other) =>
        PRECEDENCE.indexOf(one.section.of) - PRECEDENCE.indexOf(other.section.of) ||
        one.at - other.at,
    )
    .map((one) => one.section);

  const sent = ordered
    .map((section) => ({ section, ...asSent(section) }))
    .filter((one) => one.text !== '');
  const shortened = sent.filter((one) => one.shortened).map((one) => one.section.of);
  const footText = foot.trim();

  const whole = (): string =>
    [...sent.map((one) => one.text), footText].filter((one) => one !== '').join('\n\n');

  // Optional notes give way, from the bottom of the precedence up. A required
  // section is never reached by this loop, whatever the prompt weighs.
  const dropped: SectionKind[] = [];
  for (let at = sent.length - 1; at >= 0 && whole().length > budget; at -= 1) {
    if (sent[at]?.section.required !== false) continue;
    const gone = sent.splice(at, 1)[0];
    if (gone !== undefined) dropped.push(gone.section.of);
  }

  const named = (kinds: readonly SectionKind[]): string =>
    kinds.filter((one, at) => kinds.indexOf(one) === at).join(', ');
  const parts: string[] = [];
  if (dropped.length > 0) parts.push(standingWords.leftOutForRoom(named(dropped)));
  if (shortened.length > 0) parts.push(standingWords.shortened(named(shortened)));
  // Said only where nothing already gave way: a section that was dropped has
  // already been named, and this app's aim is not the model's window.
  if (parts.length === 0 && whole().length > budget) parts.push(standingWords.pastTheAim(budget));
  const saidSo = parts.length === 0 ? null : parts.join(' ');

  const systemPrompt = saidSo === null ? whole() : `${whole()}\n\n${saidSo}`;
  return {
    systemPrompt,
    characters: systemPrompt.length,
    saidSo,
    sections: ordered.map((section) => {
      const one = sent.find((kept) => kept.section === section);
      return {
        of: section.of,
        size: one?.text.length ?? 0,
        shortened: one?.shortened ?? false,
        dropped: one === undefined && section.text.trim() !== '',
      };
    }),
  };
}

/* -------------------------------------------------------------------------- */
/* What Pi assembled                                                           */
/* -------------------------------------------------------------------------- */

/** Pi's own shape, as much of it as anything here reads. Structural, so no Pi
 *  type has to travel with it. */
export type PiPromptOptions = {
  /** The instruction files Pi loaded, each with the path it came from. */
  contextFiles?: readonly { path: string; content: string }[] | undefined;
  /** Whatever an add-on appended, already joined into the prompt. */
  appendSystemPrompt?: string | undefined;
  /** Instruction files that are somebody's own and that Pi does not read, so
   *  they travel with the pieces rather than being found in the prompt. */
  extraFiles?: readonly { path: string; content: string }[] | undefined;
};

/** The line Pi writes above the project's instruction files. */
const CONTEXT_OPEN = '<project_context>';
const CONTEXT_CLOSE = '</project_context>';
/** The line Pi writes above the skills it found. */
const SKILLS_OPEN = 'The following skills provide specialized instructions for specific tasks.';
const SKILLS_CLOSE = '</available_skills>';
/** Pi's closing line, which belongs at the end of the prompt wherever else it
 *  came from. */
const CWD_AT = '\nCurrent working directory: ';

/** One marker-to-marker block, taken out of the text it was found in. Null when
 *  the markers are not there: a Pi version that writes them differently keeps
 *  its text rather than losing it. */
function cutOut(text: string, open: string, close: string): { kept: string; took: string | null } {
  const from = text.indexOf(open);
  if (from === -1) return { kept: text, took: null };
  const stop = text.indexOf(close, from);
  if (stop === -1) return { kept: text, took: null };
  return { kept: text.slice(0, from) + text.slice(stop + close.length), took: text.slice(from, stop + close.length) };
}

/** Pi's whole prompt, as the sections it is made of, plus its closing line. */
export function piecesOf(
  assembled: string,
  options: PiPromptOptions = {},
): { sections: readonly Section[]; foot: string } {
  const sections: Section[] = [];
  let rest = assembled;

  // The working directory is Pi's last line and belongs last wherever the rest
  // of the pieces end up.
  let foot = '';
  const cwdAt = rest.lastIndexOf(CWD_AT);
  if (cwdAt !== -1) {
    foot = rest.slice(cwdAt + 1).trim();
    rest = rest.slice(0, cwdAt);
  }

  // Skills travel as their names, descriptions and file paths, so this is
  // already the progressive form: nothing has to be read for a skill to be
  // found by name.
  const skills = cutOut(rest, SKILLS_OPEN, SKILLS_CLOSE);
  if (skills.took !== null) {
    rest = skills.kept;
    sections.push({ of: 'skills', text: skills.took.trim() });
  }

  const appended = options.appendSystemPrompt?.trim() ?? '';
  if (appended !== '' && rest.includes(appended)) {
    rest = rest.replace(appended, '').trimEnd();
    sections.push({ of: 'extensions', text: appended });
  }

  const context = cutOut(rest, CONTEXT_OPEN, CONTEXT_CLOSE);
  if (context.took !== null) {
    rest = context.kept;
    const files = options.contextFiles ?? [];
    const renderings = files.map((one) => ({
      one,
      rendered: `<project_instructions path="${one.path}">\n${one.content}\n</project_instructions>`,
    }));
    // Only when every file can be found again by its own path: a half-read
    // block would send some of the project's instructions twice and lose the
    // rest.
    const found = renderings
      .filter(({ rendered }) => context.took?.includes(rendered) === true)
      .map(({ one }) => one);
    if (found.length > 0 && found.length === files.length) {
      for (const one of found) {
        sections.push({ of: 'repository', text: one.content, at: one.path, most: AGENTS_BUDGET });
      }
    } else {
      sections.push({ of: 'repository', text: context.took.trim() });
    }
  }

  // Somebody's own global file, which Pi does not read. Still repository
  // instructions, still held to the same cap, still named by its path.
  for (const one of options.extraFiles ?? []) {
    if (one.content.trim() === '') continue;
    sections.push({ of: 'repository', text: one.content, at: one.path, most: AGENTS_BUDGET });
  }

  sections.unshift({ of: 'runtime', text: rest.trim() });
  return { sections, foot };
}
