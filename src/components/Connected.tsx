import { useEffect, useState } from 'react';
import type { Connected as Tool, ConnectedHealth, ConnectedState } from '../lib/ipc';
import { fromConnectLine } from '../lib/attachments';
import './Sheet.css';
import './Connected.css';

type Props = {
  open: boolean;
  state: ConnectedState | null;
  onClose: () => void;
  onCheck: (name: string) => Promise<ConnectedHealth>;
  onSave: (tools: readonly Tool[]) => Promise<void>;
};

export const SAYS = {
  heading: 'Other tools',
  what: 'Tools this project can reach — a design file, a database, whatever speaks the protocol. Each one is a program on this computer, started only when it is asked for.',
  none: 'Nothing else is connected yet.',
  noneWhat: 'Connect one and I can use it the way I use everything else.',
  add: 'Connect a tool',
  check: 'Check it',
  checking: 'Checking…',
  remove: 'Disconnect',
  save: 'Save',
  cancel: 'Cancel',
  name: 'What to call it',
  namePlaceholder: 'figma',
  command: 'How to reach it',
  commandPlaceholder: 'npx figma-developer-mcp --stdio, or http://127.0.0.1:3845/mcp',
  unknown: 'Not checked',
  working: 'Answering',
  broken: 'Would not start',
  needsBoth: 'It needs a name, and either a command that starts it or an address it answers on.',
  taken: 'Something else is connected under that name.',
  /** In place of the list and the Connect button, when the list would not read.
   *  Saying "nothing is connected" there is a claim about a state nobody
   *  knows. */
  cannotChange: 'Until this file reads, I cannot say what is connected, and nothing can be connected or disconnected.',
  offers: (many: number): string =>
    many === 0 ? 'Started, but offered nothing' : many === 1 ? '1 tool' : `${String(many)} tools`,
  skipped: 'Some of the list could not be used:',
} as const;

/** The command and its arguments as one line to type, and back again. Nobody
 *  wants two boxes for one command they already know how to write. */
function asLine(tool: Tool): string {
  // A tool already running is named by where it answers, not by a command
  // nobody types.
  if (tool.address !== undefined && tool.address !== '') return tool.address;
  return [tool.command, ...tool.args].filter((one) => one !== '').join(' ');
}


/**
 * The other tools, and whether they answer.
 *
 * Three states per tool and never two: not checked, answering, would not start.
 * Nothing is checked on this screen's behalf — starting one of these is running
 * a program with the powers of this computer, so it happens when somebody
 * presses the button and not before.
 */
