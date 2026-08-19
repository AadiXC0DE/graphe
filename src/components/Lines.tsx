import { useEffect, useMemo, useRef, useState } from 'react';

import type { GitBranch } from '../lib/ipc';
import { LINE_WORDS, linesMatching, refuseName, saysStanding } from '../lib/lines';
import './Lines.css';

type Props = {
  branches: readonly GitBranch[];
  /** The name to show when no line is marked current — a project with nothing
   *  saved yet still sits somewhere. */
  fallback: string | null;
  busy?: boolean;
  onSwitch: (name: string) => void;
  onCreate: (name: string) => void;
};

/**
 * The line of work, and the one press that changes it.
 *
 * The name was a label for a long time, which meant the answer to "how do I get
 * onto the other one?" was to open a different view and find a list. It is the
 * thing people reach for, so it is the thing that opens.
 */
export default function Lines({ branches, fallback, busy = false, onSwitch, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [naming, setNaming] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const here = branches.find((one) => one.current) ?? null;
  const name = here?.name ?? fallback ?? 'main';
  const showing = useMemo(() => linesMatching(branches, naming ? '' : typed), [branches, typed, naming]);
  const refused = naming ? refuseName(typed, branches) : null;

  useEffect(() => {
    if (open) return;
    setTyped('');
    setNaming(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current?.contains(event.target as Node) === false) setOpen(false);
    };
    const shut = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', shut);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', shut);
    };
  }, [open]);

  const make = (): void => {
    const wanted = typed.trim();
    if (wanted === '' || refused !== null) return;
    setOpen(false);
    onCreate(wanted);
  };

  return (
    <div className="lines" ref={root}>
      <button
        type="button"
        className="lines__now"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={LINE_WORDS.open}
        disabled={busy}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="lines__dot" aria-hidden="true" />
        <span className="lines__name">{name}</span>
        <span className="lines__caret" aria-hidden="true">
          ⌄
        </span>
      </button>
      <span className="lines__plainly">{LINE_WORDS.plainly}</span>

      {!open ? null : (
        <div className="lines__menu" role="dialog" aria-label={LINE_WORDS.open}>
          {naming ? (
            <div className="lines__make">
              <input
                className="lines__box"
                value={typed}
                autoFocus
                placeholder={LINE_WORDS.newPlaceholder}
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') make();
                }}
              />
              {refused === null ? null : <p className="lines__refused">{refused}</p>}
              <div className="lines__row">
                <button
                  type="button"
                  className="lines__do"
                  disabled={typed.trim() === '' || refused !== null}
                  onClick={make}
                >
                  {LINE_WORDS.create}
                </button>
                <button type="button" className="lines__quietdo" onClick={() => setNaming(false)}>
                  {LINE_WORDS.cancel}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Worth a box only once the list is long enough to scan badly. */}
              {branches.length > 6 ? (
                <input
                  className="lines__box"
                  value={typed}
                  autoFocus
                  placeholder={LINE_WORDS.find}
                  onChange={(event) => setTyped(event.target.value)}
                />
              ) : null}

              {showing.length === 0 ? (
                <p className="lines__quiet">
                  {branches.length === 0 ? LINE_WORDS.none : LINE_WORDS.noneFound}
                </p>
              ) : (
                <ul className="lines__list">
                  {showing.map((one) => {
                    const standing = saysStanding(one);
                    return (
                      <li key={one.name}>
                        <button
                          type="button"
                          className={`lines__one ${one.current ? 'lines__one--here' : ''}`}
                          disabled={one.current || busy}
                          onClick={() => {
                            setOpen(false);
                            onSwitch(one.name);
                          }}
                        >
                          <span className="lines__tick" aria-hidden="true">
                            {one.current ? '✓' : ''}
                          </span>
                          <span className="lines__what">
                            <span className="lines__oneName">{one.name}</span>
                            <span className="lines__said">
                              {one.current
                                ? LINE_WORDS.onThisOne
                                : one.message === ''
                                  ? (one.upstream ?? '')
                                  : one.message}
                            </span>
                          </span>
                          {standing === null ? null : (
                            <span className="lines__standing">{standing}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <button type="button" className="lines__new" onClick={() => { setNaming(true); setTyped(''); }}>
                {LINE_WORDS.newLine}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
