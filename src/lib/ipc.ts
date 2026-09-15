import type { ExtensionAnswer, ExtensionAsk } from './extension-ask';

export type { ExtensionAnswer, ExtensionAsk };
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

import type { Appearance } from '../design/appearance';

export type { Appearance };
import type { AgentEvent, Money, RunningPiece, SpendSummary } from '../agent/types';

export type { RunningPiece } from '../agent/types';
import type { HowFar } from '../agent/guard/policy';
import type { SessionState } from '../domain/conversations';
import type { Theme } from './theme';
import type { SpendLimit } from '../cost/limits';
import type { FileEntry } from '../files/tree';
import type { Page } from '../preview/pages';
import type { Pointed } from '../preview/point';
import type { Said } from '../preview/tabs';
export type { Said };
import type { AlwaysRow } from '../work/always';
import type { ComputerUse } from '../work/computeruse';
import type { Goal } from '../work/goal';
import type { Telling } from '../work/notify';

export type { ComputerUse } from '../work/computeruse';
export type { AlwaysRow };
import type { WorkState } from '../work/board';
import type { Entry as ReviewQueued, FileVerdict, Verdict } from '../work/reviewqueue';
import type { WorkspaceFacts } from '../work/workspaces';
import type { Landing as HowItLands } from '../history/worktree';
import type { Dependencies, InstallPlan, SetupCandidate } from '../projects/setup';
import type { TokenUsageView } from '../lib/token-days';

export type { Dependencies, InstallPlan, SetupCandidate } from '../projects/setup';

export type { TokenUsageView } from '../lib/token-days';

/** One conversation's copy of the project, as the panel's card is made from. */
export type { WorkspaceFacts } from '../work/workspaces';

export type {
  FileEntry,
  HowFar,
  Money,
  Page,
  Pointed,
  SpendLimit,
  SpendSummary,
  WorkState,
};

/** Yes or no, from a person. Same two answers the Guard accepts, and no third. */
export type Decision = 'yes' | 'no';

/** Everything the open project holds, and the revision it was read at. */
export type FilesRead = {
  files: readonly FileEntry[];
  /** The folder, and every name and size in the listing. A read whose revision
   *  no longer matches is of a folder that has since changed, so what is on
   *  screen is not what is there. */
  revision: string;
};

/** One file's bytes, and the revision they were read at.
 *
 * `changed` is true when the reader held an earlier revision and the file no
 * longer matches it: the text here is the file as it is now, not the text they
 * were reading. */
export type TextRead = { path: string; text: string; revision: string; changed: boolean };

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
  // A child name is a folder name, not a path. One with a separator or a
  // control character in it is refused rather than flattened: taking the slash
  // out of "a/b" makes "ab", which is a different project that might exist.
  // Spaces stay, because "my app" is a folder somebody really has.
  const repo = typeof fields['repo'] === 'string' ? fields['repo'].trim() : '';
  // eslint-disable-next-line no-control-regex
  if (repo !== '' && repo.length <= 80 && !/[/\\\u0000-\u001f\u007f]/.test(repo)) {
    where.repo = repo;
  }
  if (typeof project === 'string' && project.trim() !== '') where.project = project;
  if (typeof conversation === 'string' && conversation.trim() !== '') {
    where.conversation = conversation;
  }
  return where;
}

/** A project folder, as the window refers to it. */
/**
 * What a New worktree would do, in the words a dialog can show.
 *
 * Nothing is created by asking: the folder, the base and the commit are all
 * read, so somebody can see where the copy would go and what it would start
 * from before anything is made.
 */
/**
 * A question an add-on asked, on its way to the window.
 *
 * The id is the window's to answer by, and is unique for the length of the
 * app's life: a double press, an answer that arrives after Stop, or a stale
 * answer to a request that was already settled all come back harmless rather
 * than granting something nobody asked for.
 */
export type ExtensionRequest = ExtensionAsk & {
  requestId: string;
  project: string;
  conversation: string | null;
};

/**
 * A terminal, as the window knows it.
 *
 * The kind is what the header says and who owns the process. It is not a
 * permission: every one of these is the person's own shell in their own folder,
 * and none of them is watched by the Guard.
 */
export type TerminalKind = 'shell' | 'agent' | 'server';

export type TerminalSession = {
  id: string;
  kind: TerminalKind;
  /** The folder it started in, which is the workspace somebody selected. */
  workspace: string;
  /** The shell's own name, for the header: "zsh", "bash". */
  shell: string;
  startedAt: number;
  exit: { code: number; signal: number | null } | null;
};

/** Output, in chunks: a terminal that printed a megabyte should not arrive as
 *  one message. */
export type TerminalChunk = { id: string; data: string };
export type TerminalExit = { id: string; code: number; signal: number | null };

/**
 * What a project carries into a new checkout, and the install one would need.
 *
 * Read before the checkout exists, because both questions are asked in the flow
 * that decides whether to make one: which gitignored files travel, and whether
 * this project has anything to install at all.
 */
export type SetupHere = {
  /** Every gitignored file this project could carry, with the ones it already
   *  carries marked. */
  candidates: readonly SetupCandidate[];
  /** What a checkout of this project would need installed, or null when there
   *  is nothing at the top of it to install from. */
  plan: InstallPlan | null;
};

/** Where the install in one checkout stands, and what it would run. */
export type SetupState = {
  state: Dependencies;
  plan: InstallPlan | null;
};

export type WorktreePlan = {
  /** False in a folder that is not a repository, or that has nothing committed
   *  yet. `because` says which. */
  possible: boolean;
  because: string | null;
  /** The folder the copy would be made in. */
  folder: string;
  /** The branch it would start from, as it is called now. */
  baseBranch: string | null;
  /** The commit it would start at. */
  baseSha: string | null;
  /** Files that are changed here and would not come with it. */
  leftBehind: readonly string[];
  /** What the copy would be given beyond the tracked files, and the install it
   *  would still need. */
  setup: SetupHere;
};

export type OpenedProject = {
  /** Absolute path. Shown only if the user asks for it. */
  path: string;
  /** The folder's own name, which is what people call their project. */
  name: string;
  /** What a continued conversation opens with, as a draft: written from the
   *  conversation it came from, and editable before it is sent. Absent unless
   *  this conversation was started by continuing another. */
  handoff?: string;
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
  /** The branch checked out there, read with the list. Null when the folder is
   *  not a repository, is gone, or is not on a branch. */
  branch: string | null;
};

/**
 * How much of what the model can hold at once this conversation is using.
 *
 * The window draws it as a ring beside the box. Everything here is the model's
 * own reckoning read back through Pi — nothing is counted on this side.
 */
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

