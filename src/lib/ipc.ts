/** The contract between the desktop shell and the window it draws.
 *
 * Both sides import this file and nothing else in common. It is deliberately
 * dependency-free apart from our own event union: the main process runs it under
 * Node, the preload runs it inside a sandbox with almost no Node at all, and the
 * renderer runs it in a browser. Anything that only works in one of those three
 * places does not belong here.
 *
 * Nothing in this file mentions Pi, and nothing ever should. The renderer is not
 * allowed to know that Pi exists (notes/strategy/ARCHITECTURE.md); this is the
 * seam that keeps that true, because it is the widest thing the renderer can
 * see.
 */

import type { AgentEvent, Money, RunningPiece, SpendSummary } from '../agent/types';

export type { RunningPiece } from '../agent/types';
import type { HowFar } from '../agent/guard/policy';
import type { Theme } from './theme';
import type { Frame, Recording } from '../diff/flow';
import type { SpendLimit } from '../cost/limits';
import type { Move } from '../design/moved';
import type { Held } from '../diff/holdshot';
import type { FileEntry } from '../files/tree';
import type { Page } from '../preview/pages';
import type { Reading } from '../preview/inspect';
import type { Pointed } from '../preview/point';
import type { WorkState } from '../work/board';
import type { TokenUsageView } from '../lib/token-days';

export type { TokenUsageView } from '../lib/token-days';

export type {
  FileEntry,
  Frame,
  Held,
  HowFar,
  Money,
  Move,
  Page,
  Pointed,
  Reading,
  Recording,
  SpendLimit,
  SpendSummary,
  WorkState,
};

/** Yes or no, from a person. Same two answers the Guard accepts, and no third. */
export type Decision = 'yes' | 'no';

/**
 * Something that went wrong, already written for a person.
 *
 * Troubles are composed in the main process, where the failure actually happens
 * and where the cause is still in hand, so the renderer never has to guess what
 * an exception meant. `details` is the one field allowed to contain the raw
 * text — it lives behind "Show technical details" and nowhere else.
 */
export type Trouble = {
  /** One sentence on what happened, in the user's terms. */
  what: string;
  /** One sentence on the likeliest reason. Honest about being a guess. */
  because: string;
  /** The label on the single button. */
  actionLabel: string;
  /** Raw text for whoever wants it. Never shown unless asked for. */
  details?: string;
  /** Something worth doing instead of dismissing. `'connect'` means "there is
   *  no account connected" — the window opens the connect screen rather than
   *  showing a card that dead-ends in a "Got it" button. */
  marker?: 'connect';
};

/** Nothing on this bridge throws across the wire. A call either worked or it
 *  came back with a sentence somebody can read. An exception crossing IPC
 *  arrives as "Error invoking remote method", which is the single least useful
 *  thing we could put in front of a designer. */
export type Result<T> = { ok: true; value: T } | { ok: false; trouble: Trouble };

/**
 * Which project, and which conversation in it, a call is about.
 *
 * Both halves are optional and both mean "the one in front" when left out,
 * which is what every call meant before there was anything else to mean. A
 * project is named by its folder; a conversation by the `address` it was opened
 * with, or by the file it is written down in — both reach the same one.
 */
export type Where = {
  project?: string;
  conversation?: string;
  /** One project inside a folder that holds several, by its folder name
   *  ("backend"). Present only where a call means one child of such a folder;
   *  every call that leaves it out means exactly what it always meant. */
  repo?: string;
};

/**
 * The address a call came with, taken off the end of its arguments.
 *
 * Last rather than first, and recognised by its shape rather than by its
 * position, because that is what lets a call that names nothing stay exactly the
 * call it always was. Nothing else crossing this bridge is an object with only
 * these two fields in it.
 */
export function whereIn(args: readonly unknown[]): Where {
  const last = args[args.length - 1];
  if (last === null || typeof last !== 'object' || Array.isArray(last)) return {};
  const fields = last as Record<string, unknown>;
  const keys = Object.keys(fields);
  if (keys.length === 0) return {};
  if (!keys.every((key) => key === 'project' || key === 'conversation' || key === 'repo')) return {};
  const where: Where = {};
  const project = fields['project'];
  const conversation = fields['conversation'];
  // A child name is a folder name, not a path. Separators and control
  // characters go; spaces stay, because "my app" is a folder somebody really
  // has and stripping them would name a folder that does not exist.
  const repo = typeof fields['repo'] === 'string' ? fields['repo'].trim() : '';
  if (repo !== '') {
    // eslint-disable-next-line no-control-regex
    const clean = repo.slice(0, 80).replace(/[/\\\u0000-\u001f\u007f]/g, '').trim();
    if (clean !== '') where.repo = clean;
  }
  if (typeof project === 'string' && project.trim() !== '') where.project = project;
  if (typeof conversation === 'string' && conversation.trim() !== '') {
    where.conversation = conversation;
  }
  return where;
}

/** A project folder, as the window refers to it. */
export type OpenedProject = {
  /** Absolute path. Shown only if the user asks for it. */
  path: string;
  /** The folder's own name, which is what people call their project. */
  name: string;
  /** The conversation this project left behind, replayed as events. The window
   *  folds them through the same reducer it runs live events through, so a
   *  project opened again comes back as the desk it was — not as an
   *  introduction (BACKLOG B1.1). Empty when nothing was ever said. */
  history: readonly AgentEvent[];
  /** Which conversation is on screen, by its own path. Null when this one has
   *  not been written down yet. The shelf marks the row that matches. */
  conversation: string | null;
  /** What to call this conversation when addressing it. Steady for as long as
   *  it is open, including before the first word has been written down, so a
   *  window can address a conversation it has only just started. */
  address?: string;
  /** The autonomy rung this live conversation is actually using. A reopened
   *  session may not be on the default rung, so the window must not guess. */
  howFar?: HowFar;
  /** True when this conversation is working in its own copy of the project
   *  rather than in the folder itself. Only the window knows to offer bringing
   *  that work back or throwing it away, and only if it is told. */
  ownCopy?: boolean;
};

/**
 * A project this computer remembers, for the picker on launch.
 *
 * `missing` is worked out at the moment the list is asked for rather than
 * stored, because a folder can be moved, renamed or thrown away while the app is
 * not looking, and a list that only finds out when you click is a list that
 * greets you with a failure.
 */
export type RecentProject = {
  path: string;
  name: string;
  /** Epoch ms. Newest first is the order the picker shows them in. */
  lastOpenedAt: number;
  /** What the last sitting in this folder cost, or null if nothing was spent. */
  lastSpend: Money | null;
  /** True when the folder is not where we left it. */
  missing: boolean;
};

/**
 * How much of what the model can hold at once this conversation is using.
 *
 * The window draws it as a ring beside the box. Everything here is the model's
 * own reckoning read back through Pi — nothing is counted on this side.
 */
/** One go at a job, as the comparison draws it. Kept apart from the board's
 *  own piece: this one carries the change, which nothing else needs. */
export type SideOfWork = {
  id: string;
  name: string;
  /** Where this go is up to. Only a finished one can be taken; the rest are
   *  drawn as columns because watching one form is worth something. */
  state: WorkState;
  /** Everything it changed, as one patch. Empty when it changed nothing. */
  diff: string;
  picture: string | null;
  /** What it came to, already in words. */
  spent: string | null;
  /** Its own copy of the project, so the same set can be served and looked at
   *  rather than only read as a patch. Null once the copy has gone. */
  folder: string | null;
};

export type Room = {
  /** Unknown briefly after compaction, while the window size remains known. */
  used: number | null;
  total: number;
  /** The two above as a fraction, 0 to 1; unknown with `used`. */
  part: number | null;
  /** How many times this conversation has been shortened to make room. Absent
   *  from a reading that predates the count, and from the mock bridge. */
  shortened?: number;
};

/**
 * One entry in the version timeline, as the window draws it.
 *
 * Deliberately not `history/timeline`'s own `Version`. That type belongs to a
 * module that spawns processes and reads folders; this one crosses a structured
 * clone into a sandbox, and the seam between them is the point of this file.
 */
/** A set of design edits the window is holding, to be written and saved in one
 *  go. Nothing about them touches the project until the window asks. */
export type DesignChange = {
  tokens: readonly { name: string; value: string }[];
  motions: readonly { places: readonly unknown[]; change: unknown }[];
};

