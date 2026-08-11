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

import type { AgentEvent, Money } from '../agent/types';

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

/** A project folder, as the window refers to it. */
export type OpenedProject = {
  /** Absolute path. Shown only if the user asks for it. */
  path: string;
  /** The folder's own name, which is what people call their project. */
  name: string;
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
 * One entry in the version timeline, as the window draws it.
 *
 * Deliberately not `history/timeline`'s own `Version`. That type belongs to a
 * module that spawns processes and reads folders; this one crosses a structured
 * clone into a sandbox, and the seam between them is the point of this file.
 */
export type SavedVersion = {
  id: string;
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
};

/** One model, named by the provider it belongs to and its own id. Both ids are
 *  the provider's own — the window stores them and never invents them. */
export type ModelChoice = { providerId: string; modelId: string };

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
  models: readonly ModelOption[];
};

/** The whole state of "who can think for me", asked for by the window and
 *  rebuilt by the shell each time — credentials change on another machine's
 *  login, and a stale list is worse than none. */
export type ConnectionState = {
  providers: readonly ProviderAuth[];
  /** The model chosen to work with, or null for "whatever is available". */
  chosen: ModelChoice | null;
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

/**
 * One event, and which project it belongs to.
 *
 * The envelope is the whole reason nothing leaks between projects. A reply that
 * started arriving for one folder must not land in the conversation of the one
 * somebody has just switched to, and the only process that knows which is which
 * is the one that owns the sessions. `project` is null only for something that
 * belongs to no folder at all.
 */
export type AgentNotice = { project: string | null; event: AgentEvent };

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
  preferences: 'graphe:preferences',
  setShowMe: 'graphe:set-show-me',
  hatches: 'graphe:hatches',
  openInEditor: 'graphe:open-in-editor',
  revealFolder: 'graphe:reveal-folder',
  visualChange: 'graphe:visual-change',
  visualFrames: 'graphe:visual-frames',
  connection: 'graphe:connection',
  connect: 'graphe:connect',
  connectAnswer: 'graphe:connect-answer',
  cancelConnect: 'graphe:cancel-connect',
  disconnect: 'graphe:disconnect',
  selectModel: 'graphe:select-model',
  connectStep: 'graphe:connect-step',
  discoveredAccounts: 'graphe:discovered-accounts',
  importAccount: 'graphe:import-account',
  openLink: 'graphe:open-link',
} as const;

/**
 * Everything the window may ask the shell to do. All of it.
 *
 * There is no `invoke(channel, ...args)` here on purpose. A generic escape hatch
 * would mean the renderer — the one process that loads other people's HTML,
 * other people's CSS and, one day, other people's previews — could reach any
 * handler the main process has ever registered. A dozen named verbs can still be
 * read in one sitting and audited in another; a wildcard never can.
 */
export type GrapheApi = {
  /** Work in this folder from now on. A folder that is already open is resumed
   *  exactly where it was left, conversation and spend included. */
  openProject(path: string): Promise<Result<OpenedProject>>;
  /** Say something to the agent, with any pictures that go with it. Resolves
   *  when it has finished responding. */
  prompt(text: string, attachments?: readonly PromptAttachment[]): Promise<Result<null>>;
  /** Stop what it is doing. Open questions are answered no. */
  stop(): Promise<Result<null>>;
  /** Answer a question the Guard asked. False when there was no such question. */
  answer(callId: string, decision: Decision): Promise<Result<boolean>>;
  /** Ask the person to pick a folder. Null when they closed the picker. */
  chooseFolder(): Promise<Result<string | null>>;

  /** The projects this computer remembers, newest first. */
  recentProjects(): Promise<Result<readonly RecentProject[]>>;

  /** What the open project's folder looks like right now — its branch, its
   *  saved state, how it stands against the shared copy. Empty git, not an
   *  error, when the folder is not a repository. */
  overview(): Promise<Result<Overview>>;
  /** Take a project off that list. The folder itself is never touched. */
  forgetProject(path: string): Promise<Result<readonly RecentProject[]>>;

  /** Every version of the open project, newest first. Empty before anything has
   *  been saved, and empty — not a failure — when no project is open. */
  versions(): Promise<Result<readonly SavedVersion[]>>;
  /** Put the project back to a version. Undoable; see `PutBack`. */
  putBack(versionId: string): Promise<Result<PutBack>>;
  /** Give a version a name of the user's own. */
  nameVersion(versionId: string, name: string): Promise<Result<readonly SavedVersion[]>>;

  /** What this person has chosen, as remembered on this computer. */
  preferences(): Promise<Result<Preferences>>;
  /** Turn "Show me" on or off. Returns the whole set, so the window never has
   *  to reason about what it did not ask about. */
  setShowMe(on: boolean): Promise<Result<Preferences>>;

  /** What the escape hatches can offer here — which editor, if any. */
  hatches(): Promise<Result<Hatches>>;
  /** Open the project folder in the editor `hatches` named. */
  openInEditor(): Promise<Result<null>>;
  /** Show the project folder in the Finder. Always available: every project is
   *  an ordinary folder, and this is the one hatch that cannot fail to exist. */
  revealFolder(): Promise<Result<null>>;

  /** Make the project, then open the made thing in their own browser. */
  show(): Promise<Result<ShowOutcome>>;
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
  selectModel(choice: ModelChoice): Promise<Result<Preferences>>;
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
};