/** One conversation this project has had. */
export type Conversation = {
  id: string;
  path: string;
  title: string;
  at: number;
  messages: number;
  /** Where its runtime is, when one is holding it. Filled by the shell, which
   *  is the only side that knows: a conversation with a turn in flight says so
   *  even after its tab has been closed. */
  state?: SessionState;
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

/**
 * One installed add-on, as the settings screen draws it.
 *
 * `policy` is what the loader will actually do with it here, worked out from
 * its capability card rather than from its name — so an add-on published
 * tomorrow is described on the same evidence as one installed today.
 */
export type AddonHere = {
  name: string;
  says: string;
  policy: 'on' | 'tools-only' | 'off';
  startsTurns: boolean;
  runsBackgroundWork: boolean;
  rewritesSystemPrompt: boolean;
};

/** What the add-ons screen says about npm before anybody presses anything, and
 *  what to do about it. Empty `line` when npm is here. */
export type AddonSetup = {
  needed: boolean;
  line: string;
  /** The page that installs Node. */
  download: string;
  /** `brew install node`, or null where there is no Homebrew to run it with. */
  command: string | null;
};

/** Whether this copy of the app can end a change once it has started, and the
 *  one line to draw where it cannot. Answered before a press, so no Cancel is
 *  drawn on a change that cannot be ended. */
export type Stopping = { canStop: boolean; says: string };

/** One add-on as the extensions list draws it: what it is, where it came from,
 *  how far it reaches, what it is doing here, and why not where it is not. */
export type ExtensionHere = {
  id: string;
  version: string | null;
  where: string;
  /** Where it came from, and how far it reaches, in the screen's words. */
  origin: string;
  scope: string;
  state:
    | 'discovered'
    | 'needs trust'
    | 'installed'
    | 'active here'
    | 'activation pending'
    | 'disabled'
    | 'incompatible'
    | 'failed';
  /** One sentence for the state, with the conversations it is running in. */
  says: string;
  activeIn: readonly string[];
  /** The `/` commands it offers here. */
  commands: readonly string[];
  /** A concise error, and the raw text behind it. Both empty when nothing went
   *  wrong. */
  problem: string | null;
  logs: readonly string[];
};

/** Every add-on this project can see, and how many processes they have running
 *  between them. */
export type AddonReport = {
  says: Readonly<Record<string, string>>;
  each: readonly AddonHere[];
  running: number;
  /** What each one is doing here, one row each, in the eight states. */
  here: readonly ExtensionHere[];
  /** What installing one needs from this computer. */
  setup: AddonSetup;
  /** Whether a change in flight can be ended, and what to say where it cannot. */
  stopping: Stopping;
};

/** What came of ending a change: whether anything was ended, the shelf's own
 *  sentence about what that left on disk, and the list read again so the row
 *  matches the folder. `packs` is absent when the list could not be read, which
 *  leaves the screen as it was rather than emptying it. */
export type StoppedAddition = {
  stopped: boolean;
  says: string;
  packs?: readonly Pack[];
};

/** One thing that can be added to Graphe. */
/** What the app is keeping on this computer, as the Storage page reads it. */
export type StorageRow = { name: string; bytes: number; files: number; clearable: boolean };

export type StorageNow = {
  says: string;
  couldClear: number;
  because: string;
  rows: readonly StorageRow[];
};

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
 * kilobytes each and almost nobody opens every diff in a long conversation.
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
  /** The model asked about the hard parts, or null for one model doing all of
   *  it. Global like `model`: it is a reading of what somebody will spend on a
   *  second opinion, and they are the same person in every folder. */
  advisor: ModelChoice | null;
  /** How long the advisor takes before it answers, or null to leave it to the
   *  model. Not in `thinking`: that is keyed by model, and the same model can
   *  be doing the work in one place and advising in another. */
  advisorThinking: ThinkingLevel | null;
  /** The two gates the advisor can hold, both off unless somebody turns one on.
   *  Asking a second model before saying a job is done turns "finish" into
   *  "report"; asking it every time a command repeats fires on running the
   *  tests three times. */
  advisorGates: { completionGate: boolean; loopGate: boolean };
  /** How much of an add-on that starts turns of its own runs. `tools-only`
   *  keeps its tools and drops the hooks — Graphe is already deciding when a
   *  turn begins, and two of those is the bug; `off` leaves it out entirely. */
  addons: 'on' | 'tools-only' | 'off';
  /** Which editor "Open in editor" goes to, by name, or null for whichever is
   *  found first. A machine with two always got the same one. */
  editor: string | null;
  /** The same for "Open in terminal". */
  terminal: string | null;
  /** How the app looks, as token overrides. Five colour presets were the whole
   *  of it before, and a preset is somebody else's taste. */
  appearance: Appearance;
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
  /** Whether each project's browser keeps its logins between sittings, keyed by
   *  its path. Absent is off — read it through `keepsLogins`. */
  keptLogins: Readonly<Record<string, boolean>>;
  /** The ceiling somebody set on spending, or null when they have not set one.
   *  Remembered across launches: a ceiling that forgets itself is not one. */
  ceiling: Money | null;
  /** Which finishing the window wears. 'system' follows the computer. */
  theme: Theme;
  /** Name a conversation, and its branch, from what was first asked in it. */
  nameConversations: boolean;
  /** Put a version down before a job's work first reaches the folder. */
  snapBeforeApply: boolean;
  /** What replies come back in. Empty is the request's own language, and says
   *  nothing to the model at all. */
  replyLanguage: string;
  /** How a finished run is said while the window is behind something. */
  whenRunFinishes: Telling;
  /** How something waiting on an answer is said. */
  whenSomethingNeedsYou: Telling;
  /** Whether being told makes a noise. Off unless somebody asked. */
  notifySound: boolean;
  /** Badge the dock with how many pieces are waiting to be looked at. */
  badgeDock: boolean;
  /** How Graphe may work the programs on this computer. Global, like `model`:
   *  enrolment belongs to the machine, not to one folder. */
  computerUse: ComputerUse;
};

/** What this Mac reports about Computer use. Honest over clever: a permission
 *  macOS will not name without prompting reads as unknown rather than as on. */
export type ComputerStatus = {
  excelInstalled: boolean;
};

/** The preferences a row on Behaviour or Notifications writes by name. The
 *  rows differ only in which one they hold, so they share one road. */
export type PlainPreference =
  | 'nameConversations'
  | 'snapBeforeApply'
  | 'replyLanguage'
  | 'whenRunFinishes'
  | 'whenSomethingNeedsYou'
  | 'notifySound'
  | 'badgeDock';

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

/**
 * Everything that happens whether or not somebody is looking.
 *
 * Asked for by the window and pushed at it whenever it changes, because the
 * interesting case is precisely the one where the window was not there when it
 * did.
 */
export type Away = {
  pieces: readonly AwayPiece[];
  /** How many go side by side. */
  atOnce: number;
  /** What all of it has cost so far, or null when nothing has been spent. */
  spent: Money | null;
  /** The one line over it when somebody comes back to it. Null when there is
   *  nothing worth saying. */
  sinceYouWere: string | null;
};

/** What is going on, and which project it belongs to. Same envelope, and same
 *  reason for it, as `AgentNotice`: a run can land for a folder somebody has
 *  switched away from, and it must not be drawn under another folder's name. */
export type AwayNotice = { project: string; away: Away };

/**
 * One thing the project offers every chat in it — a brief, a specification, a
 * house style. Nothing was sent it by this chat: the list belongs to the
 * project, and a new chat is given the same one on its first turned message.
 */
export type ProjectItem = {
  id: string;
  /** What it is called, which is what the model is given. */
  name: string;
  /** One line on what it is for. */
  note: string;
};

/** How the next message should be handled. Both switches default off; the
 *  window turns the first on by itself when a request looks big enough to be
 *  worth a plan. */
export type PromptOptions = {
  /** Look around and propose, changing nothing, before anything is touched. */
  lookFirst?: boolean;
  /** The agent is already working and this message should wait its turn —
   *  delivered after the current run, never interrupting it. */
  queue?: 'followUp';
  /** What the project shares with every chat, carried with the turn so a chat
   *  nobody has sent in yet is given it too. Empty or absent changes nothing. */
  context?: readonly ProjectItem[];
};