export type SavedVersion = {
  id: string;
  /** The same id, short. What a terminal, a review page or a colleague calls
   *  this moment — shown where somebody has asked for that much detail. */
  shortId: string;
  /** Epoch ms. The window turns it into "4 minutes ago" itself. */
  at: number;
  /** Plain language, one line: "Made the header sticky". */
  title: string;
  /** Who caused it. */
  by: 'you' | 'graphe';
  /** True when a person chose this title. */
  named: boolean;
  /** The version the project currently looks like. Exactly one, once there is
   *  anything saved at all. */
  current: boolean;
  /** What this moment came after. Two of them is where two lines of work
   *  joined, which is the one thing a straight list cannot draw. */
  parents: readonly string[];
  /** The names pointing at this moment, if any. */
  refs: readonly string[];
  /** Set when this moment exists because somebody went back to an older one. */
  wentBackTo: string | null;
};

/**
 * What happened when somebody put their project back.
 *
 * Going back is itself a version, so it can be undone like anything else —
 * `undoTo` is the id to hand back to `putBack` to do exactly that. The window
 * offers it for a while and then stops offering it; the version is still there
 * either way.
 */
export type PutBack = {
  /** The version the project now looks like, in the user's words. */
  title: string;
  /** When that version was made. Epoch ms — "Put back to 2 minutes ago". */
  at: number;
  /** Hand this back to `putBack` to undo the whole thing. */
  undoTo: string;
  /** The list as it now stands, so the rail does not have to ask twice. */
  versions: readonly SavedVersion[];
};

/**
 * The answer to "See it".
 *
 * `unsure` is a real outcome rather than a failure. A folder we cannot read the
 * shape of gets a question in the conversation instead of a guess that opens
 * the wrong thing — see notes/strategy/SHARING.md §1 for why guessing here is
 * more dangerous than it looks.
 */
export type ShowOutcome =
  | { kind: 'showing'; name: string; address: string }
  | { kind: 'unsure'; question: string };

/** One variation to make ready: a folder that already holds it, named and
 *  briefed the way the person asked, and the served address once it is ready. */
export type VariationSpec = {
  /** A short stable id, ours. */
  id: string;
  /** What it is, said plainly: "Minimal and clean". */
  name: string;
  /** The folder it lives in, absolute. */
  folder: string;
};

/** The answer to "show me the variations". A set whose members are served, or
 *  the first question that could not be answered — surfaced rather than guessed. */
export type VariationsOutcome =
  | {
      kind: 'showing';
      subject: string;
      variations: readonly { id: string; name: string; address: string }[];
    }
  | { kind: 'unsure'; question: string };

/**
 * Somebody pointed at something in their own page.
 *
 * The whole reading travels, not a sentence about it. The shell is the only side
 * that can read the project the element came out of — its values, where each
 * component is used, what last touched the file — so it decides there and the
 * window draws what it is handed. `says` is that same reading written out for the
 * agent that gets asked to change it, so the composer message carries the element's
 * file, component and values without the person having to describe where the
 * element lives.
 */
export type PointedAt = {
  pointed: Pointed;
  reading: Reading;
  says: string;
};

/** One conversation this project has had. */
export type Conversation = {
  id: string;
  path: string;
  title: string;
  at: number;
  messages: number;
};

/**
 * An extension that arrived with the folder somebody opened.
 *
 * Extensions are not tool calls: they are code loaded into the same process as
 * the agent, so the Guard never sees them. One somebody installed themselves is
 * something they went and chose; one that came down with a clone is something
 * they have never seen. Those are different facts, so they are different lists.
 */
export type CarriedExtension = {
  /** Stable across launches: the name, and what the file it loads looks like.
   *  Change the code and this changes with it, which is what makes a yes
   *  answered in January stop covering what lands in March. */
  id: string;
  name: string;
  /** Where it lives, relative to the project. Shown, because "which file" is
   *  most of what somebody needs to decide. */
  where: string;
  /** Whether it is being loaded. */
  trusted: boolean;
};

/** One thing that can be added to Graphe. */
export type Pack = {
  id: string;
  name: string;
  kind: 'extension' | 'skill' | 'prompts' | 'mixed';
  summary: string;
  downloads: number | null;
  version: string | null;
  installed: boolean;
  curated: boolean;
};

/** One width the page was photographed at. */
export type Look = {
  id: string;
  name: string;
  width: number;
  shot: string | null;
  trouble: string | null;
};

/** How the window is sitting on screen. */
export type WindowState = { fullScreen: boolean };

/** A sentence about how it is going, and whether that is the last one. Never a
 *  percentage and never a log line — "Never a spinner without a sentence". */
export type ShowProgress = { says: string; done: boolean };

/**
 * A rectangle of a picture, as fractions of its width and height (0–1).
 *
 * Fractions rather than pixels because the window has no idea how big it will
 * draw the picture — the same area has to sit correctly over a 120px strip and
 * over a full-width stage, and doing that arithmetic on this side of the wire
 * would mean sending it again every time somebody resized the window.
 */
export type ChangedArea = { x: number; y: number; width: number; height: number };

/**
 * A before and after of the page itself — the README's oldest unkept promise
 * (BACKLOG F2).
 *
 * Only the small pictures travel with this. The full ones are hundreds of
 * kilobytes each and almost nobody opens every diff in a long conversation, so
 * they are asked for by `visualFrames` at the moment somebody actually looks.
 */
export type VisualChange = {
  id: string;
  /** Epoch ms. */
  at: number;
  /** One line, past tense: "Made the header sticky". */
  headline: string;
  /** The same change said in design's own words — "Spacing on three cards,
   *  from 16 to 24". Null when nothing in the diff reads that way. */
  inDesignWords: string | null;
  /** Where it landed: "Two areas changed, near the top." Null when the picture
   *  has nothing useful to add. */
  where: string | null;
  /** What moved, for the outlines. Empty is a real answer. */
  areas: readonly ChangedArea[];
  /** Small pictures for the collapsed strip, as data URIs. */
  beforeThumb: string;
  afterThumb: string;
  /** The full pictures' own size, so the window can hold the right shape open
   *  before it has them. */
  width: number;
  height: number;
};

/** The full-size pair, fetched only when somebody opens one. */
export type VisualFrames = { before: string; after: string };

/** One visual change, and which project it belongs to. Same envelope, and same
 *  reason for it, as `AgentNotice`. */
export type VisualNotice = { project: string | null; change: VisualChange };

/**
 * The few things a person can change about the app itself.
 *
 * Sticky: set once, remembered on this computer. Kept in the shell rather than
 * in the window because the window is thrown away on every reload and a
 * preference that forgets itself is not a preference.
 */
export type Preferences = {
  /** Name the real command, path or git operation under each step. Off by
   *  default. See src/lib/showme.ts for what "the real thing" means and why
   *  that file is the one place jargon is allowed. */
  showMe: boolean;
  /** The model chosen to work with, or null for "whatever is available". */
  model: ModelChoice | null;
  /** How much time each chosen model should take before answering. Kept per
   *  provider/model pair because the names and available choices differ. */
  thinking: Readonly<Record<string, ThinkingLevel>>;
  /** Versions somebody chose to keep at the top of the rail, by project folder.
   *  Keyed by folder because keeping is about one project — two folders sharing
   *  a shelf would put somebody else's afternoon at the top of yours. */
  kept: Readonly<Record<string, readonly string[]>>;
  /** Show everything the project holds, alongside the conversation. Off by
   *  default and sticky once asked for, like `showMe`: opening a file tree on
   *  somebody who did not ask for one is the thing this product exists not to
   *  do. */
  showFiles: boolean;
  /** Whether each project holds work back to be looked at first, keyed by its
   *  path. Per project, so saying “ask me first” in one folder never changes
   *  another. Absent is off — read it through `holdsBack`. */
  heldBack: Readonly<Record<string, boolean>>;
  /** Whether each project's browser keeps its logins between sittings, keyed by
   *  its path. Absent is off — read it through `keepsLogins`. */
  keptLogins: Readonly<Record<string, boolean>>;
  /** How much a picture has to move before work is stopped, by id, or null for
   *  the middle one. */
  howMuch: string | null;
  /** The ceiling somebody set on spending, or null when they have not set one.
   *  Remembered across launches: a ceiling that forgets itself is not one. */
  ceiling: Money | null;
  /** Which finishing the window wears. 'system' follows the computer. */
  theme: Theme;
};

/* -------------------------------------------------------------------------- */
/* Landing it                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One piece of work that has not reached the project yet.
 *
 * `state` is the whole of it: being made, finished and waiting, let in, or set
 * aside. Nothing here says where the copy is — that is the shell's business and
 * the window has no use for a folder it cannot open.
 */
export type WaitingWork = {
  id: string;
  /** What it was asked to do, in the person's own words. */
  doing: string;
  state: 'making' | 'waiting' | 'in' | 'aside' | 'nothing';
  /** Epoch ms. */
  at: number;
};

