/** A run of states, and what produced each one.
 *
 * Everything else photographs a page at rest. The states worth arguing about
 * are the other ones — hovered, focused, loading, empty, wrong, the third step
 * of a form, the message that shows for two seconds — and none of them exist
 * until somebody does something. So a frame is never a picture on its own: it
 * is a picture, the sentence that says how the page got there, and how long
 * after the start it happened.
 *
 * Words and arithmetic. The pictures are taken elsewhere.
 */

/** What somebody did, as the page saw it. */
export type Did =
  | 'opened'
  | 'pressed'
  | 'typed'
  | 'chose'
  | 'hovered'
  | 'focused'
  | 'sent'
  | 'went'
  | 'scrolled'
  | 'changed'
  | 'waited';

export const DIDS: readonly Did[] = [
  'opened',
  'pressed',
  'typed',
  'chose',
  'hovered',
  'focused',
  'sent',
  'went',
  'scrolled',
  'changed',
  'waited',
];

export function isDid(value: unknown): value is Did {
  return typeof value === 'string' && (DIDS as readonly string[]).includes(value);
}

/** One thing that happened. */
export type Doing = {
  did: Did;
  /** What it was done to, in the page's own words: "Add to basket". */
  what?: string | null;
  /** When, on this machine's clock. */
  at: number;
};

/** One state, photographed or honestly not. */
export type Frame = {
  id: string;
  /** How the page got here: "After pressing Add to basket". */
  says: string;
  /** Milliseconds from the start of the run. */
  after: number;
  /** The picture, or null when it could not be taken. */
  shot: string | null;
  /** Why there is no picture. Null when there is one. */
  missing: string | null;
};

export type Recording = {
  id: string;
  /** What was being tried, in the person's own words. */
  says: string;
  startedAt: number;
  frames: readonly Frame[];
  /** Something true about the run that is not any one frame — that it stopped
   *  early, say. Null when there is nothing to add. */
  note: string | null;
};

/* --------------------------------------------------------------------- words */

/** A name longer than this is a paragraph the page happened to contain. */
const NAME_MAX = 42;

function shortened(what: string | null | undefined): string {
  const one = (what ?? '').replace(/\s+/g, ' ').trim();
  if (one === '') return '';
  return one.length <= NAME_MAX ? one : `${one.slice(0, NAME_MAX - 1).trimEnd()}…`;
}

/** Every sentence a frame can carry, in one place, so the voice cannot drift
 *  between the recorder and whatever draws it. */
const SAYS: Readonly<Record<Did, (name: string) => string>> = {
  opened: (name) => (name === '' ? 'When the page opened' : `When ${name} opened`),
  pressed: (name) => (name === '' ? 'After a press' : `After pressing ${name}`),
  typed: (name) => (name === '' ? 'After typing' : `After typing in ${name}`),
  chose: (name) => (name === '' ? 'After choosing something' : `After choosing ${name}`),
  hovered: (name) => (name === '' ? 'With the cursor on it' : `With the cursor on ${name}`),
  focused: (name) => (name === '' ? 'With something focused' : `With ${name} focused`),
  sent: (name) => (name === '' ? 'After sending the form' : `After sending ${name}`),
  went: (name) => (name === '' ? 'After moving to another page' : `After going to ${name}`),
  scrolled: (name) => (name === '' ? 'After scrolling down' : `After scrolling to ${name}`),
  changed: () => 'After the page changed on its own',
  waited: () => 'A moment later',
};

/** How a state gets described. Never empty: a frame nobody can read is a frame
 *  nobody can point at. */
export function saysWhatHappened(doing: Doing): string {
  const say = SAYS[doing.did] as ((name: string) => string) | undefined;
  if (say === undefined) return 'After something happened';
  return say(shortened(doing.what));
}

/** How far into the run, said the way somebody would read it off a stopwatch. */
export function sinceStart(after: number): string {
  if (!Number.isFinite(after) || after < 250) return 'At the start';
  if (after < 60_000) return `${(after / 1000).toFixed(1)}s in`;
  const whole = Math.round(after / 1000);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return seconds === 0 ? `${String(minutes)}m in` : `${String(minutes)}m ${String(seconds)}s in`;
}

const COUNTS = [
  'No',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
] as const;

function counted(many: number): string {
  return COUNTS[many] ?? String(many);
}

