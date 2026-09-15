import { useEffect, useRef, useState } from 'react';

import { bridge } from '../lib/bridge';
import type { TerminalKind, TerminalSession } from '../lib/ipc';
import './TerminalPane.css';

type Props = {
  /** The folder this terminal belongs to, so the header can say where it is. */
  workspace: string | null;
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
  focus(): void;
};

type XtermModule = { Terminal: new (options: Record<string, unknown>) => Xterm };

/**
 * A shell in the workspace the window is looking at.
 *
 * Deliberately not the agent's own shell tool and deliberately not guarded: the
 * header says both, because a terminal that looks like the agent's and is not
 * watched would be the worst of both. Closing the pane does not kill the shell
 * until the person says so - a build started here should outlive a glance at
 * another tab.
 */
export default function TerminalPane({ workspace, open, onClose }: Props) {
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [ended, setEnded] = useState<number | null>(null);
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
    const stop: (() => void)[] = [];

    void import('@xterm/xterm')
      .then((module: unknown) => {
        if (!live) return;
        const { Terminal } = module as XtermModule;
        const one = new Terminal({
          convertEol: false,
          cursorBlink: true,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          theme: { background: '#00000000' },
          // No link handling and no window openers: a sequence printed by a
          // program must not become a way to reach the browser or the clipboard.
          allowProposedApi: false,
        });
        if (host.current !== null) one.open(host.current);
        made = one;
        term.current = one;

        void bridge.terminalOpen({ cols: one.cols, rows: one.rows, kind: 'shell' as TerminalKind }, {
          project: workspace,
        }).then(async (answer) => {
          if (!live) return;
          if (!answer.ok) {
            setTrouble(answer.trouble.because);
            return;
          }
          setSession(answer.value);
          const back = await bridge.terminalScrollback(answer.value.id);
          if (live && back.ok && back.value !== '') one.write(back.value);
        });

        stop.push(bridge.onTerminalData((chunk) => one.write(chunk.data)));
        stop.push(
          bridge.onTerminalExit((exit) => {
            setEnded(exit.code);
          }),
        );
        one.onData((data: string) => {
          const id = sessionRef.current;
          if (id === null) return;
          void bridge.terminalWrite(id, data);
        });
      })
      .catch(() => {
        if (live) setTrouble(SAYS.unavailable);
      });

    return () => {
      live = false;
      for (const off of stop) off();
      made?.dispose();
      term.current = null;
    };
    // Only the folder and the on/off state decide whether a terminal exists;
    // the session id is read through a ref so typing does not restart it.
  }, [open, workspace]);

  /* The pane's size follows the window. A pty that is not told will wrap the
     shell's own output at the wrong column and every full-screen program
     redraws wrong. */
  useEffect(() => {
    if (!open || session === null) return;
    const resize = (): void => {
      const one = term.current;
      if (one === null) return;
      void bridge.terminalResize(session.id, one.cols, one.rows);
    };
    const listener = new ResizeObserver(resize);
    if (host.current !== null) listener.observe(host.current);
    resize();
    return () => listener.disconnect();
  }, [open, session]);

  if (!open) return null;

  return (
    <section className="termpane" aria-label={SAYS.heading}>
      <header className="termpane__head">
        <h2 className="termpane__title">{SAYS.heading}</h2>
        {session === null ? null : (
          <p className="termpane__where">{SAYS.shell(session.shell)}</p>
        )}
        <p className="termpane__note">{SAYS.here}</p>
        <button type="button" className="termpane__close" onClick={onClose}>
          {SAYS.stop}
        </button>
      </header>
      {trouble === null ? null : <p className="termpane__trouble">{trouble}</p>}
      {ended === null ? null : <p className="termpane__ended">{SAYS.gone}</p>}
      <div className="termpane__screen" ref={host} />
    </section>
  );
}
