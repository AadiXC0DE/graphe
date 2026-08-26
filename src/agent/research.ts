/** Research, properly.
 *
 * The difference between asking a question and researching one is not effort,
 * it is method: break the question up, send somebody after each part, and treat
 * a single source as a lead rather than an answer. The agent will do that when
 * it is asked to and mostly will not when it is not, so this asks — once, in
 * front of the person's own words, and never instead of them.
 *
 * How far it goes is a number here rather than a stronger adjective: how many
 * ways the question is split, how many sources have to agree before a finding
 * is written down, and how many times it goes back out over what is unsettled.
 *
 * One place: the brief is the whole of the feature, so it can be read and
 * argued with without opening the app.
 */

/** Every word this mode puts on screen. */
export const researchWords = {
  /** On the chip, when it is the way of working in force. */
  chip: 'Digs deep',
  name: 'Research it properly',
  note: 'Sends several helpers out at once, weighs what they disagree about, and reports before touching anything.',
  /** Above the three how-far rows, which only appear once this is the choice. */
  howFar: 'How far to go',
} as const;

/**
 * The most that go out together, whatever is asked for.
 *
 * The ceiling admits eight helpers at once and background work asks from the
 * same account, so this stays under it: a split that is refused on the way out
 * is worse than a smaller one that runs.
 */
export const MOST_TOGETHER = 6;

/** The first line of every helper's work, and the words somebody watching sees
 *  instead of the paragraph underneath them. */
export const LOOKING_INTO = 'Looking into:';

export type Depth = 'quick' | 'deep' | 'exhaustive';

/** One setting of how far, and what it actually changes. */
export type HowDeep = {
  id: Depth;
  name: string;
  note: string;
  /** Separate questions sent off at the same time. */
  atOnce: number;
  /** Sources that have to agree before a finding is written as fact. */
  sources: number;
  /** Times it goes back out over what is left unsettled. */
  again: number;
};

/**
 * The three settings.
 *
 * The middle one is the default and is what "digs deep" has always promised, so
 * nobody has to find this to get it. The other two are for somebody who has an
 * opinion about this particular question.
 */
export const DEPTHS: readonly HowDeep[] = [
  {
    id: 'quick',
    name: 'A quick look',
    note: 'Splits the question two ways, sends both off at once, and wants two sources behind anything it states.',
    atOnce: 2,
    sources: 2,
    again: 1,
  },
  {
    id: 'deep',
    name: 'Dig in',
    note: 'Splits it four ways, wants three sources behind each answer, and goes back over anything they disagree about.',
    atOnce: 4,
    sources: 3,
    again: 2,
  },
  {
    id: 'exhaustive',
    name: 'Leave nothing out',
    note: 'Splits it six ways, wants four sources behind each answer, and goes back over what is left unsettled up to three times.',
    atOnce: MOST_TOGETHER,
    sources: 4,
    again: 3,
  },
];

export const DEFAULT_DEPTH: Depth = 'deep';

export function howDeep(depth: Depth = DEFAULT_DEPTH): HowDeep {
  return DEPTHS.find((one) => one.id === depth) ?? (DEPTHS[1] as HowDeep);
}

/* Chosen in the row under the box and read when a message goes out, which are
   two different moments — so the setting is held once, here, rather than twice. */
let howFarNow: Depth = DEFAULT_DEPTH;

/** How far the next research run goes. */
export function chosenDepth(): Depth {
  return howFarNow;
}

export function chooseDepth(depth: Depth): void {
  howFarNow = depth;
}

/**
 * The brief, in front of what somebody actually asked.
 *
 * Numbered because the order is the method — splitting before searching is what
 * makes the helpers independent, and independent helpers are the only reason
 * two of them agreeing means anything.
 *
 * The numbers come from how far somebody asked it to go, so the difference
 * between the settings is work done rather than an adverb.
 *
 * The last line is load-bearing: research that quietly turns into changes is
 * how somebody ends up reviewing a diff they never asked for.
 */
export function researchBrief(depth: Depth = DEFAULT_DEPTH): string {
  const how = howDeep(depth);
  const many = String(how.atOnce);
  const back =
    how.again <= 1
      ? 'Do that once, then write what you have.'
      : `Do that up to ${String(how.again)} times, then write what you have.`;
  return [
    'Treat this as research rather than a change.',
    '',
    `1. Break the question into at least ${many} separate things that would have to be true, and say what they are before you start. Fewer than ${many} is the same question in different words.`,
    `2. Send a helper after each one, several at the same time rather than one after another — all of them in the same reply, so ${many} are working at once. Give each a whole question it can answer without the others. Never put more than ${String(MOST_TOGETHER)} out at one time; any beyond that will not start.`,
    `3. Begin each helper's work with a line reading "${LOOKING_INTO} " and a few plain words for the one thing it is settling. Those words are what somebody watching sees while it works.`,
    '4. Read this project as well as the web. What the code already does is evidence, and it outranks anything written about what it should do.',
    `5. Hold nothing as settled on one source alone: ${String(how.sources)} that agree, found separately, before any part of the answer is written as fact.`,
    `6. Where two answers disagree, or where one rests on a single source, send another helper to settle it rather than picking the one you saw first. ${back}`,
    '7. Report what you found, how sure you are of each part, and what you could not confirm. Name your sources.',
    '',
    'When the research is about work that could be implemented, finish with a concrete numbered implementation plan under the exact heading "IMPLEMENTATION PLAN". Omit that heading when implementation is not relevant.',
    '',
    'Change nothing until I have read it and said so.',
  ].join('\n');
}

