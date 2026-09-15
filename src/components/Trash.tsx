/** Deleted conversations, on the Storage page beside the folders.
 *
 * The one folder there that holds somebody's own words, so it is listed rather
 * than counted: each conversation with the moment it went and what it is
 * taking, a Restore on its own row, and one press that throws away only the
 * ones that were picked. The rule it is kept under is drawn from the shell's
 * own sentence rather than written again here — one place says it, and this is
 * not that place.
 */

import { useState } from 'react';

import type { TrashView } from '../lib/ipc';
import { agoInSentence } from '../lib/when';
import { saysBytes } from '../work/bytes';

/** How this section says things, in one place so the presses and the sentence
 *  they answer with cannot drift. */
const SAYS = {
  reading: 'Reading what is here…',
  none: 'Nothing has been deleted.',
  went: (at: number, now: number): string => `Deleted ${agoInSentence(at, now)}`,
  restore: 'Restore',
  empty: 'Empty selected',
  pick: 'Pick the ones to throw away.',
  picked: (count: number): string => (count === 1 ? '1 picked' : `${String(count)} picked`),
} as const;

type Props = {
  /** The trash as the shell listed it, and the rule it is kept under. Nothing
   *  is drawn until the shell has answered. */
  trash: TrashView | null;
  /** Put one back where it came from, named as the list names it. */
  onRestore?: (name: string) => void;
  /** Throw away exactly these, and never the rest of the trash. */
  onEmpty?: (names: readonly string[]) => void;
  /** The clock the moment each one went is read against, so what is drawn is a
   *  function of what it was handed. */
  now?: number;
};

export default function Trash({ trash, onRestore, onEmpty, now = Date.now() }: Props) {
  const [picked, setPicked] = useState<readonly string[]>([]);

  if (trash === null) return <p className="settings__machine">{SAYS.reading}</p>;

  const { items, rule } = trash;
  const here = new Set(items.map((one) => one.name));
  /* A name that is no longer in the list is not one to send: the list is what
     the shell answered with after the last press. */
  const chosen = picked.filter((one) => here.has(one));

  const pick = (name: string, on: boolean): void => {
    setPicked((was) => (on ? [...was, name] : was.filter((one) => one !== name)));
  };

  return (
    <div className="settings__trash">
      {/* The shell's sentence, not a copy of it. */}
      <p className="settings__machine">{rule}</p>
      {items.length === 0 ? (
        <p className="settings__machine">{SAYS.none}</p>
      ) : (
        <>
          <ul className="settings__folders">
            {items.map((one) => (
              <li key={one.name} className="settings__folder">
                <label className="settings__trashpick">
                  <input
                    type="checkbox"
                    checked={picked.includes(one.name)}
                    onChange={(event) => pick(one.name, event.target.checked)}
                  />
                  <span className="settings__text">
                    <span className="settings__name">{one.name}</span>
                    <span className="settings__note">
                      {SAYS.went(Date.parse(one.wentAt), now)} · {saysBytes(one.size)}
                    </span>
                  </span>
                </label>
                <button
                  type="button"
                  className="settings__folderdo"
                  disabled={onRestore === undefined}
                  onClick={() => onRestore?.(one.name)}
                >
                  {SAYS.restore}
                </button>
              </li>
            ))}
          </ul>
          <div className="settings__trashdo">
            <button
              type="button"
              className="settings__folderdo"
              /* Nothing picked, nothing to throw away: the press is there to be
                 read rather than pressed over the whole trash. */
              disabled={onEmpty === undefined || chosen.length === 0}
              onClick={() => onEmpty?.(chosen)}
            >
              {SAYS.empty}
            </button>
            <span className="settings__trashpicked">
              {chosen.length === 0 ? SAYS.pick : SAYS.picked(chosen.length)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