/**
 * Something true of this machine rather than of any one conversation: git or
 * npm missing, most of all. Kept in the shell and asked for by the window, as
 * well as pushed — a notice raised before the window was listening would
 * otherwise be a notice nobody ever sees.
 */
export type AppNotice = {
  /** Stable, so the same fact said twice is one row and can be put away. */
  id: string;
  /** One sentence on what is missing. */
  what: string;
  /** One sentence on what to do about it. */
  because: string;
};

/** The facts that are about the machine, named once because both halves have to
 *  agree on them: the shell says which are true, the window stands the controls
 *  that depend on them down. */
export const APP_NOTICE = { noGit: 'no-git', noNpm: 'no-npm' } as const;

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
 * A picture or a PDF brought in to be shown to the agent.
 *
 * The bytes cross the wire as base64 because a structured clone would strip a
 * `File` to nothing once it leaves the renderer. A picture goes on to the model
 * as a picture; a PDF is read into words in the shell first, because the
 * session carries text and pictures and nothing else.
 */
export type PromptAttachment = {
  kind: 'image' | 'document';
  /** The person's own file name. Shown in the window, and named to the model so
   *  it can answer about "the brand guidelines" rather than "the attachment". */
  name: string;
  /** e.g. 'image/png'. */
  mimeType: string;
  /** The bytes, base64-encoded without the data: prefix. */
  bytes: string;
};

/**
 * An attachment the shell has written down, by the hash of its own bytes.
 *
 * This is what a conversation's attachment row keeps: an id, the facts a chip
 * is drawn from, and the small copy as a data URL. The name the original bytes
 * are stored under is the id itself, so the same file attached twice — or
 * retried after a failed send — is one stored attachment rather than two.
 */
export type KeptAttachment = {
  id: string;
  /** The person's file name, from the first time these bytes were kept. */
  name: string;
  kind: 'image' | 'document';
  /** e.g. 'image/png'. */
  mimeType: string;
  byteSize: number;
  /** A data URL of the thumbnail, or null for anything without one — a PDF,
   *  or a picture this computer could not decode. Never the original. */
  thumb: string | null;
  /** These exact bytes were already here: one stored copy, one id. */
  twice: boolean;
};

/** One attachment that did not arrive, named so a person knows which one. */
export type RefusedAttachment = { name: string; because: string };

/** What came of handing the shell a drop, file by file. A partial upload is
 *  reported rather than swallowed: `refused` names what did not arrive,
 *  `kept` is what did, and `because` is the one sentence to show. */
export type KeptAttachments = {
  kept: readonly KeptAttachment[];
  refused: readonly RefusedAttachment[];
  because: string | null;
};

/** The original bytes of a kept attachment, back for sending again or opening. */
export type AttachmentCopy = {
  id: string;
  name: string;
  kind: 'image' | 'document';
  mimeType: string;
  /** Base64 without the data: prefix, the same shape `PromptAttachment` has. */
  bytes: string;
};

/** One conversation in the trash: what to call it, when it went, how big. */
export type TrashedConversation = {
  name: string;
  path: string;
  /** An ISO moment. The name carries when it was deleted. */
  wentAt: string;
  size: number;
};

/** The trash as a person sees it: what is in it, and the rule it is kept
 *  under — nothing is emptied on its own, and emptying is an explicit action. */
export type TrashView = { items: readonly TrashedConversation[]; rule: string };

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
  /** `extension` is a command an add-on registered: it runs in Pi's command
   *  context rather than being sent as a prompt. */
  source: 'global' | 'project' | 'extension';
  /** The add-on that offers it, for an `extension` row. */
  from?: string;
  /** Set when a name Graphe already answers to is in front of this one. The
   *  picker says so rather than dropping the row. */
  shadowed?: string | null;
};

/** Where the app has got to carrying a job on by itself. `why` is null once it
 *  has come to rest. */
/** A build newer than this one, and how to get it. Said once a day at most,
 *  and never as trouble: being on last week's build is not an error. */
export type NewerVersion = { version: string; upgrade: string };

export type ContinuationNotice = {
  project: string;
  address: string;
  round: number;
  why: 'checklist' | 'goal' | 'board' | 'extension' | 'recovery' | null;
  said: string;
  resting: boolean;
};

/** A frame's worth of one conversation's events, coalesced in the shell. */
export type AgentFrame = {
  project: string | null;
  conversation: string | null;
  events: readonly AgentEvent[];
};

/** One step of a document-to-build plan, as the window draws it. */
export type BuildTask = {
  n: number;
  title: string;
  acceptance: string;
  test: string | null;
  status: 'pending' | 'doing' | 'done' | 'failed' | 'skipped';
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
  /** Every step settled. A finished list stays on screen, and says so, until
   *  somebody clears it — deleting it on the spot is how a list that finished
   *  by mistake vanished with nothing to resume from. */
  finished: boolean;
  /** Which conversation the list belongs to. A project has as many lists as it
   *  has conversations; one shared between them advanced from whichever tab
   *  happened to settle. */
  address: string;
  /** How many other conversations in this project are holding a list. */
  elsewhere: number;
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
   * nothing is being served there. The window shows its preview button only
   * while this is set — a preview that exists gets a button; one that does not
   * gets nothing. A preview of somewhere else is not this folder's, and is
   * reported as nothing.
   */
  preview: string | null;
  /** Things the last turn made that are worth looking at rather than reading. */
  artifacts: readonly Artifact[];
  /** Named colours out of a palette file the agent wrote, for real swatches. */
  swatches: readonly Swatch[];
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
  /** Every one, the switched-off ones included, in the order they are written. */
  rows: readonly AlwaysRow[];
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
  /** How many files are changed at all. Not the three counts above added up:
   *  a file both staged and edited again is one file, and was being counted
   *  twice. */
  changedPaths: number;
  /** Which files, by name, up to a limit. The panel names them rather than
   *  counting them: "3 files changed" is a number, `pricing.tsx` is a place. */
  files: readonly ChangedFile[];
  /** Lines added and removed across every tracked file that has changed. Read
   *  separately from the status: the porcelain format carries no line totals,
   *  and "3 files" and "+734 −7" are two different answers to two different
   *  questions. */
  added: number;
  removed: number;
  /** Saved work owned by this machine and not yet in the shared copy. */
  ahead: number;
  /** Saved work owned by the shared copy and not yet on this machine. */
  behind: number;
};

/** What a branch is doing against the shared copy it tracks. Every one of these
 *  is an ordinary day — only a fetch that could not reach origin is a failure. */
export type FetchedState =
  /** This project is only here. */
  | 'no-remote'
  /** Sitting on a commit rather than a branch. */
  | 'detached'
  /** On a branch that tracks nothing. */
  | 'no-upstream'
  | 'up-to-date'
  | 'behind'
  | 'ahead'
  /** Both have commits the other does not. */
  | 'diverged';

/** Where a branch stands against origin, read after a fetch. */
export type Fetched = {
  /** The branch, or null on a detached HEAD. */
  branch: string | null;
  /** What it tracks, e.g. `origin/main`; null when it tracks nothing. */
  upstream: string | null;
  /** Commits this branch has that its upstream does not. */
  ahead: number;
  /** Commits its upstream has that this branch does not. */
  behind: number;
  /** Uncommitted changes in the folder, which is what stops a fast-forward. */
  dirty: boolean;
  /** Commits a fast-forward just took in. Zero for a fetch. */
  moved: number;
  state: FetchedState;
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
      'I am part-way through answering. Moving to another conversation now would lose it. Stop me if you would rather go anyway.',
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
    'I have put this conversation down to make room for the ones you moved to. Nothing is lost. Open it again and I will pick up where we left off.',
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
  /** A pull request nobody is asking you to merge yet. False for an issue. */
  draft: boolean;
};

