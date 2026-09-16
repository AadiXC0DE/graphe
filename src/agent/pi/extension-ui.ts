/** What an add-on asks the person, and what the person answers.
 *
 * Pi's extension API has a full UI context; without one bound, an installed
 * add-on that asks a question gets the default interface, which selects
 * nothing, declines everything and drops notifications on the floor. That is
 * the worst of both: the add-on carries on as though somebody answered, and the
 * person never saw the question.
 *
 * So this host answers the dialog-capable half of the contract for real, and is
 * honest about the half that is a terminal: a widget, a footer or a custom
 * component cannot be drawn here, and saying so once, out loud, is the only
 * truthful thing to do about it. `mode: 'rpc'` is what that means in Pi's own
 * terms — dialogs yes, composited terminal UI no.
 *
 * One request at a time per session is not enforced here: the asker is the
 * extension runtime, and two add-ons asking at once is Pi's to sequence.
 */

import type { ExtensionAnswer, ExtensionAsk } from '../../lib/extension-ask';

export type { ExtensionAnswer, ExtensionAsk };

/** Where an answer comes from: the window, or the fact that there is no window
 *  to ask. */
export type AskTheWindow = (ask: ExtensionAsk) => Promise<ExtensionAnswer>;

/** How the host tells somebody about something that cannot be drawn. */
export type SayUnsupported = (what: string, method: string) => void;

/** The dialog half of Pi's UI contract, as much of it as is real here. */
export type DialogHost = {
  select(
    title: string,
    options: readonly string[],
    opts?: { timeout?: number },
  ): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: { timeout?: number }): Promise<boolean>;
  input(
    title: string,
    placeholder?: string,
    opts?: { timeout?: number },
  ): Promise<string | undefined>;
  editor(title: string, prefill?: string): Promise<string | undefined>;
};

/** Options carry a timeout in Pi's contract; a `timeout` of zero or less means
 *  "no timeout" and is kept as null rather than as an instant expiry. */
function timeoutOf(opts: { timeout?: number } | undefined): number | null {
  const asked = opts?.timeout;
  return typeof asked === 'number' && Number.isFinite(asked) && asked > 0 ? asked : null;
}

/**
 * The dialog host, over whatever the window can actually do.
 *
 * Values are kept apart from labels: an add-on selects `value` and shows
 * `label`, and returning the label would hand back something the add-on never
 * asked about. A cancelled dialog returns undefined, which is Pi's own
 * "nothing chosen" — never an empty string, which is a real answer.
 */
export function dialogsOver(ask: AskTheWindow): DialogHost {
  return {
    async select(title, options, opts) {
      const answer = await ask({
        kind: 'select',
        title,
        options: options.map((one) => ({ label: one, value: one })),
        timeoutMs: timeoutOf(opts),
      });
      return answer.kind === 'select' && answer.value !== null ? answer.value : undefined;
    },
    async confirm(title, message, opts) {
      const answer = await ask({ kind: 'confirm', title, message, timeoutMs: timeoutOf(opts) });
      // A confirmation nobody answered is a no. Pi's contract has no third
      // answer, and an add-on that got a yes nobody gave is the exact failure
      // this host exists to stop.
      return answer.kind === 'confirm' ? answer.value : false;
    },
    async input(title, placeholder, opts) {
      const answer = await ask({
        kind: 'input',
        title,
        placeholder: placeholder === undefined || placeholder === '' ? null : placeholder,
        timeoutMs: timeoutOf(opts),
      });
      return answer.kind === 'input' && answer.value !== null ? answer.value : undefined;
    },
    async editor(title, prefill) {
      const answer = await ask({ kind: 'editor', title, prefill: prefill ?? '' });
      return answer.kind === 'editor' && answer.value !== null ? answer.value : undefined;
    },
  };
}

/** The terminal-only half, as `unsupportedTerminal` hands it back. */
export type UnsupportedTerminal = {
  note(method: string): void;
  fail(method: string): Promise<never>;
  theme(): never;
};

/**
 * What the terminal-only half of the contract does here.
 *
 * Recorded once per method per session and said out loud once, so an add-on
 * that needs a terminal is a visible compatibility problem rather than a
 * feature that silently does nothing. Anything that returns a promise rejects:
 * a made-up component, footer or theme is a screen somebody thinks they are
 * looking at.
 */