/**
 * What can be done with this project's work right now.
 *
 * Every `can` here was found out by looking rather than assumed, and every
 * `false` has a sentence beside it saying what is missing. The window draws the
 * sentence; it never invents one.
 */
export type Landing = {
  /** Work waiting to be looked at, or null when nothing is. */
  waiting: WaitingWork | null;
  /** What that work would look like, photographed in the copy before anybody
   *  agrees to it. Null when nothing is waiting, or when it could not be shown. */
  held: Held | null;
  /** True when new work is checked before it lands. */
  holdBack: boolean;
  /** Whether the browser this project drives keeps its logins. */
  keepLogins: boolean;
  /** Can the work go all the way to where the team keeps this project? */
  canHandOver: boolean;
  handOverSays: string;
  /** Can this project go online from this computer? */
  canPutOnline: boolean;
  onlineSays: string;
};

/** How handing work over went. */
export type HandedOver = {
  /** True when it reached where the team works. */
  sent: boolean;
  /** What this piece of work is called there. Shown only under "Show me". */
  name: string;
  /** Where somebody can go and look at it. */
  address: string | null;
  says: string;
  /** The real commands, for "Show me" and nowhere else. */
  steps: readonly string[];
};

/** How putting it online went. */
export type WentOnline = {
  address: string | null;
  pages: number;
  says: string;
  steps: readonly string[];
};

/**
 * What came of deciding about work that was waiting.
 *
 * Both answers are undoable through the same door: `undoTo` is a version, and
 * `putBack` takes versions. Having let work in, it is the moment before; having
 * set work aside, it is the work itself. `letIn` says which, so the window can
 * offer "Undo" or "Bring it back" without knowing why they differ.
 */
export type Decided = {
  landing: Landing;
  versions: readonly SavedVersion[];
  letIn: boolean;
  undoTo: string | null;
};

/* -------------------------------------------------------------------------- */
/* Work that carries on without you                                            */
/* -------------------------------------------------------------------------- */

/**
 * A question one of those pieces of work stopped on.
 *
 * Nothing answers it but a person. It travels to the window exactly as the Guard
 * wrote it, and the window's two buttons are the only things that can resolve
 * it — see src/work/unattended.ts, which is where that rule is kept.
 */
export type AwayQuestion = {
  /** Hand this back to `answerAway` with the person's answer. */
  callId: string;
  question: string;
  detail: string | null;
  consequence: string | null;
};

/** What a piece of work is waiting for before it starts. `says` is the whole
 *  sentence for the card; `id` is there so the window can draw the two together. */
export type AwayAfter = {
  id: string;
  /** What that one was asked to do, in the person's own words. */
  doing: string;
  /** "After “Tighten the nav”". */
  says: string;
};

/** One piece of work carrying on in its own copy of the project. */
export type AwayPiece = {
  id: string;
  /** What it was asked to do, in the person's own words. */
  doing: string;
  state: WorkState;
  /** Epoch ms. */
  at: number;
  /** What its result looks like, small, once there is one. */
  picture: string | null;
  /** What it did, in a sentence. Null while there is nothing true to say. */
  says: string | null;
  /** Why it stopped, when it did not work. */
  trouble: string | null;
  /** What this one cost on its own. Null when nothing has been spent on it, or
   *  when it comes from somewhere that does not count. */
  spent?: Money | null;
  /** One of several goes at the same thing, and how many there are. Absent on
   *  ordinary work, which is almost all of it. */
  /** The files this one changed, once it has finished. Two pieces that
   *  changed the same file are the one thing worth saying before a set goes
   *  in. Absent on anything unfinished. */
  touches?: readonly string[] | null;
  oneOf?: { of: number; at: number;
    /** What the goes share, so any one of them can open the comparison. */
    named: string } | null;
  /** What it is waiting to be told, or null. */
  question: AwayQuestion | null;
  /** What has to finish before it starts, or null when nothing does. */
  after?: AwayAfter | null;
};

/** One thing asked for over and over, as the window draws it. Nothing here says
 *  how the timing works — only what it does and when it happens next. */
export type Repeating = {
  id: string;
  doing: string;
  /** "Every day at 7:00am". */
  says: string;
  /** "Tomorrow at 7:00am", or that it has been stopped. */
  next: string;
  on: boolean;
  /** What came of the last one, or null when it has not happened yet. */
  lastSaid: string | null;
};

/**
 * Everything that happens whether or not somebody is looking.
 *
 * Asked for by the window and pushed at it whenever it changes, because the
 * interesting case is precisely the one where the window was not there when it
 * did.
 */
export type Away = {
  pieces: readonly AwayPiece[];
  repeats: readonly Repeating[];
  /** How many go side by side. */
  atOnce: number;
  /** What all of it has cost so far, or null when nothing has been spent. */
  spent: Money | null;
  /** The one line over it when somebody comes back to it. Null when there is
   *  nothing worth saying. */
  sinceYouWere: string | null;
};

/** How often a thing asked for over and over happens. The window offers four,
 *  named after what somebody would say rather than after a rule. */
export type EveryKind = 'day' | 'weekday' | 'week' | 'month';

/** What is going on, and which project it belongs to. Same envelope, and same
 *  reason for it, as `AgentNotice`: a run can land for a folder somebody has
 *  switched away from, and it must not be drawn under another folder's name. */
export type AwayNotice = { project: string; away: Away };

/** How the next message should be handled. Both default off; the window turns
 *  the first on by itself when a request looks big enough to be worth a plan. */
export type PromptOptions = {
  /** Look around and propose, changing nothing, before anything is touched. */
  lookFirst?: boolean;
  /** The agent is already working and this message should wait its turn —
   *  delivered after the current run, never interrupting it. */
  queue?: 'followUp';
};

/** One model, named by the provider it belongs to and its own id. Both ids are
 *  the provider's own — the window stores them and never invents them. */
export type ModelChoice = { providerId: string; modelId: string };

/** The common names Pi uses for a model's supported reasoning depth. */
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** Make a model-specific preference key without treating two providers' ids as
 *  interchangeable. */
export function modelKey(choice: ModelChoice): string {
  return `${choice.providerId}/${choice.modelId}`;
}

/* -------------------------------------------------------------------------- */
/* Connecting an account                                                       */
/* -------------------------------------------------------------------------- */

/** The two ways to connect a provider: a subscription account, or a key from
 *  the provider's own site. Named after the thing the person does, not the
 *  protocol: "sign in" and "paste a key". */
export type ProviderMethod = 'oauth' | 'api-key';

/** One model a provider offers, and whether it can be used right now. */
export type ModelOption = {
  /** The provider's own id — e.g. 'claude-sonnet-4-5'. */
  id: string;
  /** The name people know it by. */
  label: string;
  /** True when the current account can actually use it. */
  available: boolean;
  /** Dollars per million tokens, as the provider quotes them. Null when the
   *  provider does not say — free and unpriced are different claims. */
  rates: { input: number; output: number } | null;
  /** How much it can hold at once, in tokens. Null when unstated. */
  contextWindow: number | null;
  /** Whether it reads pictures. Null when its catalogue entry does not say —
   *  not knowing and knowing it cannot are different claims. */
  takesImages?: boolean | null;
  /** The only depths this exact model accepts. Absent for older shell data. */
  thinking?: readonly ThinkingLevel[];
};

/** Everything the window knows about one provider: how to connect to it, and
 *  which of its models can be used. */
export type ProviderAuth = {
  /** e.g. 'anthropic'. */
  providerId: string;
  /** e.g. 'Anthropic'. */
  name: string;
  /** How this provider can be connected, in the order to offer them. */
  methods: readonly ProviderMethod[];
  /** The label on the sign-in option, e.g. 'Sign in with Claude Pro or Max'. */
  oauthLabel: string | null;
  /** The label on the API-key option, e.g. 'Anthropic API key'. */
  apiKeyLabel: string | null;
  /** True when an account is already connected on this computer. */
  connected: boolean;
  /** True when work could start right now. Differs from `connected` when the
   *  credential is there but something else is missing. */
  available: boolean;
  /** True when this account is paid for by its own plan rather than by use, so
   *  no per-use figure about it can be honest. */
  subscription: boolean;
  models: readonly ModelOption[];
};

/** The whole state of "who can think for me", asked for by the window and
 *  rebuilt by the shell each time — credentials change on another machine's
 *  login, and a stale list is worse than none. */
/** One other tool a project has plugged in. Four fields and no more: an entry
 *  can also hold an API key, and the window is not a place to keep one. Those
 *  stay in the file, and the shell carries them across a save. */