export default function Connected({ open, state, onClose, onCheck, onSave }: Props) {
  const [health, setHealth] = useState<Readonly<Record<string, ConnectedHealth>>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [line, setLine] = useState('');
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setAdding(false);
    setName('');
    setLine('');
    setRefused(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const shut = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', shut);
    return () => window.removeEventListener('keydown', shut);
  }, [open, onClose]);

  if (!open) return null;
  const tools = state?.tools ?? [];
  // The file is the only copy of everything this panel is not shown, so a save
  // over one that would not read is that copy gone. Not offered here, and
  // turned down by the shell either way.
  const unreadable = state !== null && state.trouble !== null;

  const check = (which: string): void => {
    setChecking(which);
    void onCheck(which)
      .then((answer) => setHealth((was) => ({ ...was, [which]: answer })))
      .finally(() => setChecking(null));
  };

  const connect = (): void => {
    const made = fromConnectLine(name, line);
    if (made === null) {
      setRefused(SAYS.needsBoth);
      return;
    }
    if (tools.some((one) => one.name === made.name)) {
      setRefused(SAYS.taken);
      return;
    }
    setRefused(null);
    void onSave([...tools, made]).then(() => {
      setAdding(false);
      setName('');
      setLine('');
    });
  };

  const disconnect = (which: string): void => {
    setHealth((was) => {
      const { [which]: _gone, ...rest } = was;
      return rest;
    });
    void onSave(tools.filter((one) => one.name !== which));
  };

  return (
    <section className="sheet" aria-label={SAYS.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{SAYS.heading}</h1>
          <p className="wired__what">{SAYS.what}</p>
        </div>
        <div className="sheet__chips" />
        <button type="button" className="sheet__close" onClick={onClose}>
          Close
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div className="sheet__body">
        <div className="wired">

      {/* The list itself would not read. Said first and whole: until this is
          fixed nothing is connected, whatever the file appears to contain. */}
      {state?.trouble == null ? null : (
        <p className="wired__trouble" role="status">
          {state.trouble}
        </p>
      )}

      {state === null || state.skipped.length === 0 ? null : (
        <div className="wired__skipped">
          <p>{SAYS.skipped}</p>
          <ul>
            {state.skipped.map((one) => (
              <li key={one}>{one}</li>
            ))}
          </ul>
        </div>
      )}

      {unreadable ? (
        <p className="wired__cannot">{SAYS.cannotChange}</p>
      ) : tools.length === 0 && !adding ? (
        <div className="wired__none">
          <p className="wired__nonetitle">{SAYS.none}</p>
          <p className="wired__nonewhat">{SAYS.noneWhat}</p>
        </div>
      ) : (
        <ul className="wired__list">
          {tools.map((tool) => {
            const said = health[tool.name] ?? { state: 'unknown' as const };
            const busy = checking === tool.name;
            return (
              <li key={tool.name} className="wired__one">
                <div className="wired__said">
                  <p className="wired__name">
                    {tool.name}
                    <span className={`wired__state wired__state--${said.state}`}>
                      <span className="wired__dot" aria-hidden="true" />
                      {said.state === 'working'
                        ? SAYS.working
                        : said.state === 'would-not-start'
                          ? SAYS.broken
                          : SAYS.unknown}
                    </span>
                  </p>
                  <code className="wired__command">{asLine(tool)}</code>
                  {said.state === 'working' ? (
                    <p className="wired__offers">
                      {SAYS.offers(said.tools.length)}
                      {said.tools.length > 0 ? `: ${said.tools.join(', ')}` : ''}
                    </p>
                  ) : null}
                  {said.state === 'would-not-start' ? (
                    <p className="wired__because">{said.because}</p>
                  ) : null}
                </div>
                <div className="wired__does">
                  <button
                    type="button"
                    className="wired__do"
                    onClick={() => check(tool.name)}
                    disabled={busy}
                  >
                    {busy ? SAYS.checking : SAYS.check}
                  </button>
                  <button
                    type="button"
                    className="wired__quietdo"
                    onClick={() => disconnect(tool.name)}
                  >
                    {SAYS.remove}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {unreadable ? null : adding ? (
        <div className="wired__add">
          <label className="wired__field">
            <span className="wired__label">{SAYS.name}</span>
            <input
              className="wired__box"
              value={name}
              placeholder={SAYS.namePlaceholder}
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
                setRefused(null);
              }}
            />
          </label>
          <label className="wired__field">
            <span className="wired__label">{SAYS.command}</span>
            <input
              className="wired__box"
              value={line}
              placeholder={SAYS.commandPlaceholder}
              onChange={(event) => {
                setLine(event.target.value);
                setRefused(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') connect();
              }}
            />
          </label>
          {refused === null ? null : <p className="wired__refused">{refused}</p>}
          <div className="wired__does">
            <button type="button" className="wired__do" onClick={connect}>
              {SAYS.save}
            </button>
            <button
              type="button"
              className="wired__quietdo"
              onClick={() => {
                setAdding(false);
                setRefused(null);
              }}
            >
              {SAYS.cancel}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="wired__new" onClick={() => setAdding(true)}>
          {SAYS.add}
        </button>
      )}

          {/* Where the list really lives, for whoever would rather open it. */}
          {state === null ? null : <p className="wired__file">{state.file}</p>}
        </div>
      </div>
    </section>
  );
}