export function unsupportedTerminal(say: SayUnsupported): UnsupportedTerminal {
  const said = new Set<string>();
  const note = (method: string): void => {
    if (said.has(method)) return;
    said.add(method);
    say('terminal', method);
  };
  return {
    note,
    fail: (method: string) => {
      note(method);
      return Promise.reject(
        new Error(`${method} needs a terminal, which this window is not`),
      ) as Promise<never>;
    },
    theme: () => {
      note('theme');
      throw new Error('a terminal theme is not available here');
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The face an add-on is handed                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The whole of Pi's extension UI context as this host binds it.
 *
 * Structurally Pi's `ExtensionUIContext` and deliberately not typed from it:
 * this folder never reaches for Pi. The dialogs are real, a notice is where the
 * app says things anyway, and the terminal's half is a refusal. What is left is
 * accepted and drawn nowhere — the working message, the spinner's visibility
 * and the window title change how a terminal looks, and there is no terminal to
 * change. They are not recorded as unsupported because a cosmetic setting an
 * add-on is free to make is not a compatibility problem, and three notices
 * about a footer would be noise rather than honesty.
 *
 * `hasUI` is true for all of this the moment Pi is given it — Pi's own answer
 * is "there is a UI context" (runner.hasUI), not "every method works" — and
 * `mode: 'rpc'` is what tells an add-on that composited terminal UI is not
 * available. Neither is a promise about the refusals below.
 */
export type UiFace = {
  select(
    title: string,
    options: readonly string[],
    opts?: { timeout?: number },
  ): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: { timeout?: number }): Promise<boolean>;
  input(
    title: string,
    placeholder?: string,
    opts?: { timeout?: number },
  ): Promise<string | undefined>;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  notify(message: string, type?: 'info' | 'warning' | 'error'): void;
  setStatus(key: string, text: string | undefined): void;
  setWorkingMessage(message?: string): void;
  setWorkingVisible(visible: boolean): void;
  setWorkingIndicator(options?: unknown): void;
  setHiddenThinkingLabel(label?: string): void;
  setTitle(title: string): void;
  onTerminalInput(handler: unknown): () => void;
  setWidget(key: string, content: unknown, options?: unknown): void;
  setFooter(factory: unknown): void;
  setHeader(factory: unknown): void;
  custom(factory: unknown, options?: unknown): Promise<never>;
  pasteToEditor(text: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
  addAutocompleteProvider(factory: unknown): void;
  setEditorComponent(factory: unknown): void;
  getEditorComponent(): undefined;
  readonly theme: never;
  getAllThemes(): { name: string; path: string | undefined }[];
  getTheme(name: string): undefined;
  setTheme(theme: unknown): { success: boolean; error?: string };
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
};

/** One add-on that could have made a call: the file that would run, and the
 *  name a person knows it by. */
export type KnownAddon = { where: string; name: string };

/**
 * Which add-on asked, read off the call stack, or null when nothing recognisable
 * did.
 *
 * Pi's `notify` is the one UI method it does not wrap to add an origin — it wraps
 * `select`, `confirm`, `input`, `editor` and `custom`, and passes this one
 * through as it arrived (`runner.js:273`) — so an add-on's notice reaches the
 * host indistinguishable from one the app said itself. The stack at the moment
 * of the call is the only account of who asked.
 *
 * Null rather than a guess: a notice fired from a timer, or from a promise chain
 * that has already left the add-on, has no frame in any of these files, and
 * naming whichever add-on happens to be loaded would be a lie a person could act
 * on. The same goes for a frame two add-ons could each claim — one add-on
 * unpacked inside another's folder, say — because a wrong name here sends
 * somebody to turn off the add-on that did nothing.
 */
export function whoCalled(
  stack: string | undefined,
  known: readonly KnownAddon[],
): string | null {
  if (stack === undefined || known.length === 0) return null;
  for (const line of stack.split('\n')) {
    const found = /\(?(?:file:\/\/)?([^)\s]+?\.(?:mjs|cjs|js|ts))(?::\d+){0,2}\)?$/.exec(line.trim());
    if (found === null) continue;
    let where = found[1] ?? '';
    try {
      where = decodeURIComponent(where);
    } catch {
      // A percent sign that is not an escape is a path, not a URI. Left as is.
    }
    // The entry file, or any module in the same folder: an add-on's own files
    // still are the add-on. The separator matters — a folder called `notice` is
    // not the add-on called `notices`.
    const inside = known.filter((one) => {
      const folder = one.where.slice(0, one.where.lastIndexOf('/') + 1);
      return folder !== '' && where.startsWith(folder);
    });
    /* Two answers is no answer. A folder holding a second add-on's folder puts
       both of their names on the same frame, and picking either — by order, by
       the longer path — is naming somebody who may not have called. */
    if (inside.length > 1) return null;
    if (inside.length === 1) return inside[0]!.name;
  }
  return null;
}

/** What to call the add-on behind a notice, or the words for one nobody could
 *  name. A notice that begins "an add-on" is worse than one that begins with a
 *  name, and both are better than a name nobody could have worked out. */
function whoName(who: string | null): string {
  return who === null || who === '' ? 'An add-on' : who;
}

/**
 * What is said about an add-on that asked for something this window cannot do.
 *
 * The name is the subject of the sentence, the way every other notice about an
 * add-on here reads, so somebody knows which one to turn off.
 */
export function saysAddonCannot(
  who: string | null,
  method: string,
  how: 'terminal' | 'window',
): string {
  return how === 'terminal'
    ? `${whoName(who)} asked for ${method}, which needs a terminal window. Nothing was drawn for it, and it was told so.`
    : `${whoName(who)} asked for something this window could not do: ${method}.`;
}

/** What is said about an add-on that fell over inside one of its own hooks.
 *  Pi hands the host the path it happened in, which is the one thing that names
 *  the add-on without guessing at it. */
export function saysAddonFailed(
  who: string | null,
  event: string | null,
  because: string | null,
): string {
  return `${whoName(who)} failed during ${event ?? 'a step'}: ${because ?? 'it did not say why'}`;
}

/** What the face is built over: the two halves above, and where a notice goes. */
export type UiFaceHost = {
  dialogs: DialogHost;
  terminal: UnsupportedTerminal;
  /** Where a notice goes. The severity travels in the words: a warning nobody
   *  can tell from a note is not a warning. The add-on's name travels with
   *  them, folded in by the face, because the host's reader of a notice is a
   *  person and not a field. */
  notify: (what: string) => void;
  /**
   * What to call the add-on making this call, or null when nothing recognisable
   * called. Reading the stack is the adapter's job — this file never reaches for
   * Pi, and the paths belong to the session rather than to the face.
   */
  who?: () => string | null;
};

/** The bound face. Read it as the list of what an add-on may call here. */
export function uiContextOver(host: UiFaceHost): UiFace {
  const { dialogs, terminal, notify, who } = host;
  const face: UiFace = {
    select: dialogs.select,
    confirm: dialogs.confirm,
    input: dialogs.input,
    editor: dialogs.editor,
    notify: (message, type) => {
      const said = type === 'error' || type === 'warning' ? `${type}: ${message}` : message;
      // The add-on first, as the one speaking, and the severity after it. A
      // notice with no name on it reads as something this app decided to say,
      // and the person has no way to tell whose word it is.
      const from = who?.() ?? null;
      notify(from === null || from === '' ? said : `${from}, ${said}`);
    },
    // A status line is a terminal's footer. There is no footer here, so it is
    // recorded and said once rather than invented into some corner of the
    // window that would then be showing something nobody put there.
    setStatus: () => terminal.note('setStatus'),
    setWorkingMessage: () => undefined,
    setWorkingVisible: () => undefined,
    setWorkingIndicator: () => undefined,
    setHiddenThinkingLabel: () => undefined,
    setTitle: () => undefined,
    // Terminal-only, and said so rather than silently succeeding.
    onTerminalInput: () => {
      terminal.note('onTerminalInput');
      return () => undefined;
    },
    setWidget: () => terminal.note('setWidget'),
    setFooter: () => terminal.note('setFooter'),
    setHeader: () => terminal.note('setHeader'),
    custom: () => terminal.fail('custom'),
    pasteToEditor: () => terminal.note('pasteToEditor'),
    setEditorText: () => terminal.note('setEditorText'),
    getEditorText: () => {
      terminal.note('getEditorText');
      return '';
    },
    addAutocompleteProvider: () => terminal.note('addAutocompleteProvider'),
    setEditorComponent: () => terminal.note('setEditorComponent'),
    getEditorComponent: () => {
      terminal.note('getEditorComponent');
      return undefined;
    },
    get theme() {
      return terminal.theme();
    },
    getAllThemes: () => {
      terminal.note('getAllThemes');
      return [];
    },
    getTheme: () => {
      terminal.note('getTheme');
      return undefined;
    },
    setTheme: () => {
      terminal.note('setTheme');
      return { success: false, error: 'this window has no terminal theme' };
    },
    getToolsExpanded: () => false,
    setToolsExpanded: () => terminal.note('setToolsExpanded'),
  };

  /* Pi copies this object with a spread as it binds it, and a spread reads
     every enumerable getter — so the refusal above used to take the whole
     binding with it: no dialog, no notice, for any add-on in any conversation.
     The refusal stays exactly as it is; it is simply not part of the copy. */
  const theme = Object.getOwnPropertyDescriptor(face, 'theme');
  if (theme !== undefined) Object.defineProperty(face, 'theme', { ...theme, enumerable: false });
  return face;
}