export type Connected = {
  name: string;
  /** The command that starts it, and anything passed to it. Machinery, and
   *  named as such: this is a view somebody opened on purpose. Empty when the
   *  tool is already running and `address` says where to reach it. */
  command: string;
  args: readonly string[];
  address?: string;
};

/** What one of them is doing, once somebody has asked. Never guessed — a tool
 *  nobody has checked is not the same as one that works. */
export type ConnectedHealth =
  | { state: 'unknown' }
  | { state: 'working'; tools: readonly string[] }
  | { state: 'would-not-start'; because: string };

/** Everything the panel needs: what is connected, where the list lives, and
 *  whether the list itself could be read. */
export type ConnectedState = {
  tools: readonly Connected[];
  /** The file, for the person who wants to open it themselves. */
  file: string;
  /** Why the list could not be read, when it could not. */
  trouble: string | null;
  /** Entries that were in the list and could not be used. */
  skipped: readonly string[];
};

export type ConnectionState = {
  providers: readonly ProviderAuth[];
  /** The model chosen to work with, or null for "whatever is available". */
  chosen: ModelChoice | null;
  /** The depth remembered for the selected model. */
  chosenThinking: ThinkingLevel;
};

/** One moment of connecting, sent to the window as it happens. A connection
 *  can take a minute — a browser round trip — and "it is working" is not a
 *  sentence until the person can see which of these it is. */
export type ConnectStep =
  | { type: 'auth-url'; url: string; instructions?: string }
  | {
      type: 'device-code';
      userCode: string;
      verificationUri: string;
      expiresInSeconds?: number;
    }
  | {
      type: 'prompt';
      /** Hand this back to `connectAnswer` with the person's answer. */
      promptId: string;
      kind: 'text' | 'secret' | 'select' | 'manual_code';
      message: string;
      placeholder?: string;
      options?: readonly { id: string; label: string }[];
    }
  | { type: 'progress'; message: string };

/** An account another tool has saved on this computer, offered so it can be
 *  carried over in one click instead of pasted twice. Only the parts the
 *  window may see travel: a name, a kind, and which tool saved it. */
export type FoundAccount = {
  /** The provider, in this app's own spelling — e.g. 'anthropic'. */
  providerId: string;
  /** The name people know the provider by — e.g. 'Anthropic'. */
  name: string;
  /** 'api-key' — a key pasted into opencode or Codex. 'sign-in' — a token
   *  from a subscription login (ChatGPT Plus, Copilot). */
  kind: 'api-key' | 'sign-in';
  /** Which tool's file it was read from, for the sentence about it. */
  source: 'opencode' | 'codex';
};

/** How a connection attempt ended. */
export type ConnectOutcome =
  | { kind: 'connected' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; because: string };

/**
 * What the escape hatches can offer on this machine.
 *
 * `editor` is the name of the first code editor found installed — "VS Code",
 * "Cursor" — or null when there is none, in which case the interface offers
 * only the folder. Worked out once by the shell; the window is not in a
 * position to know what is installed and should not guess.
 */
export type Hatches = { editor: string | null };

/**
 * A picture brought in to be shown to the agent.
 *
 * The bytes cross the wire as base64 because a structured clone would strip a
 * `File` to nothing once it leaves the renderer; the shell hands them on to
 * the session, which hands them to the model. `name` is only for the row of
 * attached things — it never leaves the window.
 */
export type PromptAttachment = {
  kind: 'image';
  /** The person's own file name, for showing. */
  name: string;
  /** e.g. 'image/png'. */
  mimeType: string;
  /** The picture, base64-encoded without the data: prefix. */
  bytes: string;
};

/** One installed skill Pi can use. A handle is the compact spelling accepted
 * by the composer — `@${handle}` — while `path` is only a clue for the reader,
 * never an argument that lets the renderer read arbitrary files. */
export type Skill = {
  id: string;
  name: string;
  handle: string;
  description: string;
  source: 'global' | 'project';
  path: string;
};

/** One way of working somebody can ask for with `/word`. The prompt body stays
 *  in the shell — the window only needs the command, what it does and what to
 *  put after it to list a `/` menu and hold the typed words. */
export type Workflow = {
  command: string;
  name: string;
  description: string;
  hint: string | null;
  source: 'global' | 'project';
};

/** One step of a document-to-build plan, as the window draws it. */
export type BuildTask = {
  n: number;
  title: string;
  acceptance: string;
  test: string | null;
  status: 'pending' | 'doing' | 'done' | 'failed';
  note: string | null;
};

/** A document-to-build plan, whole. */
export type BuildPlan = {
  /** What the document is called, said once at the top of the checklist. */
  source: string;
  tasks: readonly BuildTask[];
  /** The next task to work on, or null when the plan is done. */
  next: number | null;
  done: number;
  total: number;
};

/** One step the tracker takes as the build runs — picking up the next task,
 *  closing a finished one, or registering requirements the agent discovered
 *  along the way. */
export type BuildAdvance =
  | { kind: 'start' }
  | { kind: 'finish'; ok: boolean }
  | { kind: 'add'; titles: readonly string[] };

/**
 * What the overview panel knows about the project's folder.
 *
 * Anything that lives a folder away — exactly where it is in the world of
 * changes the agent is making — is found out here by the shell and handed over
 * whole, because the renderer has no Node and should not have to guess whether
 * a folder remembers its history.
 */
export type Overview = {
  /**
   * The folder's saved-state summary, or null when it is not one git knows
   * about — a folder that was never a repository has no branch and no history,
   * which is a fact about it rather than a problem.
   */
  git: GitSnapshot | null;
  /**
   * The projects inside this one — present only when the opened folder is a
   * plain folder holding several repositories beside each other (`backend/`,
   * `frontend/`). Absent for every folder that is itself one project, so
   * nothing about the ordinary case changes. Each child carries its own
   * snapshot; the parent's own `git` stays null, because the parent has none.
   */
  repos?: readonly RepoOverview[];
  /**
   * The address of the live preview being served for this folder, or null when
   * nothing is being served. The window shows its preview button only while
   * this is set — a preview that exists gets a button; one that does not gets
   * nothing.
   */
  preview: string | null;
  /** Things the last turn made that are worth looking at rather than reading. */
  artifacts: readonly Artifact[];
  /** Named colours out of a palette file the agent wrote, for real swatches. */
  swatches: readonly Swatch[];
  /** This project's design tokens, and the file they live in. */
  /** `text` is the stylesheet as written, so what drifted from these values can
   *  be worked out without reading the file twice. */
  styles: { file: string; tokens: readonly StyleToken[]; text: string } | null;
};

/** One project inside a folder that holds several: its name as the folder
 *  spells it, and its own saved-state summary read in its own folder. */
export type RepoOverview = {
  name: string;
  path: string;
  git: GitSnapshot;
};

/** What a project does without being asked, as the window shows it. */
export type AlwaysDoes = {
  /** The file it is all written in, so somebody can open it. */
  file: string;
  /** Every one, with the moment it runs at said in plain words. */
  rows: readonly { when: string; name: string; run: string }[];
  /** Present when the file itself will not read, so none of them are running. */
  trouble: string | null;
};

/** One thing a turn produced that a designer would look at. */
export type Artifact = {
  path: string;
  name: string;
  kind: 'image' | 'palette' | 'words' | 'data' | 'vector';
  note: string;
};

export type Swatch = { name: string; value: string };

/** One custom property in the project's own design tokens. */
export type StyleToken = {
  name: string;
  value: string;
  kind: 'colour' | 'space' | 'size' | 'radius' | 'shadow' | 'other';
  line: number;
  /** The values a slider should snap to, derived from the file's own scale. */
  steps: readonly string[];
  /** The stylesheet it was read from, so an edit lands in the same file. Left
   *  off (a fixture), an edit falls back to the project's primary sheet. */
  file?: string;
};

/* -------------------------------------------------------------------------- */
/* Staying in step with Figma                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The Figma file this project is kept in step with, and what has moved on in it
 * since the work was built from it.
 *
 * `following` is null when no file has been pointed at yet, which is the honest
 * empty state rather than a failure. `moved` empty means the two agree.
 */
export type InStep = {
  following: {
    id: string;
    /** What it is called on screen — the frame, or the file. */
    name: string;
    /** The address, so it can be opened where it lives. */
    url: string;
    /** Epoch ms, when it was last looked at. */
    readAt: number;
  } | null;
  moved: readonly Move[];
  /** The one line above the list. */
  says: string;
  /** Why the last look could not happen, or null. Already a sentence. */
  trouble: string | null;
};

/** One file that differs from the last saved version. */
export type ChangedFile = {
  /** Relative to the project folder, as the folder spells it. */
  path: string;
  kind: 'changed' | 'new';
};

