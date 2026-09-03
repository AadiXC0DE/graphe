/** The drawer along the bottom: what was run, and what is still talking.
 *
 * Read-only tabs and nothing to type into. The agent's tab is the conversation
 * read back as a list of commands, every server left running gets one of its
 * own with its own tail, and the page beside the conversation gets one for
 * whatever it printed. A shell of your own is the fourth kind
 * `work/terminals.ts` models and the one this does not draw yet.
 *
 * A tab that moves is asked again on a timer rather than pushed: the drawer
 * only reads while it is open, on the tab in front, in a window that is being
 * looked at, so nothing is carried across the wire that nobody is reading.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RunningPiece } from '../lib/ipc';
import type { Turn } from '../lib/thread';
import { saysLevel, tabsWords, type Said } from '../preview/tabs';
import { useWindowed } from '../lib/windowed';
import {
  COMMANDS_WORDS,
  commandsRan,
  saysEnded,
  serverTitle,
  tailOf,
  type CommandRan,
} from '../work/commands-ran';
import { terminalWords } from '../work/terminals';
import './Commands.css';

/** How often a server's tail is read again while its tab is in front. Slow
 *  enough to be free, quick enough that a page that failed to load and the line
 *  saying why arrive together. */
export const LOOK_EVERY = 700;

type Props = {
  open: boolean;
  onClose: () => void;
  /** The conversation in front, whose commands the first tab lists. */
  turns: readonly Turn[];
  /** Everything this conversation has left running. */
  servers: readonly RunningPiece[];
  /** Everything one of them has said, whole. */
  onSaid: (id: string) => Promise<string>;
  onStop: (id: string) => void;
  onOpenAddress: (address: string) => void;
  /** Where the page beside the conversation is pointed, or null when there is
   *  no page open. No page, no tab. */
  page?: string | null;
  /** What that page has printed. */
  onPageSaid?: () => Promise<readonly Said[]>;
};

/** Whether this window is the one being looked at. The timer rests when it is
 *  not, so a drawer left open behind another window costs nothing. */
