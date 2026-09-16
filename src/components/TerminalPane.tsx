import { useEffect, useRef, useState } from 'react';

import { bridge } from '../lib/bridge';
import type { TerminalKind, TerminalSession } from '../lib/ipc';
import '@xterm/xterm/css/xterm.css';
import './TerminalPane.css';

type Props = {
  /** The folder this terminal belongs to, so the header can say where it is. */
  workspace: string | null;
  conversation?: string | null;
  /** Whether the pane is on. Nothing is started until it is. */
  open: boolean;
  onClose: () => void;
};

export const SAYS = {
  heading: 'Terminal',
  shell: (name: string) => `${name} in`,
  start: 'Open a terminal',
  stop: 'Close terminal',
  here: 'This is your shell in this workspace. The agent is not watching it.',
  gone: 'That shell has ended.',
  unavailable: 'No terminal in this build.',
} as const;

type Xterm = {
  open(host: HTMLElement): void;
  write(data: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  loadAddon?(addon: unknown): void;
  dispose(): void;
  cols: number;
  rows: number;
  resize(cols: number, rows: number): void;
  focus(): void;
};

type XtermModule = { Terminal: new (options: Record<string, unknown>) => Xterm };

type ShellOpening = Promise<Awaited<ReturnType<typeof bridge.terminalOpen>>>;
const shells = new Map<string, ShellOpening>();
const pendingShells = new WeakSet<ShellOpening>();
const closingShells = new Map<string, Promise<void>>();

function rememberOpening(owner: string, opening: ShellOpening): void {
  shells.set(owner, opening);
  pendingShells.add(opening);
  void opening.then(
    () => pendingShells.delete(opening),
    () => pendingShells.delete(opening),
  );
}

/**
 * A shell in the workspace the window is looking at.
 *
 * Deliberately not the agent's own shell tool and deliberately not guarded: the
 * header says both, because a terminal that looks like the agent's and is not
 * watched would be the worst of both. Closing the pane does not kill the shell
 * until the person says so - a build started here should outlive a glance at
 * another tab.
 */
export default function TerminalPane({ workspace, conversation, open, onClose }: Props) {
  const owner = JSON.stringify([workspace, conversation ?? null]);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [ended, setEnded] = useState<number | null>(null);
  const [stopping, setStopping] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Xterm | null>(null);
  /** Read through a ref so a keystroke does not re-run the effect that starts
   *  the shell: only the folder and the pane being on may do that. */
  const sessionRef = useRef<string | null>(null);
  sessionRef.current = session?.id ?? null;

  /* The terminal itself, once the pane is on and there is a folder to open it
     in. xterm is loaded here rather than at the top of the file so a build
     without it still starts the app. */
  useEffect(() => {
    if (!open || workspace === null || host.current === null) return;
    let live = true;
    let made: Xterm | null = null;
    let owned: string | null = null;
    let replaying = true;
    let lastSequence = 0;
    const stop: (() => void)[] = [];
    setSession(null);
    setTrouble(null);
    setEnded(null);
    setStopping(false);
    sessionRef.current = null;

    void import('@xterm/xterm')
      .then((module: unknown) => {
        if (!live) return;
        const { Terminal } = module as XtermModule;
        const one = new Terminal({
          convertEol: false,
          cursorBlink: true,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          scrollback: 5000,
          theme: { background: '#00000000' },
          // No link handling and no window openers: a sequence printed by a
          // program must not become a way to reach the browser or the clipboard.
          allowProposedApi: false,
        });
        if (host.current !== null) one.open(host.current);
        made = one;
        term.current = one;

        const fit = (): void => {
          const element = host.current;
          const screen = element?.querySelector('.xterm-screen');
          if (element === null || screen === null || screen === undefined) return;
          const bounds = screen.getBoundingClientRect();
          const cellWidth = bounds.width / one.cols;
          const cellHeight = bounds.height / one.rows;
          if (cellWidth <= 0 || cellHeight <= 0) return;
          const style = getComputedStyle(element);
          const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 15;
          const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
          const cols = Math.max(2, Math.min(500, Math.floor(width / cellWidth)));
          const rows = Math.max(2, Math.min(300, Math.floor(height / cellHeight)));
          if (cols !== one.cols || rows !== one.rows) one.resize(cols, rows);
          if (owned !== null) void bridge.terminalResize(owned, cols, rows);
        };
        const observer = new ResizeObserver(fit);
        if (host.current !== null) observer.observe(host.current);
        stop.push(() => observer.disconnect());
        fit();

        const pending: { id: string; data: string; sequence: number }[] = [];
        stop.push(bridge.onTerminalData((chunk) => {
          if (!live) return;
          if (owned === null || replaying) pending.push(chunk);
          else if (chunk.id === owned && chunk.sequence > lastSequence) {
            one.write(chunk.data);
            lastSequence = chunk.sequence;
          }
        }));
        stop.push(bridge.onTerminalExit((exit) => {
          if (live && exit.id === owned) {
            shells.delete(owner);
            setEnded(exit.code);
          }
        }));

        const where = {
          project: workspace,
          ...(conversation == null ? {} : { conversation }),
        };
        const openOrReuse = async (): Promise<Awaited<ReturnType<typeof bridge.terminalOpen>>> => {
          const listed = await bridge.terminalList(where);
          const existing = listed.ok ? listed.value.find((item) => item.kind === 'shell' && item.exit === null) : undefined;
          return existing === undefined
            ? bridge.terminalOpen({ cols: one.cols, rows: one.rows, kind: 'shell' as TerminalKind }, where)
            : { ok: true as const, value: existing };
        };
        let opening = shells.get(owner);
        if (opening === undefined) {
          opening = Promise.resolve(closingShells.get(owner)).then(openOrReuse);
          rememberOpening(owner, opening);
        } else if (!pendingShells.has(opening)) {
          /* A hidden pane stops listening to exit notices, so its resolved
             promise can outlive the shell it names. Validate that cached id on
             every remount. The validation itself replaces the owner promise,
             which makes simultaneous remounts share one replacement rather than
             each opening a duplicate shell. */
          const cached = opening;
          opening = cached.then(async (answer) => {
            if (!answer.ok) return openOrReuse();
            const listed = await bridge.terminalList(where);
            if (!listed.ok) return answer;
            const live = listed.value.find((item) => item.kind === 'shell' && item.exit === null);
            if (live !== undefined) return { ok: true as const, value: live };
            return bridge.terminalOpen({ cols: one.cols, rows: one.rows, kind: 'shell' as TerminalKind }, where);
          });
          rememberOpening(owner, opening);
        }
        void opening.then(async (answer) => {
          if (!live) return;
          if (!answer.ok) {
            shells.delete(owner);
            setTrouble(answer.trouble.because);
            return;
          }
          owned = answer.value.id;
          sessionRef.current = owned;
          setSession(answer.value);
          const back = await bridge.terminalScrollback(owned);
          if (!live) return;
          if (back.ok) {
            one.write(back.value.data);
            lastSequence = back.value.sequence;
          }
          for (const chunk of pending) if (chunk.id === owned && chunk.sequence > lastSequence) {
            one.write(chunk.data);
            lastSequence = chunk.sequence;
          }
          pending.length = 0;
          replaying = false;
          fit();
          one.focus();
        }).catch((cause: unknown) => {
          shells.delete(owner);
          if (live) setTrouble(cause instanceof Error ? cause.message : SAYS.unavailable);
        });

        const input = one.onData((data: string) => {
          const id = sessionRef.current;
          if (id === null) return;
          void bridge.terminalWrite(id, data);
        });
        stop.push(() => input.dispose());
      })
      .catch(() => {
        if (live) setTrouble(SAYS.unavailable);
      });

    return () => {
      live = false;
      for (const off of stop) off();
      made?.dispose();
      term.current = null;
      sessionRef.current = null;
    };
    // Only the folder and the on/off state decide whether a terminal exists;
    // the session id is read through a ref so typing does not restart it.
  }, [open, workspace, conversation, owner]);

  if (!open) return null;

  return (
    <section className="termpane" aria-label={SAYS.heading}>
      <header className="termpane__head">
        <h2 className="termpane__title">{SAYS.heading}</h2>
        {session === null ? null : (
          <p className="termpane__where" title={session.workspace}>{SAYS.shell(session.shell)} {session.workspace.split('/').filter(Boolean).at(-1) ?? session.workspace}</p>
        )}
        <p className="termpane__note">{SAYS.here}</p>
        <button type="button" className="termpane__close" disabled={stopping} onClick={() => {
          if (stopping) return;
          const opening = shells.get(owner);
          shells.delete(owner);
          setStopping(true);
          const id = sessionRef.current;
          const closing = (async () => {
            const close = async (sessionId: string): Promise<void> => {
              const answer = await bridge.terminalClose(sessionId);
              if (!answer.ok) throw new Error(answer.trouble.because);
            };
            if (id !== null) await close(id);
            else if (opening !== undefined) {
              const answer = await opening;
              // A failed open left no owned shell to stop; the person can
              // still dismiss the pane. Only an actual close failure keeps it
              // visible and reports trouble.
              if (answer.ok) await close(answer.value.id);
            }
          })();
          closingShells.set(owner, closing);
          void closing.then(
            () => onClose(),
            (cause: unknown) => {
              // Keep the pane open when the shell could not be stopped. The
              // failure is actionable instead of being hidden by an immediate
              // unmount, and the owner promise remains available for retry.
              if (opening !== undefined && !shells.has(owner)) shells.set(owner, opening);
              setStopping(false);
              setTrouble(cause instanceof Error ? cause.message : String(cause));
            },
          ).finally(() => {
            if (closingShells.get(owner) === closing) closingShells.delete(owner);
          });
        }}>
          {SAYS.stop}
        </button>
      </header>
      {trouble === null ? null : <p className="termpane__trouble">{trouble}</p>}
      {ended === null ? null : <p className="termpane__ended">{SAYS.gone}</p>}
      <div className="termpane__screen" ref={host} />
    </section>
  );
}