/** One continuous-integration check on a pull request, as `gh pr checks` gives
 *  it. `link` is null when github named no run to open. */
export type PullCheck = {
  name: string;
  state: 'passed' | 'failed' | 'pending' | 'skipped';
  link: string | null;
};

/** One review comment already on a pull request, drawn under the line it is
 *  about. `line` is the line in the file as the pull request leaves it. */
export type PullComment = {
  id: string;
  path: string;
  line: number;
  author: string;
  body: string;
  at: string;
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

/* -------------------------------------------------------------------------- */
/* Finished work waiting to be reviewed                                       */
/* -------------------------------------------------------------------------- */

export type { FileVerdict, HowItLands };
export type ReviewVerdict = Verdict;

/**
 * One thing waiting to be looked at, as the window draws it.
 *
 * The queue's own `Entry` plus the one fact only the shell can supply: the
 * branch the work is on, which is what Land and the pull request are made from.
 */
export type ReviewEntry = ReviewQueued & {
  branch: string;
};

/** An entry opened for reading: the queue as it stands, and the change itself. */
export type ReviewOpened = {
  entries: readonly ReviewEntry[];
  /** Unified diff of everything the entry changed, against where it started. */
  diff: string;
  /** What the diff was read from: the copy's revision and its working tree
   *  together, which is the same reading a decision is checked against. Null
   *  when the work behind the entry could not be read at all. */
  revision: string | null;
  /** True when this is a second look and the work has moved since the first:
   *  the diff here is the change as it is now, not the one already read. */
  changed: boolean;
};

/** What a decision came to. `clashes` names the files both sides changed, which
 *  are left exactly as this folder has them until somebody settles each one. */
export type ReviewDecided = {
  entries: readonly ReviewEntry[];
  /** What just happened, in the words of the thing that happened. */
  did: string;
  clashes: readonly string[];
  /** The conversation it came out of, so a clash can be handed back to it. */
  address: string;
};

/** A file both sides changed, written out with markers so it can be decided
 *  place by place. Nothing on disk is touched to produce it. */
export type ReviewClash = { path: string; text: string };

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
  showProgress: 'graphe:show-progress',
  windowState: 'graphe:window-state',
  pointed: 'graphe:pointed',
  /** A key the native page pane swallowed, handed back to the window. */
  paneKey: 'graphe:pane-key',
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
  hatches: 'graphe:hatches',
  getHelper: 'graphe:get-helper',
  openInEditor: 'graphe:open-in-editor',
  revealFolder: 'graphe:reveal-folder',
  saveVersion: 'graphe:save-version',
  room: 'graphe:room',
  carried: 'graphe:carried',
  trustCarried: 'graphe:trust-carried',
  repoLook: 'graphe:repo-look',
  repoComment: 'graphe:repo-comment',
  prDiff: 'graphe:pr-diff',
  prChecks: 'graphe:pr-checks',
  prCheckout: 'graphe:pr-checkout',
  prComments: 'graphe:pr-comments',
  prComment: 'graphe:pr-comment',
  stopAsking: 'graphe:stop-asking',
  goAsFarAs: 'graphe:go-as-far-as',
  setPlanMode: 'graphe:set-plan-mode',
  running: 'graphe:running',
  runningSaid: 'graphe:running-said',
  pageSaid: 'graphe:page-said',
  stopRunning: 'graphe:stop-running',
  tidyNow: 'graphe:tidy-now',
  skills: 'graphe:skills',
  skillText: 'graphe:skill-text',
  openSkillFile: 'graphe:open-skill-file',
  workflows: 'graphe:workflows',
  alwaysDoes: 'graphe:always-does',
  /** The same list, written back. */
  alwaysWrite: 'graphe:always-write',
  watchBrowser: 'graphe:watch-browser',
  browserFrame: 'graphe:browser-frame',
  branchSwitch: 'graphe:branch-switch',
  branchCreate: 'graphe:branch-create',
  fetchOrigin: 'graphe:fetch-origin',
  fastForward: 'graphe:fast-forward',
  worktreeLand: 'graphe:worktree-land',
  worktreeDrop: 'graphe:worktree-drop',
  checkouts: 'graphe:checkouts',
  checkoutFront: 'graphe:checkout-front',
  checkoutLook: 'graphe:checkout-look',
  checkoutLand: 'graphe:checkout-land',
  checkoutPutAway: 'graphe:checkout-put-away',
  prWorktreePrepare: 'graphe:pr-worktree-prepare',
  worktreePlan: 'graphe:worktree-plan',
  setupFiles: 'graphe:setup-files',
  setupChoose: 'graphe:setup-choose',
  setupInstall: 'graphe:setup-install',
  setupState: 'graphe:setup-state',
  terminalOpen: 'graphe:terminal-open',
  terminalScrollback: 'graphe:terminal-scrollback',
  terminalWrite: 'graphe:terminal-write',
  terminalResize: 'graphe:terminal-resize',
  terminalClose: 'graphe:terminal-close',
  terminalList: 'graphe:terminal-list',
  terminalData: 'graphe:terminal-data',
  terminalExit: 'graphe:terminal-exit',
  conversationContinue: 'graphe:conversation-continue',
  conversationFork: 'graphe:conversation-fork',
  conversationArchive: 'graphe:conversation-archive',
  extensionAsk: 'graphe:extension-ask',
  extensionAnswer: 'graphe:extension-answer',
  worktreeNew: 'graphe:worktree-new',
  prReviewOpen: 'graphe:pr-review-open',
  reviewQueue: 'graphe:review-queue',
  reviewOpen: 'graphe:review-open',
  reviewChoose: 'graphe:review-choose',
  reviewDecide: 'graphe:review-decide',
  reviewLand: 'graphe:review-land',
  reviewPr: 'graphe:review-pr',
  conflictLook: 'graphe:conflict-look',
  conflictSettle: 'graphe:conflict-settle',
  buildStart: 'graphe:build-start',
  buildPlan: 'graphe:build-plan',
  buildAdvance: 'graphe:build-advance',
  buildSave: 'graphe:build-save',
  buildCancel: 'graphe:build-cancel',
  /** Every editor and terminal installed here, so a row can offer the choice. */
  appsHere: 'graphe:apps-here',
  /** Which of them "Open in editor" and "Open in terminal" go to. */
  setOpensIn: 'graphe:set-opens-in',
  /** One of the plain Behaviour or Notifications preferences, by name. */
  setPreference: 'graphe:set-preference',
  goalLoad: 'graphe:goal-load',
  goalSave: 'graphe:goal-save',
  goalClear: 'graphe:goal-clear',
  goalVerify: 'graphe:goal-verify',
  chooseDocument: 'graphe:choose-document',
  conversations: 'graphe:conversations',
  openConversation: 'graphe:open-conversation',
  closeConversation: 'graphe:close-conversation',
  deleteConversation: 'graphe:delete-conversation',
  /** Accepted attachments, written down under the profile by their content id,
   *  and the kept conversations a person can put back or throw away. */
  keepAttachments: 'graphe:keep-attachments',
  attachmentCopy: 'graphe:attachment-copy',
  trashList: 'graphe:trash-list',
  trashRestore: 'graphe:trash-restore',
  trashEmpty: 'graphe:trash-empty',
  pageAt: 'graphe:page-at',
  pageHidden: 'graphe:page-hidden',
  packages: 'graphe:packages',
  addPackage: 'graphe:add-package',
  removePackage: 'graphe:remove-package',
  /** End the change that is running now. Answered with what that left on disk. */
  stopPackage: 'graphe:stop-package',
  connection: 'graphe:connection',
  connect: 'graphe:connect',
  connectAnswer: 'graphe:connect-answer',
  cancelConnect: 'graphe:cancel-connect',
  disconnect: 'graphe:disconnect',
  selectModel: 'graphe:select-model',
  selectAdvisor: 'graphe:select-advisor',
  setAdvisorThinking: 'graphe:set-advisor-thinking',
  /** The two gates the advisor can hold, and whether add-ons that start work of
   *  their own keep their hooks. Both live behind the model chip. */
  setAdvisorGate: 'graphe:set-advisor-gate',
  setAddons: 'graphe:set-addons',
  setThinking: 'graphe:set-thinking',
  spendSplit: 'graphe:spend-split',
  tokenUsage: 'graphe:token-usage',
  exportSpend: 'graphe:export-spend',
  spendLimit: 'graphe:spend-limit',
  setSpendLimit: 'graphe:set-spend-limit',
  connectStep: 'graphe:connect-step',
  discoveredAccounts: 'graphe:discovered-accounts',
  importAccount: 'graphe:import-account',
  openLink: 'graphe:open-link',
  setKeepLogins: 'graphe:set-keep-logins',
  setComputerUse: 'graphe:set-computer-use',
  computerStatus: 'graphe:computer-status',
  openComputerSettings: 'graphe:open-computer-settings',
  setTheme: 'graphe:set-theme',
  setAppearance: 'graphe:set-appearance',
  ownStyles: 'graphe:own-styles',
  connectedLook: 'graphe:connected-look',
  connectedCheck: 'graphe:connected-check',
  connectedSave: 'graphe:connected-save',
  takeBackQueue: 'graphe:take-back-queue',
  changesLook: 'graphe:changes-look',
  changesWider: 'graphe:changes-wider',
  changesDrop: 'graphe:changes-drop',
  away: 'graphe:away',
  keepGoing: 'graphe:keep-going',
  stopAway: 'graphe:stop-away',
  keepAway: 'graphe:keep-away',
  answerAway: 'graphe:answer-away',
  sayToAway: 'graphe:say-to-away',
  awayChanged: 'graphe:away-changed',
  buildPlanChanged: 'graphe:build-plan-changed',
  /** Where the app has got to carrying a job on by itself. */
  continuation: 'graphe:continuation',
  /** A newer build is out. Once a day, and never in the way. */
  newerVersion: 'graphe:newer-version',
  /** What this machine is missing — git, npm — asked for on launch, because
   *  nothing is open yet to say it in. */
  appNotices: 'graphe:app-notices',
  /** And the same, as it is found out, for a window already up. */
  appNotice: 'graphe:app-notice',
  /** A press in the app's own menu that the window is the one to act on. */
  fromMenu: 'graphe:from-menu',
  /** Everything that happened, a frame's worth at a time. One trip across the
   *  wire per frame rather than one per token. */
  events: 'graphe:events',
  /** Everything worth sending when somebody says "it stopped". */
  diagnostics: 'graphe:diagnostics',
  /** Which build this is. */
  appVersion: 'graphe:app-version',
  /** What a model was measured doing on a long job. */
  longJobs: 'graphe:long-jobs',
  /** What each installed add-on will actually do, and how much it is running. */
  addons: 'graphe:addons',
  /** Keep a credential the app itself needs in the login keychain. */
  keepCredential: 'graphe:keep-credential',
  /** How much room this app is taking, and clearing the finished work. */
  storage: 'graphe:storage',
  /** Empty one storage row outright, where that is safe. */
  clearFolder: 'graphe:clear-folder',
  clearFinishedWork: 'graphe:clear-finished-work',
  /** Which of those are held, and whether this machine can hold any. */
  credentialsKept: 'graphe:credentials-kept',
  /** Stop it carrying on. Escape, and the Stop beside the line it draws. */
  continuationStop: 'graphe:continuation-stop',
} as const;

