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

/**
 * What the terminal-only half of the contract does here.
 *
 * Recorded once per method per session and said out loud once, so an add-on
 * that needs a terminal is a visible compatibility problem rather than a
 * feature that silently does nothing. Anything that returns a promise rejects:
 * a made-up component, footer or theme is a screen somebody thinks they are
 * looking at.
 */
export function unsupportedTerminal(say: SayUnsupported): {
  note(method: string): void;
  fail(method: string): Promise<never>;
  theme(): never;
} {
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
