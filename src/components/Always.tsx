import { useEffect, useState } from 'react';

import Switch from './Switch';
import type { AlwaysDoes } from '../lib/ipc';
import { MOST_AT_ONCE, WHEN, whenWords, type AlwaysRow, type When } from '../work/always';
import './Always.css';

type Props = {
  /** The list as the file has it, or null before it has been read. */
  always: AlwaysDoes | null;
  onWrite?: (rows: readonly AlwaysRow[]) => void;
  /** Open the file itself, for whoever would rather have the JSON. */
  onOpenFile?: () => void;
  onBack?: () => void;
};

export const ALWAYS_PAGE = {
  empty: 'Nothing runs on its own yet.',
  add: 'Add one',
  command: 'A command to run',
  when: 'When it runs',
  /** Under the list, so the file is never a secret from the half of the
   *  audience that wants it. */
  kept: 'Kept in',
  open: 'Open the file',
  name: 'Always',
} as const;

/**
 * What this project does without being asked.
 *
 * The row used to drop whoever pressed it into their editor with a JSON file,
 * or, where the file did not exist yet, do nothing at all. The list is the
 * feature, so the list is drawn: a moment, a command, and a switch. The file is
 * still one press away for anybody who wants it.
 */
export default function Always({ always, onWrite, onOpenFile, onBack }: Props) {
  const [rows, setRows] = useState<readonly AlwaysRow[]>(always?.rows ?? []);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [when, setWhen] = useState<When>('afterEachChange');

  /* The file is edited outside this window too, so a fresh reading wins over
     whatever was on screen. */
  useEffect(() => {
    setRows(always?.rows ?? []);
  }, [always]);

  const put = (next: readonly AlwaysRow[]): void => {
    setRows(next);
    onWrite?.(next);
  };

  /** Whether a moment has room for one more, counting everything but the row
   *  being asked about. A fifth would be written and never run. */
  const roomAt = (moment: When, except: number): boolean =>
    rows.filter((one, at) => one.on && one.when === moment && at !== except).length < MOST_AT_ONCE;

  const save = (): void => {
    const run = draft.trim();
    if (run === '') {
      setAdding(false);
      return;
    }
    put([...rows, { when, name: run.split(/\s+/)[0] ?? run, run, on: roomAt(when, -1) }]);
    setDraft('');
    setAdding(false);
  };

  const moments = (
    value: When,
    at: number,
    change: (moment: When) => void,
  ): React.ReactNode => (
    <select
      className="always__when"
      aria-label={ALWAYS_PAGE.when}
      value={value}
      onChange={(event) => change(event.target.value as When)}
    >
      {WHEN.map((one) => (
        <option key={one} value={one} disabled={one !== value && !roomAt(one, at)}>
          {whenWords[one]}
        </option>
      ))}
    </select>
  );

  return (
    <section className="always" aria-label={ALWAYS_PAGE.name}>
      {onBack === undefined ? null : (
        <button type="button" className="always__back" onClick={onBack}>
          Back
        </button>
      )}

      {always?.trouble == null ? null : <p className="always__trouble">{always.trouble}</p>}

      {rows.length === 0 ? (
        <p className="always__empty">{ALWAYS_PAGE.empty}</p>
      ) : (
        <ul className="always__list">
          {rows.map((row, at) => (
            <li className="always__row" key={`${row.when}:${row.run}:${String(at)}`}>
              {moments(row.when, at, (moment) =>
                put(rows.map((one, each) => (each === at ? { ...one, when: moment } : one))),
              )}
              <code className="always__run">{row.run}</code>
              <Switch
                on={row.on}
                label={row.name}
                disabled={!row.on && !roomAt(row.when, at)}
                onChange={(on) =>
                  put(rows.map((one, each) => (each === at ? { ...one, on } : one)))
                }
              />
              <button
                type="button"
                className="always__remove"
                onClick={() => put(rows.filter((_one, each) => each !== at))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="always__row always__row--new">
          {moments(when, -1, setWhen)}
          <input
            className="always__field"
            autoFocus
            placeholder={ALWAYS_PAGE.command}
            aria-label={ALWAYS_PAGE.command}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                save();
                return;
              }
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              event.preventDefault();
              setDraft('');
              setAdding(false);
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className="always__add"
          disabled={onWrite === undefined}
          onClick={() => setAdding(true)}
        >
          <span aria-hidden="true">+</span> {ALWAYS_PAGE.add}
        </button>
      )}

      {always === null || always.file === '' ? null : (
        <p className="always__foot">
          {ALWAYS_PAGE.kept} <code>{always.file}</code>.{' '}
          {onOpenFile === undefined ? null : (
            <button type="button" className="always__link" onClick={onOpenFile}>
              {ALWAYS_PAGE.open}
            </button>
          )}
        </p>
      )}
    </section>
  );
}
