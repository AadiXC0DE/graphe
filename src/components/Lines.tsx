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
 * Opens downward in the band rather than as a card floating over it. The panel
 * is a narrow column of stacked bands: anything absolutely positioned in here
 * is either wider than the column or covering the band underneath, and it was
 * both. In flow it cannot do either, and the panel keeps working the way the
 * rest of it does — a heading, then what is under it.
 */
export default function Lines({ branches, fallback, busy = false, onSwitch, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [naming, setNaming] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const here = branches.find((one) => one.current) ?? null;
  const name = here?.name ?? fallback ?? 'main';
  const showing = useMemo(
    () => linesMatching(branches, naming ? '' : typed),
    [branches, typed, naming],
  );
  const refused = naming ? refuseName(typed, branches) : null;

  useEffect(() => {
    if (open) return;
    setTyped('');
    setNaming(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const shut = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('keydown', shut);
    return () => document.removeEventListener('keydown', shut);
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
        aria-label={LINE_WORDS.open}
        disabled={busy}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="lines__dot" aria-hidden="true" />
        <span className="lines__name">{name}</span>
        <span className={`lines__caret ${open ? 'lines__caret--open' : ''}`} aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {!open ? null : (
        <div className="lines__open">
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
              {/* A box only once the list is long enough to scan badly. */}
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
                <ul className="lines__list scroll--auto">
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
                          title={one.message === '' ? undefined : one.message}
                        >
                          <span className="lines__oneName">{one.name}</span>
                          {standing === null ? null : (
                            <span className="lines__standing">{standing}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <button
                type="button"
                className="lines__new"
                onClick={() => {
                  setNaming(true);
                  setTyped('');
                }}
              >
                {LINE_WORDS.newLine}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