/** One reading of the folder's saved state, at the moment it was asked for. */
/** One line of work this project keeps, as git sees it — named for the
 *  technical user who asked to see the branches. */
export type GitBranch = {
  /** The branch's own name. */
  name: string;
  /** True for the branch the project is on right now. */
  current: boolean;
  /** Where it tracks, e.g. origin/main; null when it tracks nowhere. */
  upstream: string | null;
  /** Saved work this branch has that its upstream does not. */
  ahead: number;
  /** Saved work its upstream has that this branch does not. */
  behind: number;
  /** The last commit's subject, so the list says what a branch is. */
  message: string;
};

export type GitSnapshot = {
  /** The branch, or null when no commit exists yet. */
  branch: string | null;
  /** Every branch in the project, the current one first, for the dev surface. */
  branches: readonly GitBranch[];
  /** True when saved work differs from what is on disk. */
  dirty: boolean;
  /** Files changed but not yet saved to the project's history. */
  unstaged: number;
  /** Files saved to history since the last mark but not yet committed. */
  staged: number;
  /** Files the folder holds that history knows nothing about. */
  untracked: number;
  /** Which files, by name, up to a limit. The panel names them rather than
   *  counting them: "3 files changed" is a number, `pricing.tsx` is a place. */
  files: readonly ChangedFile[];
  /** Saved work owned by this machine and not yet in the shared copy. */
  ahead: number;
  /** Saved work owned by the shared copy and not yet on this machine. */
  behind: number;
};

/**
 * The two sentences "See it" is allowed to say while it works.
 *
 * Here rather than in the shell because both sides say them: the window says
 * the first one the instant somebody presses the button, so the press has an
 * answer inside 100ms rather than after a folder has been read, and the shell
 * says both as it actually reaches them. Two copies of a sentence that must
 * match is exactly the sort of thing that stops matching.
 */
export const showWords = {
  gettingPieces: 'Getting the pieces your project needs…',
  puttingTogether: 'Putting your site together…',
  ready: 'Ready',
} as const;

/** When moving between conversations cannot happen. Both are reasons, not
 *  refusals: the thing asked for is still there once the reason has passed. */
export const swapWords = {
  busy: {
    what: 'Let me finish this thought first.',
    because:
      'I am part-way through answering. Moving to another conversation now would lose it — stop me if you would rather go anyway.',
    actionLabel: 'Got it',
  },
  unreadable: {
    what: 'I could not read that conversation back.',
    because:
      'It was written down, but nothing came back when I opened it. It may have been changed by something else while it was away.',
    actionLabel: 'Got it',
  },
} as const satisfies Record<string, Trouble>;

/** Said in a conversation that was put down to make room for another one. Only
 *  the view goes: it is still written down, and opening it again carries on. */
export const setDownWords = {
  said:
    'I have put this conversation down to make room for the ones you moved to. Nothing is lost — open it again and I will pick up where we left off.',
} as const;

/**
 * One event, and which project and conversation it belongs to.
 *
 * The envelope is the whole reason nothing leaks between projects. A reply that
 * started arriving for one folder must not land in the conversation of the one
 * somebody has just switched to, and the only process that knows which is which
 * is the one that owns the sessions. `project` is null only for something that
 * belongs to no folder at all; `conversation` is the `address` that conversation
 * was opened with, and absent for anything older than one.
 */
export type AgentNotice = {
  project: string | null;
  conversation?: string | null;
  event: AgentEvent;
};

/* -------------------------------------------------------------------------- */
/* Pull requests and issues, read for the Github screen                       */
/* -------------------------------------------------------------------------- */

/** One issue or pull request, as the reviews screen shows it. Drawn from the
 *  terminal's own `gh` JSON so the window never talks to github itself. */
export type RepoItem = {
  /** The number github gives it, and that `gh pr comment` wants. */
  number: number;
  kind: 'issue' | 'pr';
  title: string;
  /** Open, closed, merged … */
  state: string;
  /** The html url, for whenever somebody would rather open it in a browser. */
  url: string;
  /** The description, when there is one. */
  description: string | null;
  author: string;
  /** ISO time, newest first as gh returns it. */
  updatedAt: string;
  /** The base branch, for a pull request. */
  baseRef: string | null;
  /** The line of work a pull request is asking to merge, and the exact commit
   *  it is at. Null for an issue, and when github did not say. */
  headRef: string | null;
  headSha: string | null;
};

/** Everything the reviews screen needs about the project's github repository.
 *  Null when this folder is not a github repository, or `gh` is not logged in. */
export type RepoLook =
  | {
      /** `owner/name`, which is how github and gh address it. */
      full: string;
      owner: string;
      name: string;
      url: string;
      issues: readonly RepoItem[];
      prs: readonly RepoItem[];
      /** What this folder is actually on. A review reads files from somewhere,
       *  and telling it which line of work the folder is on is the difference
       *  between reading the pull request and reading whatever was open. */
      here: { branch: string | null; sha: string } | null;
      /** Why the lists are short, when github could not be asked. Null when it
       *  answered — and only then does an empty list mean there are none. */
      trouble: string | null;
    }
  | null;

/** Channel names. Namespaced so nothing else on the wire can be mistaken for
 *  ours, and centralised so preload and main cannot drift apart. */
export const CHANNEL = {
  openProject: 'graphe:open-project',
  prompt: 'graphe:prompt',
  stop: 'graphe:stop',
  waitForMe: 'graphe:wait-for-me',
  steer: 'graphe:steer',
  answer: 'graphe:answer',
  answerAsked: 'graphe:answer-asked',
  chooseFolder: 'graphe:choose-folder',
  event: 'graphe:event',
  overview: 'graphe:overview',
  recentProjects: 'graphe:recent-projects',
  forgetProject: 'graphe:forget-project',
  versions: 'graphe:versions',
  putBack: 'graphe:put-back',
  nameVersion: 'graphe:name-version',
  show: 'graphe:show',
  variationsServe: 'graphe:variations-serve',
  showProgress: 'graphe:show-progress',
  windowState: 'graphe:window-state',
  pointed: 'graphe:pointed',
  /** The page beside the conversation, saying what was clicked in it. Its own
   *  channel because it comes from the page's own world rather than the
   *  window's, and the two must never be mistaken for each other. */
  pagePointed: 'graphe:page-pointed',
  pages: 'graphe:pages',
  preferences: 'graphe:preferences',
  setShowMe: 'graphe:set-show-me',
  setShowFiles: 'graphe:set-show-files',
  projectFiles: 'graphe:project-files',
  fileText: 'graphe:file-text',
  keepVersion: 'graphe:keep-version',
  versionPictures: 'graphe:version-pictures',
  hatches: 'graphe:hatches',
  openInEditor: 'graphe:open-in-editor',
  revealFolder: 'graphe:reveal-folder',
  saveVersion: 'graphe:save-version',
  room: 'graphe:room',
  carried: 'graphe:carried',
  trustCarried: 'graphe:trust-carried',
  repoLook: 'graphe:repo-look',
  repoComment: 'graphe:repo-comment',
  stopAsking: 'graphe:stop-asking',
  goAsFarAs: 'graphe:go-as-far-as',
  running: 'graphe:running',
  stopRunning: 'graphe:stop-running',
  tidyNow: 'graphe:tidy-now',
  skills: 'graphe:skills',
  skillText: 'graphe:skill-text',
  workflows: 'graphe:workflows',
  alwaysDoes: 'graphe:always-does',
  branchSwitch: 'graphe:branch-switch',
  branchCreate: 'graphe:branch-create',
  worktreeLand: 'graphe:worktree-land',
  worktreeDrop: 'graphe:worktree-drop',
  buildStart: 'graphe:build-start',
  buildPlan: 'graphe:build-plan',
  buildAdvance: 'graphe:build-advance',
  buildSave: 'graphe:build-save',
  buildCancel: 'graphe:build-cancel',
  chooseDocument: 'graphe:choose-document',
  designCommit: 'graphe:design-commit',
  shareReview: 'graphe:share-review',
  checkWidths: 'graphe:check-widths',
  conversations: 'graphe:conversations',
  openConversation: 'graphe:open-conversation',
  closeConversation: 'graphe:close-conversation',
  deleteConversation: 'graphe:delete-conversation',
  copyConversation: 'graphe:copy-conversation',
  pageAt: 'graphe:page-at',
  pageHidden: 'graphe:page-hidden',
  watchStart: 'graphe:watch-start',
  watchStop: 'graphe:watch-stop',
  packages: 'graphe:packages',
  addPackage: 'graphe:add-package',
  removePackage: 'graphe:remove-package',
  explainPackage: 'graphe:explain-package',
  visualChange: 'graphe:visual-change',
  visualFrames: 'graphe:visual-frames',
  connection: 'graphe:connection',
  connect: 'graphe:connect',
  connectAnswer: 'graphe:connect-answer',
  cancelConnect: 'graphe:cancel-connect',
  disconnect: 'graphe:disconnect',
  selectModel: 'graphe:select-model',
  setThinking: 'graphe:set-thinking',
  spendSplit: 'graphe:spend-split',
  tokenUsage: 'graphe:token-usage',
  spendLimit: 'graphe:spend-limit',
  setSpendLimit: 'graphe:set-spend-limit',
  connectStep: 'graphe:connect-step',
  discoveredAccounts: 'graphe:discovered-accounts',
  importAccount: 'graphe:import-account',
  openLink: 'graphe:open-link',
  landing: 'graphe:landing',
  setHoldBack: 'graphe:set-hold-back',
  setKeepLogins: 'graphe:set-keep-logins',
  setTheme: 'graphe:set-theme',
  setHowMuch: 'graphe:set-how-much',
  decideOnWork: 'graphe:decide-on-work',
  handToDeveloper: 'graphe:hand-to-developer',
  putOnline: 'graphe:put-online',
  connectedLook: 'graphe:connected-look',
  connectedCheck: 'graphe:connected-check',
  connectedSave: 'graphe:connected-save',
  takeBackQueue: 'graphe:take-back-queue',
  changesLook: 'graphe:changes-look',
  changesDrop: 'graphe:changes-drop',
  away: 'graphe:away',
  awayEverywhere: 'graphe:away-everywhere',
  keepGoing: 'graphe:keep-going',
  startAfter: 'graphe:start-after',
  putAfter: 'graphe:put-after',
  stopAway: 'graphe:stop-away',
  keepAway: 'graphe:keep-away',
  answerAway: 'graphe:answer-away',
  sayToAway: 'graphe:say-to-away',
  compareWays: 'graphe:compare-ways',
  keepSet: 'graphe:keep-set',
  addRepeat: 'graphe:add-repeat',
  switchRepeat: 'graphe:switch-repeat',
  forgetRepeat: 'graphe:forget-repeat',
  awayChanged: 'graphe:away-changed',
  buildPlanChanged: 'graphe:build-plan-changed',
  inStep: 'graphe:in-step',
  followDesign: 'graphe:follow-design',
  lookAgain: 'graphe:look-again',
  caughtUp: 'graphe:caught-up',
  stopFollowing: 'graphe:stop-following',
} as const;