function useFocused(): boolean {
  const [focused, setFocused] = useState(
    typeof document === 'undefined' ? true : document.hasFocus(),
  );
  useEffect(() => {
    const on = (): void => setFocused(true);
    const off = (): void => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  return focused;
}

/** The page's tab, which only exists while a page does. */
const PAGE = 'page';

/** One note, told apart from every other by what it says rather than by an id:
 *  the shell hands the list back afresh on every read, so an id is only stable
 *  for as long as nothing above it changed. */
function keyOf(one: Said): string {
  return `${one.level}\u0000${one.where ?? ''}\u0000${one.text}`;
}

export default function Commands(props: Props) {
  const { open, onClose, turns, servers, onStop, onOpenAddress, page = null } = props;
  const focused = useFocused();
  /* The window hands these down as fresh closures every render, and an effect
     that depended on their identity would tear its own timer down and start
     over on each one. */
  const asks = useRef({ said: props.onSaid, pageSaid: props.onPageSaid });
  asks.current = { said: props.onSaid, pageSaid: props.onPageSaid };
  const [at, setAt] = useState('agent');
  /** How much of each tab has been cleared away, by tab. */
  const [cleared, setCleared] = useState<Record<string, number>>({});
  const [said, setSaid] = useState<Record<string, string>>({});
  /** What each note had been printed by the time somebody pressed Clear. */
  const [pageCleared, setPageCleared] = useState<Record<string, number>>({});
  const [printed, setPrinted] = useState<readonly Said[]>([]);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const rows = useMemo(() => commandsRan(turns), [turns]);
  const tabs = useMemo(
    () => [
      { id: 'agent', title: COMMANDS_WORDS.agent },
      ...servers.map((one) => ({ id: one.id, title: serverTitle(one) })),
      ...(page === null ? [] : [{ id: PAGE, title: COMMANDS_WORDS.page }]),
    ],
    [servers, page],
  );

  /* A new page has nothing against it, so nothing is still being hidden from
     the last one. */
  useEffect(() => {
    setPageCleared({});
    setPrinted([]);
  }, [page]);

  /* A server that has been stopped and forgotten takes its tab with it, so the
     strip never points at something that is not there. */
  useEffect(() => {
    if (!tabs.some((one) => one.id === at)) setAt('agent');
  }, [tabs, at]);

  const server = servers.find((one) => one.id === at) ?? null;
  const serverId = server?.id ?? null;

  useEffect(() => {
    if (!open || !focused || serverId === null) return;
    let stopped = false;
    const look = (): void => {
      void asks.current.said(serverId).then((text) => {
        if (stopped) return;
        setSaid((was) => (was[serverId] === text ? was : { ...was, [serverId]: text }));
      });
    };
    look();
    const timer = setInterval(look, LOOK_EVERY);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open, focused, serverId]);

  /* The same rule as a server's tail, for the same reason. */
  useEffect(() => {
    if (!open || !focused || at !== PAGE || page === null) return;
    let stopped = false;
    const look = (): void => {
      void asks.current.pageSaid?.().then((lot) => {
        if (!stopped && lot !== undefined) setPrinted(lot);
      });
    };
    look();
    const timer = setInterval(look, LOOK_EVERY);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [open, focused, at, page]);

  /** What the page has printed that has not been cleared away. A note printed
   *  again after a Clear comes back, because it happened again. */
  const notes = useMemo(
    () =>
      printed
        .map((one) => ({ ...one, many: one.many - (pageCleared[keyOf(one)] ?? 0) }))
        .filter((one) => one.many > 0),
    [printed, pageCleared],
  );

  const clear = useCallback(() => {
    if (at === PAGE) {
      setPageCleared(Object.fromEntries(printed.map((one) => [keyOf(one), one.many])));
      return;
    }
    const size = at === 'agent' ? rows.length : (said[at]?.split('\n').length ?? 0);
    setCleared((was) => ({ ...was, [at]: size }));
  }, [at, rows.length, said, printed]);

  if (!open) return null;

  const gone = cleared[at] ?? 0;
  const shown = at === 'agent' ? rows.slice(gone) : [];
  const lines =
    server === null ? '' : tailOf(dropLines(said[server.id] ?? '', gone));

  return (
    <section className="commands" aria-label={COMMANDS_WORDS.name}>
      <div className="commands__strip" role="tablist" aria-label={COMMANDS_WORDS.name}>
        {tabs.map((one) => (
          <button
            key={one.id}
            type="button"
            role="tab"
            aria-selected={one.id === at}
            className={`commands__tab ${one.id === at ? 'commands__tab--here' : ''}`}
            onClick={() => setAt(one.id)}
          >
            {one.title}
          </button>
        ))}
        <span className="commands__spacer" />
        {server?.address == null ? null : (
          <button
            type="button"
            className="commands__press"
            onClick={() => onOpenAddress(server.address ?? '')}
          >
            {COMMANDS_WORDS.open}
          </button>
        )}
        {server === null || server.state !== 'running' ? null : (
          <button type="button" className="commands__press" onClick={() => onStop(server.id)}>
            {COMMANDS_WORDS.stop}
          </button>
        )}
        <button type="button" className="commands__press" onClick={clear}>
          {COMMANDS_WORDS.clear}
        </button>
        <button
          type="button"
          className="commands__press"
          onClick={onClose}
          title={COMMANDS_WORDS.hide}
        >
          {COMMANDS_WORDS.close}
        </button>
      </div>

      {at === 'agent' ? (
        <AgentTab rows={shown} openRow={openRow} onRow={setOpenRow} />
      ) : at === PAGE ? (
        <PageTab notes={notes} />
      ) : (
        <pre className="commands__tail scroll--auto">
          {lines === '' ? terminalWords.serverNote : lines}
        </pre>
      )}
    </section>
  );
}

/** Everything past the first `many` lines. Clearing a server's tab hides what
 *  is already there without asking the server to forget it. */
function dropLines(text: string, many: number): string {
  if (many <= 0) return text;
  const lines = text.split('\n');
  return lines.length <= many ? '' : lines.slice(many).join('\n');
}

/* -------------------------------------------------------------------------- */
/* The page's tab                                                              */
/* -------------------------------------------------------------------------- */

/** What the page printed. The level is on the row in words as well as in
 *  colour, so a problem is a problem to somebody who cannot see the red. */
function PageTab(props: { notes: readonly Said[] }) {
  const { notes } = props;
  if (notes.length === 0) {
    return <p className="commands__empty">{tabsWords.consoleEmpty}</p>;
  }
  return (
    <ul className="commands__notes scroll--auto">
      {notes.map((one) => (
        <li key={keyOf(one)} className={`commands__note commands__note--${one.level}`}>
          <span className="commands__level">{saysLevel(one.level)}</span>
          <span className="commands__text">{one.text}</span>
          {one.many > 1 ? <span className="commands__many">{`\u00d7 ${String(one.many)}`}</span> : null}
          {one.where === null ? null : <span className="commands__where">{one.where}</span>}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* The agent's tab                                                             */
/* -------------------------------------------------------------------------- */

function AgentTab(props: {
  rows: readonly CommandRan[];
  openRow: string | null;
  onRow: (id: string | null) => void;
}) {
  const { rows, openRow, onRow } = props;
  const scroller = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const span = useWindowed(rows.length, { scroller, list, guess: 26 });

  /* Newest at the bottom, so the drawer opens on the command that just ran. */
  const count = rows.length;
  useEffect(() => {
    const pane = scroller.current;
    if (pane !== null) pane.scrollTop = pane.scrollHeight;
  }, [count]);

  if (rows.length === 0) {
    return <p className="commands__empty">{COMMANDS_WORDS.none}</p>;
  }

  return (
    <div className="commands__pane scroll--auto" ref={scroller}>
      <div ref={list}>
        <div style={{ height: span.before }} />
        {rows.slice(span.first, span.last).map((one, index) => {
          const here = span.first + index;
          const shown = openRow === one.id;
          return (
            <div
              key={one.id}
              className="commands__row"
              ref={(el) => span.measure(here, el)}
            >
              <button
                type="button"
                className="commands__line"
                aria-expanded={shown}
                onClick={() => onRow(shown ? null : one.id)}
              >
                <code className="commands__cmd">
                  <span className="commands__sign" aria-hidden="true">$</span> {one.command}
                </code>
                <span className={`commands__ended commands__ended--${one.ended}`}>
                  {saysEnded(one)}
                </span>
              </button>
              {shown ? (
                <pre className="commands__out">
                  {one.output === '' ? COMMANDS_WORDS.noOutput : tailOf(one.output)}
                </pre>
              ) : null}
            </div>
          );
        })}
        <div style={{ height: span.after }} />
      </div>
    </div>
  );
}