function lowerCounted(many: number): string {
  return counted(many).toLowerCase();
}

/* ------------------------------------------------------------------- frames */

/** The reason of last resort. A state we could not photograph is reported as
 *  one we could not photograph, so this is never left empty. */
const NO_PICTURE = 'The picture didn’t come out.';

export type FrameRequest = {
  id: string;
  doing: Doing;
  /** Milliseconds from the start of the run. */
  after: number;
  shot: string | null;
  /** Why there is no picture. Filled in when a picture is missing without one. */
  missing?: string | null;
};

/** A frame, with the one rule that matters held by construction: no picture and
 *  no reason cannot both be true. */
export function frameOf(request: FrameRequest): Frame {
  const missing = (request.missing ?? '').trim();
  return {
    id: request.id,
    says: saysWhatHappened(request.doing),
    after: Math.max(0, Math.round(Number.isFinite(request.after) ? request.after : 0)),
    shot: request.shot,
    missing: request.shot === null ? (missing === '' ? NO_PICTURE : missing) : null,
  };
}

/** The states nobody could photograph. */
export function whatIsMissing(frames: readonly Frame[]): readonly Frame[] {
  return frames.filter((frame) => frame.shot === null);
}

/** How long the whole run lasted. */
export function howLong(recording: Recording): number {
  return recording.frames.reduce((most, frame) => Math.max(most, frame.after), 0);
}

/**
 * The run in one plain sentence.
 *
 * `ok` is true only when every state came out. A frame that could not be
 * photographed is never quietly counted as a pass — the whole reason to look at
 * a recording instead of a diff is that it is supposed to be the truth.
 */
export function readsWell(recording: Recording): { ok: boolean; says: string } {
  const frames = recording.frames;
  if (frames.length === 0) return { ok: false, says: walkthrough.empty };

  const lost = whatIsMissing(frames).length;
  const many = frames.length;
  const states = many === 1 ? 'state' : 'states';
  const parts: string[] = [];

  if (lost === 0) {
    parts.push(
      many === 1 ? 'One state, photographed.' : `${counted(many)} ${states}, all photographed.`,
    );
  } else {
    parts.push(`${counted(many)} ${states}.`);
    parts.push(
      lost === 1
        ? 'One of them couldn’t be photographed.'
        : `${counted(lost)} of them couldn’t be photographed.`,
    );
  }

  const note = (recording.note ?? '').trim();
  if (note !== '') parts.push(note);

  return { ok: lost === 0, says: parts.join(' ') };
}

/** What the strip says before anybody opens it. The recording's own words when
 *  it has them, else what it is. */
export function headlineFor(recording: Recording): string {
  const said = recording.says.trim();
  if (said !== '') return said;
  const many = recording.frames.length;
  return many === 0
    ? walkthrough.heading
    : `${lowerCounted(many)} ${many === 1 ? 'state' : 'states'}, recorded`
        .replace(/^./, (first) => first.toUpperCase());
}

/** Said when a run stops itself rather than run forever. */
export function saysItStopped(most: number): string {
  return `Stopped after ${lowerCounted(most)} states. There were more.`;
}

/** Said about states the page saw and could not hold on to. Counted rather than
 *  quietly dropped: the run is evidence, and evidence with a silent gap in it is
 *  worse than no evidence. */
export function saysItMissed(many: number): string {
  return many === 1
    ? 'One state went by too quickly to photograph.'
    : `${counted(many)} states went by too quickly to photograph.`;
}

/** Two things worth saying about a run, joined without an empty gap. */
export function alsoSay(note: string | null, more: string): string {
  const already = (note ?? '').trim();
  return already === '' ? more : `${already} ${more}`;
}

/* --------------------------------------------------------------------- copy */

/** The button, and everything said around it. */
export const walkthrough = {
  /** Who is watching whom was the question people were left with. This names
   *  what comes out instead: a picture of every state the page went through. */
  button: 'Record me using it',
  working: 'Recording. Use the page as you would, then stop.',
  stop: 'Stop recording',
  heading: 'Every state',
  empty: 'Nothing recorded yet. Press “Record me using it”, then use the page.',
  again: 'Record it again',
  /** On the frame itself, where the picture should have been. */
  missing: 'Didn’t come out',
  /** The two ways to look through one. */
  stepping: 'One at a time',
  all: 'All of them',
  earlier: 'Earlier state',
  later: 'Later state',
};