/**
 * Everything the window may ask the shell to do. All of it.
 *
 * There is no `invoke(channel, ...args)` here on purpose. A generic escape hatch
 * would mean the renderer — the one process that loads other people's HTML,
 * other people's CSS and, one day, other people's previews — could reach any
 * handler the main process has ever registered. A dozen named verbs can still be
 * read in one sitting and audited in another; a wildcard never can.
 *
 * Everything that happens to one project takes a trailing `where`. Leaving it
 * out means the project in front and the conversation in front of it, so a
 * window that names nothing behaves exactly as it always has.
 */
export type GrapheApi = {
  /** Work in this folder from now on. A folder that is already open is resumed
   *  exactly where it was left, conversation and spend included. */
  openProject(path: string): Promise<Result<OpenedProject>>;
  /** Say something to the agent, with any pictures that go with it. Resolves
   *  when it has finished responding. */
  prompt(
    text: string,
    attachments?: readonly PromptAttachment[],
    options?: PromptOptions,
    where?: Where,
  ): Promise<Result<null>>;
  /** Stop what it is doing. Open questions are answered no. */
  stop(where?: Where): Promise<Result<null>>;
  /** Hold the run between steps so you can take the machine back, or let it go
   *  on. Not stopping: the turn stays where it is and picks up from wherever
   *  things are when it is let go. */
  waitForMe(on: boolean, where?: Where): Promise<Result<null>>;
  /** Put a message into the turn already in flight, without stopping it. The
   *  agent hears it between tool calls and carries on — the "insert into the
   *  loop" move. */
  steer(text: string, where?: Where): Promise<Result<null>>;
  /** Answer a question the Guard asked. False when there was no such question. */
  answer(callId: string, decision: Decision, where?: Where): Promise<Result<boolean>>;
  /** Answer the questions put before the work started. Null answers is a real
   *  answer — somebody saying to decide for them. */
  answerAsked(
    id: string,
    answers: Readonly<Record<string, readonly string[]>> | null,
    where?: Where,
  ): Promise<Result<boolean>>;
  /** Ask the person to pick a folder. Null when they closed the picker. */
  chooseFolder(): Promise<Result<string | null>>;

  /** The projects this computer remembers, newest first. */
  recentProjects(): Promise<Result<readonly RecentProject[]>>;

  /** What the open project's folder looks like right now — its branch, its
   *  saved state, how it stands against the shared copy. Empty git, not an
   *  error, when the folder is not a repository. */
  overview(where?: Where): Promise<Result<Overview>>;
  /** Take a project off that list. The folder itself is never touched. */
  forgetProject(path: string): Promise<Result<readonly RecentProject[]>>;

  /** Every version of the open project, newest first. Empty before anything has
   *  been saved, and empty — not a failure — when no project is open. */
  versions(where?: Where): Promise<Result<readonly SavedVersion[]>>;
  /** Everything about a project's github repository, read from the terminal's
   *  own `gh` — the issues and pull requests of this codebase. Null when the
   *  folder is not a github repository or `gh` is not set up. */
  repoLook(where?: Where): Promise<Result<RepoLook>>;
  /** Ask the terminal's `gh pr comment` to speak for the current person. */
  repoComment(number: number, body: string, where?: Where): Promise<Result<null>>;
  /** Put the project back to a version. Undoable; see `PutBack`. */
  putBack(versionId: string, where?: Where): Promise<Result<PutBack>>;
  /** Give a version a name of the user's own. */
  nameVersion(versionId: string, name: string, where?: Where): Promise<Result<readonly SavedVersion[]>>;
  /** What each version of the open project looked like, by id, as data URIs. A
   *  version with no picture is simply absent — never a stand-in. */
  versionPictures(where?: Where): Promise<Result<Readonly<Record<string, string>>>>;

  /** What this person has chosen, as remembered on this computer. */
  preferences(): Promise<Result<Preferences>>;
  /** Turn "Show me" on or off. Returns the whole set, so the window never has
   *  to reason about what it did not ask about. */
  setShowMe(on: boolean): Promise<Result<Preferences>>;
  /** Keep a version at the top of the rail, or stop keeping it. Against the
   *  project in front, and returns the whole set for the same reason
   *  `setShowMe` does. */
  keepVersion(versionId: string, keep: boolean, where?: Where): Promise<Result<Preferences>>;
  /** Show everything the project holds, or stop showing it. Sticky, like
   *  "Show me". */
  setShowFiles(on: boolean): Promise<Result<Preferences>>;

  /** Everything the open project holds, with each file's size and whether this
   *  version touched it. Empty — never a failure — when nothing is open. The
   *  walk is bounded, so a folder of somebody else's machinery costs a moment
   *  rather than the window. */
  projectFiles(where?: Where): Promise<Result<readonly FileEntry[]>>;
  /** One file of the open project, as text. A location outside the project, a
   *  file too big to read, or one that is not text comes back as a sentence
   *  rather than as bytes. */
  fileText(path: string, where?: Where): Promise<Result<string>>;

  /** What the escape hatches can offer here — which editor, if any. */
  hatches(): Promise<Result<Hatches>>;
  /** Open the project in the editor `hatches` named, or one file inside it. */
  openInEditor(file?: string, where?: Where): Promise<Result<null>>;
  /** Save a version of the project right now, named by the person if they
   *  bothered. Returns the timeline as it now stands. */
  saveVersion(name?: string, where?: Where): Promise<Result<readonly SavedVersion[]>>;
  /** How full this conversation is. Null before the model has answered once. */
  room(where?: Where): Promise<Result<Room | null>>;
  /** Shorten it now. Answers with the room there is afterwards. */
  tidyNow(where?: Where): Promise<Result<Room | null>>;
  /** The installed instruction packs available to this project and computer. */
  skills(where?: Where): Promise<Result<readonly Skill[]>>;
  /** The `/word` ways of working this project can ask for. */
  workflows(where?: Where): Promise<Result<readonly Workflow[]>>;
  /** The commands this project runs without being asked, and where they are
   *  written down. Empty for a project that has written none. */
  alwaysDoes(where?: Where): Promise<Result<AlwaysDoes>>;
  /** Start a document-to-build: name a document and an optional instruction,
   *  and the shell turns it into a plan. */
  buildStart(source: { name: string; text: string; instruction?: string }, where?: Where): Promise<Result<BuildPlan>>;
  /** The current build plan, or null when none is under way. */
  buildPlan(where?: Where): Promise<Result<BuildPlan | null>>;
  /** Advance the build tracker one turn: close the task a settled turn just
   *  finished (done or failed), or add tasks for requirements found while
   *  building. */
  buildAdvance(op: BuildAdvance, where?: Where): Promise<Result<BuildPlan | null>>;
  /** Record the plan the agent produced into the stored build-plan, so a
   *  resumed session has the real task list. */
  buildSave(tasks: readonly { title: string; acceptance: string }[], where?: Where): Promise<Result<BuildPlan | null>>;
  /** Cancel the current build checklist and clear it from the screen. */
  buildCancel(where?: Where): Promise<Result<null>>;
  /** Pick a requirements document on disk and read its text, or null if closed. */
  chooseDocument(where?: Where): Promise<Result<{ name: string; text: string } | null>>;
  /** Move the project onto another of its lines of work. Refuses while the
   *  current work is not yet saved. */
  branchSwitch(name: string, where?: Where): Promise<Result<null>>;
  /** Start a new line of work and move the project onto it. */
  branchCreate(name: string, where?: Where): Promise<Result<null>>;
  /** Merge the front conversation's own branch back, and drop the checkout. */
  worktreeLand(where?: Where): Promise<Result<null>>;
  /** Throw the front conversation's own checkout away, branch and all. */
  worktreeDrop(where?: Where): Promise<Result<null>>;
  /** Full text for a library row. `id` is checked against that library first. */
  skillText(id: string, where?: Where): Promise<Result<string>>;
  /** Stop checking before things that would otherwise be asked about, or start
   *  again. Answers with what is true afterwards. */
  stopAsking(on: boolean, where?: Where): Promise<Result<boolean>>;
  /** Set how far it may go before it stops and asks. Answers with the rung it
   *  is actually on afterwards. */
  goAsFarAs(howFar: HowFar, where?: Where): Promise<Result<HowFar>>;
  /** What is being kept running in this conversation — servers, watchers. */
  running(where?: Where): Promise<Result<readonly RunningPiece[]>>;
  /** Stop one of them. Answers with what is left. */
  stopRunning(id: string, where?: Where): Promise<Result<readonly RunningPiece[]>>;
  /** What the open project carries, and whether each one is being loaded. */
  carried(where?: Where): Promise<Result<readonly CarriedExtension[]>>;
  /** Start loading one of them, or stop. Answers with the list as it stands. */
  trustCarried(id: string, trust: boolean, where?: Where): Promise<Result<readonly CarriedExtension[]>>;
  /** Show the project folder in the Finder. Always available: every project is
   *  an ordinary folder, and this is the one hatch that cannot fail to exist. */
  revealFolder(where?: Where): Promise<Result<null>>;

  /** Make the project, then open the made thing in their own browser. `at` opens
   *  one page of it rather than its front door. */
  show(at?: string, point?: boolean, where?: Where): Promise<Result<ShowOutcome>>;
  /** Make ready every variation in a set at once, each served on its own address
   *  so they can be compared in the pane. `where` names the project in front. */
  variationsServe(parts: { subject: string; variations: readonly VariationSpec[] }, where?: Where): Promise<Result<VariationsOutcome>>;
  /** Somebody clicked an element, in their own browser or in the page beside
   *  the conversation. Read against the project before it gets here. */
  onPointed(listener: (at: PointedAt) => void): () => void;
  /** The screens this project has, for the rail. Empty when the shape of the
   *  folder is not one we recognise — a guess would send people nowhere. */
  pages(where?: Where): Promise<Result<readonly Page[]>>;
  /** How the window is sitting. Full screen takes the traffic lights away, so
   *  the layout stops reserving room for them. */
  onWindowState(listener: (state: WindowState) => void): () => void;

  /** Write a read-only page of what changed, for somebody who is not you.
   *  Returns where it was written, or null when the save was cancelled. */
  shareReview(where?: Where): Promise<Result<string | null>>;
  /** Photograph the project at phone, tablet and desktop width. */
  checkWidths(where?: Where): Promise<Result<{ looks: readonly Look[]; says: string }>>;

  /** The conversations this project has had, newest first. */
  conversations(where?: Where): Promise<Result<readonly Conversation[]>>;
  /** Open one of them, or start a fresh one when given null. Comes back with
   *  the conversation replayed as events, the same as opening a project. */
  openConversation(path: string | null, where?: Where): Promise<Result<OpenedProject>>;
  /** Put one down. Only the view closes — it stays written down, and opening it
   *  again carries on from where it was left. Optional, so a bridge with no way
   *  to close one is still a whole bridge. */
  /** Put a conversation down without losing it. Opening it again resumes. */
  closeConversation(where?: Where): Promise<Result<null>>;
  /** Throw a conversation away. The file on disk goes; the project does not. */
  deleteConversation(path: string, where?: Where): Promise<Result<readonly Conversation[]>>;

  /** A second copy of a conversation, so another direction can be tried without
   *  losing the one it came from. Hands back the copy's own file. */
  copyConversation(path: string, where?: Where): Promise<Result<string>>;
  /** Point the page at an address and glue it to a rectangle in the window.
   *  A null rectangle closes it. */
  /** Where the page is drawn, and what it shows. Moving it never reloads it:
   *  the box is reported whenever the window changes shape, and a turn full of
   *  tool calls changes it many times. `again` is the reload press. */
  pageAt(
    address: string | null,
    bounds: { x: number; y: number; width: number; height: number } | null,
    again?: boolean,
  ): Promise<Result<null>>;
  /** Take the page out of the way while something is drawn over it. */
  pageHidden(hidden: boolean): Promise<Result<null>>;
  /** Watch how somebody uses the page, capturing every state with the thing
   *  that produced it. `says` is what they are trying, in their own words. */
  watchStart(says?: string): Promise<Result<null>>;
  /** Stop watching and keep what was seen. Null when nothing was. */
  watchStop(): Promise<Result<Recording | null>>;

  /** What can be added to Graphe. A search term looks past the ones we ship. */
  packages(term?: string): Promise<Result<readonly Pack[]>>;
  addPackage(id: string): Promise<Result<readonly Pack[]>>;
  removePackage(id: string): Promise<Result<readonly Pack[]>>;
  /** Two plain sentences on what one does, written by the model. */
  explainPackage(id: string, where?: Where): Promise<Result<string>>;
  /** Write every design change the window has been holding and save it as one
   *  version. `tokens` renames to real names with the value each is set to;
   *  `motions` are the shapes `src/motion/read.ts` hands out. Nothing is
   *  written on the way to this — the design view stays untracked until asked. */
  designCommit(
    changes: DesignChange,
    where?: Where,
  ): Promise<Result<readonly SavedVersion[]>>;
  /** Follow along while that happens. Returns the function that stops. */
  onShowProgress(listener: (progress: ShowProgress) => void): () => void;

  /** Listen to the agent. Returns the function that stops listening. */
  onEvent(listener: (notice: AgentNotice) => void): () => void;

  /** The full-size before and after for one change. Asked for when somebody
   *  opens the strip, and not before — see `VisualChange`. */
  visualFrames(changeId: string): Promise<Result<VisualFrames>>;
  /** A before and after has been worked out. Returns the function that stops
   *  listening. */
  onVisualChange(listener: (notice: VisualNotice) => void): () => void;

  /** Everything the window knows about who can think for it. */
  /** Who can think for this computer. `fresh` re-reads the model catalogue off
   *  disk, for the moment somebody has just added one somewhere else. */
  connection(fresh?: boolean): Promise<Result<ConnectionState>>;
  /** Sign in to a provider, or paste its API key. Follows along while it
   *  happens via `onConnectStep`; ask for `connectAnswer` when a step asks a
   *  question. Resolves when the whole attempt is over. */
  connect(providerId: string, method: ProviderMethod): Promise<Result<ConnectOutcome>>;
  /** The answer to a question asked while connecting. Null cancels it. */
  connectAnswer(promptId: string, value: string | null): Promise<Result<null>>;
  /** Stop the connection in progress. */
  cancelConnect(): Promise<Result<null>>;
  /** Forget the account for one provider. The provider's own tokens are
   *  removed from this computer. */
  disconnect(providerId: string): Promise<Result<null>>;
  /** Choose which model to work with. Returns the whole set of preferences. */
  selectModel(choice: ModelChoice, where?: Where): Promise<Result<Preferences>>;
  /** Let this exact model take more or less time before it answers. */
  setThinking(choice: ModelChoice, level: ThinkingLevel, where?: Where): Promise<Result<Preferences>>;
  /** Where the money went in this project, asked for rather than waited for.
   *  Null when nothing has been spent yet. */
  spendSplit(where?: Where): Promise<Result<SpendSummary | null>>;
  /** Tokens through the model, one day at a time, read from this computer's
   *  own session transcripts. Null when there are none to read. */
  tokenUsage(): Promise<Result<TokenUsageView | null>>;
  /** The ceiling somebody set on spending, or null when they have not set one. */
  spendLimit(): Promise<Result<SpendLimit | null>>;
  /** Set it, raise it, or take it away with null. Answers with what is held. */
  setSpendLimit(ceiling: Money | null): Promise<Result<SpendLimit | null>>;
  /** Follow along with a connection while it happens. Returns the function
   *  that stops listening. */
  onConnectStep(listener: (step: ConnectStep) => void): () => void;
  /** The accounts opencode and Codex have saved on this computer — the ones
   *  a person can carry over instead of connecting again. Nothing secret is
   *  ever part of the answer. */
  discoveredAccounts(): Promise<Result<readonly FoundAccount[]>>;
  /** Carry one of the discovered accounts into this app's own store. */
  importAccount(account: FoundAccount): Promise<Result<null>>;
  /** Open a link in the person's own browser, never inside this window. */
  openLink(url: string): Promise<Result<null>>;

  /** What can be done with this project's work, and what is waiting. */
  landing(where?: Where): Promise<Result<Landing>>;
  /** Check new work in a copy before it reaches the files. Sticky. */
  setHoldBack(on: boolean, where?: Where): Promise<Result<Preferences>>;
  /** Keep this project's browser signed in between sittings, or stop keeping
   *  it. Off keeps nothing and starts every browser clean. */
  setKeepLogins(on: boolean, where?: Where): Promise<Result<Preferences>>;
  setTheme(theme: Theme): Promise<Result<Preferences>>;
  /** Move the line a picture has to cross before the work is stopped. One of
   *  `HOW_MUCH` in `src/design/gate.ts`. Sticky. */
  setHowMuch(id: string): Promise<Result<Preferences>>;
  /** Let the work that is waiting in, or set it aside. Both are undoable —
   *  letting it in through `putBack`, setting it aside by deciding again.
   *  `observed` is true only for a person's explicit press. Auto-clear may let
   *  work in, but it must not move the picture the next change is measured
   *  against: only a picture somebody actually saw can become agreed. */
  decideOnWork(letIn: boolean, observed: boolean, where?: Where): Promise<Result<Decided>>;

  /**
   * Write up what changed and put the work where a developer picks it up.
   *
   * Nothing leaves this computer unless `confirmed` is true, and the window
   * only passes true from a press that has already said what will happen.
   */
  handToDeveloper(confirmed: boolean, where?: Where): Promise<Result<HandedOver>>;
  /** Put the finished project on the internet. Same rule about `confirmed`,
   *  and the same reason for it. */
  putOnline(confirmed: boolean, where?: Where): Promise<Result<WentOnline>>;

  /* ---------------------------------------------- while you are not looking */

  /** The other tools this project has plugged in, and whether its list reads. */
  connectedLook(where?: Where): Promise<Result<ConnectedState>>;
  /** Start one, ask what it offers, and stop it again. Only ever on a press. */
  connectedCheck(name: string, where?: Where): Promise<Result<ConnectedHealth>>;
  /** Write the whole list back. */
  connectedSave(tools: readonly Connected[], where?: Where): Promise<Result<ConnectedState>>;

  /** Everything changed in the folder and not saved yet, as a diff to read. */
  changesLook(where?: Where): Promise<Result<string>>;
  /** Take the named parts back out. The patch is what to undo, not what to keep. */
  changesDrop(patch: string, where?: Where): Promise<Result<null>>;

  /** Take everything waiting behind the run back, so it can be rewritten. What
   *  comes back is what was queued, in the order it was asked for. */
  takeBackQueue(where?: Where): Promise<Result<{ steering: readonly string[]; followUp: readonly string[] }>>;

  /** Everything happening for this project whether or not the window is open. */
  away(where?: Where): Promise<Result<Away>>;

  /** The same, for every project at once — work does not stop because somebody
   *  switched folders, and until this there was nowhere to see that. */
  awayEverywhere(): Promise<Result<readonly AwayNotice[]>>;
  /** Start a piece of work that carries on with the window closed. It runs in
   *  its own copy, so the folder on screen is untouched until it is kept.
   *  `untilDone` is the overnight mode: full access, no questions, wall clock. */
  keepGoing(text: string, untilDone?: boolean, where?: Where): Promise<Result<Away>>;
  /**
   * The same, but it waits until another has finished before it starts.
   *
   * Refused with a sentence, there and then, when the two would end up waiting
   * for each other — a plan that could never run is not written down.
   */
  startAfter(text: string, after: string, where?: Where): Promise<Result<Away>>;
  /** Make one that has not started yet wait for another, or let it off its wait
   *  with null. Refused the same way, for the same reason. */
  putAfter(id: string, after: string | null, where?: Where): Promise<Result<Away>>;
  /** Stop one, or let its result go. Same door for both, because what it means
   *  depends only on whether it had finished. */
  stopAway(id: string, where?: Where): Promise<Result<Away>>;
  /** Take one's result into the project. A version like any other, so it can be
   *  put back like any other. */
  keepAway(id: string, where?: Where): Promise<Result<Away>>;
  /**
   * Answer the question one of them stopped on.
   *
   * The only thing on this bridge that can resolve one. Nothing on the other
   * side ever answers its own — a run with nobody watching stops and waits.
   */
  answerAway(id: string, callId: string, decision: Decision, where?: Where): Promise<Result<Away>>;
  /**
   * Say something to a piece of work that is already going.
   *
   * It hears it between one step and the next and carries on from there —
   * nothing is stopped and nothing is lost. This is the difference between
   * watching something go the wrong way and being able to say so.
   */
  sayToAway(id: string, text: string, where?: Where): Promise<Result<Away>>;
  /**
   * The several goes at one job, each with what it changed.
   *
   * Read on the press, never kept: a go that is still working has a different
   * answer a minute later, and a stale one would be read as the real thing.
   */
  compareWays(ways: string, where?: Where): Promise<Result<readonly SideOfWork[]>>;
  /**
   * Take several finished pieces into the project, in the order they need.
   *
   * One press rather than N: they were meant to arrive in an order, and going
   * in one at a time by hand is how that order gets lost. Whatever happens, the
   * whole run is one version away from never having happened.
   */
  keepSet(ids: readonly string[], where?: Where): Promise<Result<Away>>;
  /** Ask for something over and over: what to do, how often, and at what time. */
  addRepeat(
    doing: string,
    every: EveryKind,
    at: { hour: number; minute: number },
    on?: number,
    where?: Where,
  ): Promise<Result<Away>>;
  /** Stop one happening, or start it again. What was typed is kept either way. */
  switchRepeat(id: string, on: boolean, where?: Where): Promise<Result<Away>>;
  /** Forget one entirely. */
  forgetRepeat(id: string, where?: Where): Promise<Result<Away>>;
  /** Follow along while any of that changes, including while the window was
   *  away and has just come back. Returns the function that stops listening. */
  onAway(listener: (notice: AwayNotice) => void): () => void;
  /** The checklist moved while a reply was still going — the model ticked
   *  something off. Without this the list only catches up when the reply ends,
   *  which is exactly when nobody is still watching it. */
  onBuildPlan(listener: (notice: { project: string; plan: BuildPlan | null }) => void): () => void;

  /* ----------------------------------------------- staying in step with Figma */

  /** What this project is keeping in step with, and what has moved on since the
   *  work was built from it. Nothing followed is an empty answer, not a
   *  failure. */
  inStep(where?: Where): Promise<Result<InStep>>;
  /** Keep this project in step with the Figma file behind a pasted address.
   *  What is read now becomes what the work was built from. */
  followDesign(address: string, where?: Where): Promise<Result<InStep>>;
  /** Read the file again and say what differs. */
  lookAgain(where?: Where): Promise<Result<InStep>>;
  /** Take what is in Figma now as what the work was built from, once the work
   *  has caught up with it. */
  caughtUp(where?: Where): Promise<Result<InStep>>;
  /** Stop following it. Nothing in Figma is touched. */
  stopFollowing(where?: Where): Promise<Result<InStep>>;
};
