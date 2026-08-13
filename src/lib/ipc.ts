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

import type { AgentEvent, Money, SpendSummary } from '../agent/types';
import type { HowFar } from '../agent/guard/policy';
import type { Frame, Recording } from '../diff/flow';
import type { SpendLimit } from '../cost/limits';
import type { Move } from '../design/moved';
import type { Held } from '../diff/holdshot';
import type { FileEntry } from '../files/tree';
import type { Page } from '../preview/pages';
import type { Reading } from '../preview/inspect';
import type { Pointed } from '../preview/point';
import type { WorkState } from '../work/board';

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
  if (!keys.every((key) => key === 'project' || key === 'conversation')) return {};
  const where: Where = {};
  const project = fields['project'];
  const conversation = fields['conversation'];
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
export type Room = {
  used: number;
  total: number;
  /** The two above as a fraction, 0 to 1. */
  part: number;
};

/**
 * One entry in the version timeline, as the window draws it.
 *
 * Deliberately not `history/timeline`'s own `Version`. That type belongs to a
 * module that spawns processes and reads folders; this one crosses a structured
 * clone into a sandbox, and the seam between them is the point of this file.
 */
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
  | { kind: 'showing'; name: string }
  | { kind: 'unsure'; question: string };

/**
 * Somebody pointed at something in their own page.
 *
 * The whole reading travels, not a sentence about it. The shell is the only side
 * that can read the project the element came out of — its values, where each
 * component is used, what last touched the file — so it decides there and the
 * window draws what it is handed. `says` is the same click as one line, for the
 * composer, so nothing has to derive it twice.
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
  /** Do the work in a copy first and show it, rather than letting it reach the
   *  files straight away. Off by default and sticky once asked for. */
  holdBack: boolean;
  /** The ceiling somebody set on spending, or null when they have not set one.
   *  Remembered across launches: a ceiling that forgets itself is not one. */
  ceiling: Money | null;
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

/** One thing a turn produced that a designer would look at. */
export type Artifact = {
  path: string;
  name: string;
  kind: 'image' | 'palette' | 'words' | 'data' | 'vector';
  note: string;
};

export type Swatch = { name: string; value: string };

/** One custom property in the project's own token file. */
export type StyleToken = {
  name: string;
  value: string;
  kind: 'colour' | 'space' | 'size' | 'radius' | 'shadow' | 'other';
  line: number;
  /** The values a slider should snap to, derived from the file's own scale. */
  steps: readonly string[];
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
export type GitSnapshot = {
  /** The branch, or null when no commit exists yet. */
  branch: string | null;
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

/** Channel names. Namespaced so nothing else on the wire can be mistaken for
 *  ours, and centralised so preload and main cannot drift apart. */
export const CHANNEL = {
  openProject: 'graphe:open-project',
  prompt: 'graphe:prompt',
  stop: 'graphe:stop',
  answer: 'graphe:answer',
  chooseFolder: 'graphe:choose-folder',
  event: 'graphe:event',
  overview: 'graphe:overview',
  recentProjects: 'graphe:recent-projects',
  forgetProject: 'graphe:forget-project',
  versions: 'graphe:versions',
  putBack: 'graphe:put-back',
  nameVersion: 'graphe:name-version',
  show: 'graphe:show',
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
  stopAsking: 'graphe:stop-asking',
  goAsFarAs: 'graphe:go-as-far-as',
  tidyNow: 'graphe:tidy-now',
  nudgeToken: 'graphe:nudge-token',
  nudgeMotion: 'graphe:nudge-motion',
  shareReview: 'graphe:share-review',
  checkWidths: 'graphe:check-widths',
  conversations: 'graphe:conversations',
  openConversation: 'graphe:open-conversation',
  closeConversation: 'graphe:close-conversation',
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
  spendLimit: 'graphe:spend-limit',
  setSpendLimit: 'graphe:set-spend-limit',
  connectStep: 'graphe:connect-step',
  discoveredAccounts: 'graphe:discovered-accounts',
  importAccount: 'graphe:import-account',
  openLink: 'graphe:open-link',
  landing: 'graphe:landing',
  setHoldBack: 'graphe:set-hold-back',
  decideOnWork: 'graphe:decide-on-work',
  handToDeveloper: 'graphe:hand-to-developer',
  putOnline: 'graphe:put-online',
  away: 'graphe:away',
  keepGoing: 'graphe:keep-going',
  startAfter: 'graphe:start-after',
  putAfter: 'graphe:put-after',
  stopAway: 'graphe:stop-away',
  keepAway: 'graphe:keep-away',
  answerAway: 'graphe:answer-away',
  addRepeat: 'graphe:add-repeat',
  switchRepeat: 'graphe:switch-repeat',
  forgetRepeat: 'graphe:forget-repeat',
  awayChanged: 'graphe:away-changed',
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
  /** Answer a question the Guard asked. False when there was no such question. */
  answer(callId: string, decision: Decision, where?: Where): Promise<Result<boolean>>;
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
  /** Stop checking before things that would otherwise be asked about, or start
   *  again. Answers with what is true afterwards. */
  stopAsking(on: boolean, where?: Where): Promise<Result<boolean>>;
  /** Set how far it may go before it stops and asks. Answers with the rung it
   *  is actually on afterwards. */
  goAsFarAs(howFar: HowFar, where?: Where): Promise<Result<HowFar>>;
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
  /** Point the page at an address and glue it to a rectangle in the window.
   *  A null rectangle closes it. */
  pageAt(address: string | null, bounds: { x: number; y: number; width: number; height: number } | null): Promise<Result<null>>;
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
  /** Change one design token and save the result as a version. */
  nudgeToken(name: string, value: string, where?: Where): Promise<Result<readonly SavedVersion[]>>;
  /** Change how long something takes, or how it starts and stops. The places
   *  and the change are the shapes `src/motion/read.ts` hands out. */
  nudgeMotion(
    places: readonly unknown[],
    change: unknown,
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
  connection(): Promise<Result<ConnectionState>>;
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
  setHoldBack(on: boolean): Promise<Result<Preferences>>;
  /** Let the work that is waiting in, or set it aside. Both are undoable —
   *  letting it in through `putBack`, setting it aside by deciding again. */
  decideOnWork(letIn: boolean, where?: Where): Promise<Result<Decided>>;

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

  /** Everything happening for this project whether or not the window is open. */
  away(where?: Where): Promise<Result<Away>>;
  /** Start a piece of work that carries on with the window closed. It runs in
   *  its own copy, so the folder on screen is untouched until it is kept. */
  keepGoing(text: string, where?: Where): Promise<Result<Away>>;
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