/** The brief at the setting nobody has to find. */
export const RESEARCH_BRIEF = researchBrief();

/** What is actually sent. The brief first, then their sentence whole and
 *  unedited — a request paraphrased into a brief is a request nobody can check
 *  the answer against. */
export function asResearch(asked: string, depth: Depth = DEFAULT_DEPTH): string {
  const said = asked.trim();
  if (said === '') return said;
  return `${researchBrief(depth)}\n\nThe question:\n\n${said}`;
}

/* -------------------------------------------------------------------------- */
/* What it is looking into, while it looks                                     */
/* -------------------------------------------------------------------------- */

/** As much of a helper's work as the rail and the band need. */
export type Enquiry = {
  task: string;
  state: 'running' | 'done' | 'failed';
};

/** The longest a line stays readable at a glance. */
const LINE_LENGTH = 80;

/**
 * The one thing a helper is settling, out of the paragraph it was handed.
 *
 * Null when the work carries no such line, so ordinary helpers are left exactly
 * as they were said.
 */
export function lineOfEnquiry(task: string): string | null {
  const mark = /looking into\s*:\s*/i.exec(task);
  if (mark === null) return null;
  const rest = task.slice(mark.index + mark[0].length);
  const line = (rest.split(/[.\n]/)[0] ?? '').replace(/\s+/g, ' ').trim();
  if (line === '') return null;
  if (line.length <= LINE_LENGTH) return line;
  return `${line.slice(0, LINE_LENGTH - 1).replace(/\s+\S*$/, '')}…`;
}

/** The same helpers, each wearing the question it is answering rather than the
 *  paragraph it was handed. */
export function asLinesOfEnquiry<T extends Enquiry>(helpers: readonly T[]): readonly T[] {
  return helpers.map((one) => {
    const line = lineOfEnquiry(one.task);
    return line === null ? one : { ...one, task: line };
  });
}

/** How many of the lines are named in the band before it stops being a sentence
 *  and starts being a list. */
const NAMED = 3;

/**
 * What the run is looking into right now, as the one line above the box.
 *
 * Null when nothing is out, so an ordinary turn keeps saying what it is doing.
 * Several angles worked at once is the whole difference between this and a
 * spinner, and a person cannot see it unless it is said.
 */
export function lookingInto(
  helpers: readonly Enquiry[],
): { label: string; detail?: string } | null {
  const lines = helpers.filter((one) => lineOfEnquiry(one.task) !== null);
  const going = lines.filter((one) => one.state === 'running');
  if (going.length === 0) return null;
  const back = lines.length - going.length;
  const label =
    going.length === 1
      ? back === 0
        ? 'Looking into one thing'
        : `Looking into one more thing, ${String(back)} answered so far`
      : back === 0
        ? `Looking into ${String(going.length)} things at once`
        : `Looking into ${String(going.length)} things at once, ${String(back)} answered so far`;
  const named = going
    .slice(0, NAMED)
    .map((one) => lineOfEnquiry(one.task) ?? '')
    .filter((one) => one !== '');
  if (named.length === 0) return { label };
  const detail = going.length > named.length ? `${named.join(' · ')} · …` : named.join(' · ');
  return { label, detail };
}

/* -------------------------------------------------------------------------- */
/* The plan the report ends with                                               */
/* -------------------------------------------------------------------------- */

/**
 * The heading, however it was written.
 *
 * Bold, a heading of any level, a colon inside or outside the markers, closed
 * hashes, any case, and whitespace either side. The words are dictated by the
 * brief; how they are decorated is not, and a report whose plan is not read is
 * a report that silently loses its plan.
 */
const PLAN_HEADING =
  /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*|__|[*_])?[ \t]*IMPLEMENTATION[ \t]+PLAN[ \t]*:?[ \t]*(?:\*\*|__|[*_])?[ \t]*:?[ \t]*#*[ \t]*$/im;

/**
 * The implementation-plan section the model chose to include in its research.
 *
 * There is deliberately no intent word list here. "Digs deep" applies to one
 * message and then returns to Auto, so the person's next words reach the model
 * unchanged. The model decides whether those words mean implement, research
 * more, challenge a premise, or something else. This only reads the explicit
 * structured section the research brief asked the model to produce, so a large
 * implementation gets a real build checklist without guessing from keywords.
 */
export function implementationPlanFromResearch(report: string): string | null {
  const found = PLAN_HEADING.exec(report);
  if (found === null) return null;
  const after = report.slice(found.index + found[0].length).trim();
  return after === '' ? null : after;
}

/** How the plan says it was longer than the list that came out of it. */
const MORE_STEPS = /there (?:is one|are (\d+)) more steps? after these/i;

/**
 * Said out loud when the plan had more steps than the checklist holds.
 *
 * Read off what the plan itself reported rather than counted again here, so the
 * two can never disagree. A list that stops at twelve and says nothing reads as
 * the whole plan, which is the one thing it is not.
 */
export function stepsNotOnTheList(caveats: readonly string[]): string | null {
  for (const line of caveats) {
    const found = MORE_STEPS.exec(line);
    if (found === null) continue;
    const many = found[1] === undefined ? 1 : Number(found[1]);
    if (!Number.isFinite(many) || many <= 0) return null;
    return many === 1
      ? 'That plan had one more step than the list holds, so the last one is not on it. Ask and I will add it.'
      : `That plan had ${String(many)} more steps than the list holds, so they are not on it. Ask and I will add them.`;
  }
  return null;
}