/**
 * One picture of a preview, and which preview it is a picture of.
 *
 * The shell takes a picture of the agent's browser every second or so and sends
 * it to the window, which draws whatever arrives. What arrives can be of
 * something the window is not showing any more — another workspace's browser, or
 * this one before a reload — so every picture says what it is of. The window
 * draws the ones that match what it is showing and drops the rest, rather than
 * putting a view of somewhere else on screen as though it were current.
 */
export type PreviewFrame = {
  /** The preview's own id. The same for as long as this browser is the one
   *  being shown; a different one is a different preview. */
  preview: string;
  /** The project whose browser it is, which is what the window asked about. */
  project: string;
  /** One more each time the window starts looking again, so a picture taken
   *  before a reload cannot be mistaken for the one now. */
  epoch: number;
  /** The picture itself, base64, as the shell encoded it. */
  bytes: string;
};

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
  /** Where a file the window was handed by a drop actually lives. Empty when
   *  the shell cannot name it. */
  pathOf(file: File): string;
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
  /** Every line one pull request changes, as unified diff text. */
  prDiff(number: number, where?: Where): Promise<Result<string>>;
  /** What the checks on a pull request came to. An empty list means github said
   *  there are none; a refusal means it could not be asked. */
  prChecks(number: number, where?: Where): Promise<Result<readonly PullCheck[]>>;
  /** Put the folder on a pull request's branch, and say what happened. */
  prCheckout(number: number, where?: Where): Promise<Result<string>>;
  /** The review comments already on a pull request. */
  prComments(number: number, where?: Where): Promise<Result<readonly PullComment[]>>;
  /** Write one review comment against a line of a file in a pull request. */
  prComment(
    number: number,
    body: string,
    path: string,
    line: number,
    where?: Where,
  ): Promise<Result<readonly PullComment[]>>;
  /** Put the project back to a version. Undoable; see `PutBack`. */
  putBack(versionId: string, where?: Where): Promise<Result<PutBack>>;
  /** Give a version a name of the user's own. */
  nameVersion(versionId: string, name: string, where?: Where): Promise<Result<readonly SavedVersion[]>>;
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
   *  rather than the window.
   *
   *  The answer carries the revision it was read at, so a window holding a
   *  listing can tell whether the folder has moved since and read it again
   *  rather than drawing what is no longer there. */
  projectFiles(where?: Where): Promise<Result<FilesRead>>;
  /** One file of the open project, as text. A location outside the project, a
   *  file too big to read, or one that is not text comes back as a sentence
   *  rather than as bytes.
   *
   *  `expect` is the revision the caller last read this file at. When it is
   *  given and no longer matches, the answer carries the file as it is now and
   *  says so, rather than handing over the newer bytes as though they were the
   *  ones being read. */
  fileText(path: string, where?: Where, expect?: string): Promise<Result<TextRead>>;

  /** What the escape hatches can offer here — which editor, if any. */
  hatches(): Promise<Result<Hatches>>;
  /** Fetch the piece a connected tool needs inside another app, unpack it, and
   *  show it in Finder. Answers with where it put it. */
  getHelper(id: string): Promise<Result<string>>;
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
  /** Write the list back, whole, and answer with what the file now says. */
  alwaysWrite(rows: readonly AlwaysRow[], where?: Where): Promise<Result<AlwaysDoes>>;
  /** Watch what the browser is doing, a picture at a time, or stop. The
   *  pictures arrive on `onBrowserFrame`. */
  watchBrowser(on: boolean, where?: Where): Promise<Result<boolean>>;
  /** Each picture of the browser, while somebody is watching one. Each one says
   *  which preview it is of; the window draws the ones matching what it shows. */
  onBrowserFrame(listener: (frame: PreviewFrame) => void): () => void;
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
  appsHere(): Promise<Result<{ editors: readonly string[]; terminals: readonly string[] }>>;
  setOpensIn(which: 'editor' | 'terminal', name: string | null): Promise<Result<Preferences>>;
  /** One preference on Behaviour or Notifications. Whatever is handed back is
   *  what was actually kept, so a refused write shows as the old answer. */
  setPreference(which: PlainPreference, value: string | boolean): Promise<Result<Preferences>>;
  /** A goal per project, kept on disk. Null when none. */
  goalLoad(where?: Where): Promise<Result<Goal | null>>;
  goalSave(goal: Goal, where?: Where): Promise<Result<null>>;
  goalClear(where?: Where): Promise<Result<null>>;
  /** Run real checks (tsc etc.) in the project. */
  goalVerify(where?: Where): Promise<Result<{ passed: boolean; reason: string }>>;
  /** Pick a requirements document on disk and read its text, or null if closed. */
  chooseDocument(where?: Where): Promise<Result<{ name: string; text: string } | null>>;
  /** Move the project onto another of its lines of work. Refuses while the
   *  current work is not yet saved. */
  branchSwitch(name: string, where?: Where): Promise<Result<null>>;
  /** Start a new line of work and move the project onto it. */
  branchCreate(name: string, where?: Where): Promise<Result<null>>;
  /** Fetch from origin and say where that leaves this branch. Moves nothing. */
  fetchOrigin(where?: Where): Promise<Result<Fetched>>;
  /** Fast-forward this branch onto its upstream. Refuses anything else. */
  fastForward(where?: Where): Promise<Result<Fetched>>;
  /** Merge the front conversation's own branch back, and drop the checkout. */
  worktreeLand(where?: Where): Promise<Result<null>>;
  /** Throw the front conversation's own checkout away, branch and all. */
  worktreeDrop(where?: Where): Promise<Result<null>>;

  /** Every conversation with a copy of this project, one card's worth each. */
  checkouts(where?: Where): Promise<Result<readonly WorkspaceFacts[]>>;
  /** Move the project folder itself onto that conversation's branch. Its copy
   *  is given back first, so the branch is only ever spread out in one place. */
  checkoutFront(address: string, where?: Where): Promise<Result<readonly WorkspaceFacts[]>>;
  /** What one copy changed, against the commit it started from, as one diff. */
  checkoutLook(address: string, where?: Where): Promise<Result<string>>;
  /** Bring one copy's work into the project and give the copy back. */
  checkoutLand(address: string, where?: Where): Promise<Result<readonly WorkspaceFacts[]>>;
  /** Give one copy's folder back and keep its branch. Refused while the copy
   *  holds writing the branch does not carry. */
  checkoutPutAway(address: string, where?: Where): Promise<Result<readonly WorkspaceFacts[]>>;
  /** Prepare an isolated worktree for a pull request, so the review reads the right files. */
  preparePrWorktree(prNumber: number, where?: Where): Promise<Result<string>>;
  /** Open a new conversation rooted at the PR worktree, so the review reads the PR's own files. */
  openPrReview(prNumber: number, where?: Where): Promise<Result<{ folder: string; opened: OpenedProject }>>;

  /** Everything finished and waiting to be looked at, newest first. */
  reviewQueue(where?: Where): Promise<Result<readonly ReviewEntry[]>>;
  /** Open one to read it. Opening is reading, so it stops counting as waiting. */
  reviewOpen(id: string, where?: Where): Promise<Result<ReviewOpened>>;
  /** Say what to do with one file of it, or clear that and follow the entry. */
  reviewChoose(id: string, path: string, choice: FileVerdict | null, where?: Where): Promise<Result<readonly ReviewEntry[]>>;
  /** Answer a whole entry. The chosen files are carried into the folder,
   *  uncommitted; a file both sides changed is left alone and named back. */
  reviewDecide(id: string, verdict: ReviewVerdict, where?: Where): Promise<Result<ReviewDecided>>;
  /** The same yes, committed. One commit unless the landing says otherwise. */
  reviewLand(id: string, landing: HowItLands, where?: Where): Promise<Result<ReviewDecided>>;
  /** Open a pull request from the entry's branch, with its summary as the body. */
  reviewPr(id: string, summary: string, where?: Where): Promise<Result<{ url: string; entries: readonly ReviewEntry[] }>>;
  /** Carry this conversation's files home as it works, or stop doing that. */
  /** One file both sides changed, written out with markers to decide over.
   *  `address` is the conversation whose version is the other side. */
  conflictLook(address: string, path: string, where?: Where): Promise<Result<ReviewClash>>;
  /** Write the decided version of that file into the project. */
  conflictSettle(address: string, path: string, text: string, where?: Where): Promise<Result<null>>;
  /** Full text for a library row. `id` is checked against that library first. */
  skillText(id: string, where?: Where): Promise<Result<string>>;
  /** Open a library row's own file in the editor. `id` is checked against that
   *  library first, so the window never names a path of its own. */
  openSkillFile(id: string, where?: Where): Promise<Result<null>>;
  /** Stop checking before things that would otherwise be asked about, or start
   *  again. Answers with what is true afterwards. */
  stopAsking(on: boolean, where?: Where): Promise<Result<boolean>>;
  /** Set how far it may go before it stops and asks. Answers with the rung it
   *  is actually on afterwards. */
  goAsFarAs(howFar: HowFar, where?: Where): Promise<Result<HowFar>>;
  /** Stay read-only until an explicit Do it / Exit plan. */
  setPlanMode(on: boolean, where?: Where): Promise<Result<boolean>>;
  /** What is being kept running in this conversation — servers, watchers. */
  running(where?: Where): Promise<Result<readonly RunningPiece[]>>;
  /** Everything one of them has said since it started, whole. Read again rather
   *  than pushed: the drawer asks while it is open and stops when it is not. */
  runningSaid(id: string, where?: Where): Promise<Result<string>>;
  /** What the page beside the conversation has printed, as the console model
   *  holds it. Empty when no page is open. */
  pageSaid(where?: Where): Promise<Result<readonly Said[]>>;
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
  /** Somebody clicked an element, in their own browser or in the page beside
   *  the conversation. Read against the project before it gets here. */
  onPointed(listener: (pointed: Pointed) => void): () => void;
  /** A key the native page pane swallowed. Escape only, and only because a
   *  menu that will not close traps the hand. */
  onPaneKey(listener: (press: { key: string }) => void): () => void;
  /** The screens this project has, for the rail. Empty when the shape of the
   *  folder is not one we recognise — a guess would send people nowhere. */
  pages(where?: Where): Promise<Result<readonly Page[]>>;
  /** How the window is sitting. Full screen takes the traffic lights away, so
   *  the layout stops reserving room for them. */
  onWindowState(listener: (state: WindowState) => void): () => void;

  /** The conversations this project has had, newest first. */
  conversations(where?: Where): Promise<Result<readonly Conversation[]>>;
  /** Open one of them, or start a fresh one when given null. Comes back with
   *  the conversation replayed as events, the same as opening a project.
   *
   *  `key` names the press that asked for a fresh one, so a request sent twice
   *  answers with the conversation the first one made instead of a second.
   *  A path and a key together are contradictory; the path wins and the key is
   *  ignored. */
  openConversation(
    path: string | null,
    workspace?: string | null,
    key?: string | null,
    where?: Where,
  ): Promise<Result<OpenedProject>>;
  /** What a New worktree would make, before anybody commits to it. */
  worktreePlan(where?: Where): Promise<Result<WorktreePlan>>;
  /** Which gitignored files this project carries into a checkout, and whether a
   *  checkout would need an install. Read only. */
  setupFiles(where?: Where): Promise<Result<SetupHere>>;
  /** Write this project's ticks down. Answers with the same reading as
   *  `setupFiles`, so the flow draws what is now true rather than what it hoped. */
  setupChoose(files: readonly string[], where?: Where): Promise<Result<SetupHere>>;
  /** Install what one checkout needs, as the step of its own that it is. */
  setupInstall(where?: Where): Promise<Result<SetupState>>;
  /** Where that install stands, for a window that was not there when it ran. */
  setupState(where?: Where): Promise<Result<SetupState>>;
  /** A new conversation carrying one editable note about where this one got
   *  to. Nothing of the transcript comes across but the files and the note. */
  continueConversation(source?: string | null, where?: Where): Promise<Result<OpenedProject>>;
  /** The same history in a conversation of its own, or — when `said` names a
   *  place — only as far as that exchange: how many things the person had said
   *  by then, counting from one. */
  forkConversation(
    source?: string | null,
    said?: number | null,
    where?: Where,
  ): Promise<Result<OpenedProject>>;
  /** Out of the list, or back into it. Not delete, not close. */
  archiveConversation(
    id: string,
    on: boolean,
    where?: Where,
  ): Promise<Result<readonly Conversation[]>>;
  /** Start a shell in the workspace this call names. There is no command
   *  argument on purpose: a terminal is keystrokes, not an execution door. */
  terminalOpen(
    size: { cols: number; rows: number; kind: TerminalKind },
    where?: Where,
  ): Promise<Result<TerminalSession>>;
  /** What it has printed so far, for a pane opened after the fact. */
  terminalScrollback(id: string): Promise<Result<string>>;
  terminalWrite(id: string, data: string): Promise<Result<null>>;
  terminalResize(id: string, cols: number, rows: number): Promise<Result<null>>;
  terminalClose(id: string): Promise<Result<null>>;
  terminalList(where?: Where): Promise<Result<readonly TerminalSession[]>>;
  /** Output arriving from a terminal, chunk by chunk. */
  onTerminalData(listener: (chunk: TerminalChunk) => void): () => void;
  /** A terminal's process ending, once. */
  onTerminalExit(listener: (exit: TerminalExit) => void): () => void;
  /** Something an add-on is asking. Answered through `answerExtension`, and
   *  with `extensionAnswer` in the shape its own question has. */
  onExtensionAsk(listener: (ask: ExtensionRequest) => void): () => void;
  answerExtension(
    requestId: string,
    answer: ExtensionAnswer,
    where?: Where,
  ): Promise<Result<null>>;
  /** Make the copy, and start a conversation in it. A context handoff from
   *  another conversation is a separate, explicit action. */
  worktreeNew(wanted: { base?: string | null }, where?: Where): Promise<Result<OpenedProject>>;
  /** Put one down. Only the view closes — it stays written down, and opening it
   *  again carries on from where it was left. Optional, so a bridge with no way
   *  to close one is still a whole bridge. */
  /** Put a conversation down without losing it. Opening it again resumes. */
  closeConversation(where?: Where): Promise<Result<null>>;
  /** Throw a conversation away. The file on disk goes; the project does not. */
  deleteConversation(path: string, where?: Where): Promise<Result<readonly Conversation[]>>;

  /** Write down what was accepted, by content id, and say what did not arrive.
   *  `held` is the ids the conversation is already carrying, so the ceiling is
   *  a property of the conversation and a retry of something already held does
   *  not count twice. */
  keepAttachments(
    files: readonly PromptAttachment[],
    held?: readonly string[],
  ): Promise<Result<KeptAttachments>>;
  /** The original bytes of a kept attachment, back for sending again. Null when
   *  nothing is stored under that id. */
  attachmentCopy(id: string): Promise<Result<AttachmentCopy | null>>;
  /** What is in the trash, and the rule it is kept under. */
  trashList(): Promise<Result<TrashView>>;
  /** Put one back where the shell can open it again: its path, or null when it
   *  would have to write over a conversation that is already there. */
  trashRestore(name: string): Promise<Result<string | null>>;
  /** Delete exactly the kept conversations named, and return the ones that
   *  actually went. Nothing else in the trash is touched. */
  trashEmpty(names: readonly string[]): Promise<Result<readonly string[]>>;

  /** A second copy of a conversation, so another direction can be tried without
  /** Point the page at an address and glue it to a rectangle in the window.
   *  A null rectangle closes it. */
  /** Where the page is drawn, and what it shows. Moving it never reloads it:
   *  the box is reported whenever the window changes shape, and a turn full of
   *  tool calls changes it many times. `again` is the reload press.
   *
   *  The page is one native view for the whole window, so `where` is not
   *  optional here: it names the project whose page this is, and a call that
   *  names another project, or none, is refused rather than pointed at
   *  whichever page happens to be up. */
  pageAt(
    address: string | null,
    bounds: { x: number; y: number; width: number; height: number } | null,
    again: boolean,
    where: Where,
  ): Promise<Result<null>>;
  /** Take the page out of the way while something is drawn over it. `where`
   *  names the project whose page it is, as `pageAt` does. */
  pageHidden(hidden: boolean, where: Where): Promise<Result<null>>;
  /** What can be added to Graphe. A search term looks past the ones we ship. */
  packages(term?: string): Promise<Result<readonly Pack[]>>;
  addPackage(id: string): Promise<Result<readonly Pack[]>>;
  removePackage(id: string): Promise<Result<readonly Pack[]>>;
  /**
   * End the change that is running now — an install, an update or a removal —
   * and answer with what that left on disk, in the shelf's own words.
   *
   * Drawn only where the shell has said it can do this (`AddonReport.stopping`):
   * an install it cannot reach is one it cannot end, and the press is answered
   * with that rather than with a pretend success.
   */
  stopPackage(): Promise<Result<StoppedAddition>>;
  /** Follow along while that happens. Returns the function that stops. */
  onShowProgress(listener: (progress: ShowProgress) => void): () => void;

  /** Listen to the agent. Returns the function that stops listening. */
  onEvent(listener: (notice: AgentNotice) => void): () => void;
  /**
   * The same events, a frame's worth at a time.
   *
   * One `webContents.send` per token meant sixty trips across the wire a
   * second and sixty synchronous handlers in the window. Runs of text are
   * welded; anything that gates the screen — a step starting, a question, a
   * settle — goes at once, taking everything queued before it so the order a
   * conversation is read in never changes.
   */
  onEvents(listener: (frames: readonly AgentFrame[]) => void): () => void;

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
  /** Choose the model asked about the hard parts, or null so one model does all
   *  of it. Takes effect on the conversation in front of somebody, not only the
   *  next one. */
  selectAdvisor(choice: ModelChoice | null, where?: Where): Promise<Result<Preferences>>;
  setAdvisorThinking(level: ThinkingLevel, where?: Where): Promise<Result<Preferences>>;
  /** Turn one of the advisor's two gates on or off. Both off by default: a
   *  second opinion is advice on the work, never permission to stop. */
  setAdvisorGate(
    which: 'completionGate' | 'loopGate',
    on: boolean,
    where?: Where,
  ): Promise<Result<Preferences>>;
  /** Whether add-ons that start turns of their own keep their hooks here. */
  setAddons(choice: 'on' | 'tools-only' | 'off', where?: Where): Promise<Result<Preferences>>;
  /** Let this exact model take more or less time before it answers. */
  setThinking(choice: ModelChoice, level: ThinkingLevel, where?: Where): Promise<Result<Preferences>>;
  /** Where the money went in this project, asked for rather than waited for.
   *  Null when nothing has been spent yet. */
  spendSplit(where?: Where): Promise<Result<SpendSummary | null>>;
  /** Tokens through the model, one day at a time, read from this computer's
   *  own session transcripts. Null when there are none to read. */
  tokenUsage(): Promise<Result<TokenUsageView | null>>;
  /** Write the spend out as a CSV, for whoever expenses it. Returns where it
   *  went, or null when the save was cancelled. */
  exportSpend(csv: string): Promise<Result<string | null>>;
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

  /** Keep this project's browser signed in between sittings, or stop keeping
   *  it. Off keeps nothing and starts every browser clean. */
  setKeepLogins(on: boolean, where?: Where): Promise<Result<Preferences>>;
  /** Change one corner of Computer use. The whole object is set at once, so a
   *  half-written enrolment can never reach the disk. */
  setComputerUse(use: ComputerUse): Promise<Result<Preferences>>;
  /** What this Mac can actually do for Computer use: whether Excel is here to
   *  be worked at all. */
  computerStatus(): Promise<Result<ComputerStatus>>;
  /** Open the system settings page behind one of the two permissions. */
  openComputerSettings(which: 'see' | 'point'): Promise<Result<null>>;
  setTheme(theme: Theme): Promise<Result<Preferences>>;
  /** Change how it looks. Every control writes a token; the whole thing is one
   *  small object, so it is set whole rather than a field at a time. */
  setAppearance(appearance: Appearance): Promise<Result<Preferences>>;
  /**
   * A stylesheet of somebody's own, loaded last.
   *
   * The precise control behind the same Appearance row: every value the
   * builder sets is a token, and this is where somebody who wants a token the
   * builder does not offer writes it. Returns where the file is as well as
   * what is in it, because the answer to "where do I put this" is a path.
   */
  ownStyles(): Promise<Result<{ css: string; file: string }>>;

  /* ---------------------------------------------- while you are not looking */

  /** The other tools this project has plugged in, and whether its list reads. */
  connectedLook(where?: Where): Promise<Result<ConnectedState>>;
  /** Start one, ask what it offers, and stop it again. Only ever on a press. */
  connectedCheck(name: string, where?: Where): Promise<Result<ConnectedHealth>>;
  /** Write the whole list back. */
  connectedSave(tools: readonly Connected[], where?: Where): Promise<Result<ConnectedState>>;

  /** Everything changed in the folder and not saved yet, as a diff to read. */
  changesLook(where?: Where): Promise<Result<string>>;
  /** One file of that change again, with `context` lines around it. What git
   *  did not send cannot be worked out from what it did. */
  changesWider(file: string, context: number, where?: Where): Promise<Result<string>>;
  /** Take the named parts back out. The patch is what to undo, not what to keep. */
  changesDrop(patch: string, where?: Where): Promise<Result<null>>;

  /** Take everything waiting behind the run back, so it can be rewritten. What
   *  comes back is what was queued, in the order it was asked for. */
  takeBackQueue(where?: Where): Promise<Result<{ steering: readonly string[]; followUp: readonly string[] }>>;

  /** Everything happening for this project whether or not the window is open. */
  away(where?: Where): Promise<Result<Away>>;

  /** Start a piece of work that carries on with the window closed. It runs in
   *  its own copy, so the folder on screen is untouched until it is kept.
   *  `untilDone` is the overnight mode: full access, no questions, wall clock. */
  keepGoing(text: string, untilDone?: boolean, where?: Where): Promise<Result<Away>>;
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
  /** Follow along while any of that changes, including while the window was
   *  away and has just come back. Returns the function that stops listening. */
  onAway(listener: (notice: AwayNotice) => void): () => void;
  /** The checklist moved while a reply was still going — the model ticked
   *  something off. Without this the list only catches up when the reply ends,
   *  which is exactly when nobody is still watching it. */
  onBuildPlan(
    listener: (notice: { project: string; address: string; plan: BuildPlan | null }) => void,
  ): () => void;

  /** Where the app has got to carrying a job on by itself, drawn as the one
   *  line under the reply with a Stop beside it. */
  onContinuation(listener: (notice: ContinuationNotice) => void): () => void;
  onNewerVersion(listener: (one: NewerVersion) => void): () => void;
  /** What this machine is missing, so a missing git or npm is visible with
   *  nothing open. Asked for on launch as well as pushed. */
  appNotices(): Promise<Result<readonly AppNotice[]>>;
  onAppNotice(listener: (notice: AppNotice) => void): () => void;
  /** Stop it carrying on, from that Stop or from Escape. */
  continuationStop(where?: Where): Promise<Result<null>>;

  /** A press in the app's own menu the window is the one to act on. */
  onMenu(listener: (notice: { id: string }) => void): () => void;
  /** Everything worth sending when somebody says "it stopped". Copyable, and
   *  it never carries a conversation or a key. */
  diagnostics(): Promise<Result<string>>;

  /**
   * A credential the app itself needs — the Figma token today.
   *
   * Kept in the login keychain, never in a file in the clear. Reading it back
   * is never offered: what a person needs to know is whether one is held, which
   * is what `credentialsKept` answers.
   */
  keepCredential(name: string, value: string): Promise<Result<{ ok: boolean; why?: string }>>;
  credentialsKept(): Promise<Result<{ canKeep: boolean; held: readonly string[] }>>;

  /**
   * How much room this app is taking, per folder, and what could be cleared.
   *
   * Nothing pruned any of it before, and it grows for as long as the app is
   * installed. Never counted as clearable: a copy still holding work nobody has
   * taken in.
   */
  /** Which build this is. Nothing in the window said it before, so a friend on
   *  an old build had no way to find out and no way to say which. */
  appVersion(): Promise<Result<string>>;
  /**
   * What this model was measured doing on a long job, or null for one nothing
   * has measured.
   *
   * Written by the bench script, read here, said in the model chip — so a model
   * known to stop early says so before somebody starts a night's work on it
   * rather than after.
   */
  longJobs(providerId: string, modelId: string): Promise<Result<string | null>>;
  /**
   * What each installed add-on will actually do, and how many processes they
   * have running.
   *
   * Derived by asking each add-on rather than from a list of package names, so
   * one published tomorrow is described on the same evidence as one installed
   * today.
   */
  addons(): Promise<Result<AddonReport>>;
  storage(): Promise<Result<StorageNow>>;
  clearFolder(name: string): Promise<Result<StorageNow>>;
  clearFinishedWork(): Promise<Result<{ removed: number; freed: number; says: string }>>;
};
