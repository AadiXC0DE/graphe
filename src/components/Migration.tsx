/** What the move of older chats found, on the Storage page beside the folders.
 *
 * Somebody who notices that a chat opens somewhere unexpected, or wonders what
 * happened to the folder it used to be in, has one place to look. The counts,
 * the folder the copies are in and the way back were written down by the move
 * itself and only ever reached the log; this is them, in front of the person
 * they are about.
 *
 * Nothing is drawn when there is nothing to say. A record exists on every
 * computer that has run this build, including a fresh install where it is
 * empty, so the section is quiet unless something was really moved or this
 * build really cannot judge the profile.
 */

import { useState } from 'react';

import type { MigrationNow } from '../lib/ipc';
import { saysMigration } from '../work/migration';

/** How this section says things, in one place so the presses and the sentences
 *  they answer with cannot drift. Every label is the operation, in two words. */
const SAYS = {
  reading: 'Reading what it found…',
  check: 'Check again',
  backups: 'Show copies',
  nothing: 'Nothing has been moved on this computer.',
  hide: 'Hide',
  details: 'Details',
  at: 'Kept in',
} as const;

type Props = {
  /** What the move found, or null before the shell has answered. */
  migration: MigrationNow | null;
  /** Run the check again. It changes nothing the second time. */
  onCheck?: () => void;
  /** Show the copies it kept, where this computer keeps files. */
  onBackups?: () => void;
  /** The clock the moment it finished is read against, so what is drawn is a
   *  function of what it was handed. */
  now?: number;
};

export default function Migration({ migration, onCheck, onBackups, now = Date.now() }: Props) {
  /* Opened by somebody who is looking for the way back, which is exactly when
     the sentences matter and exactly when the screen is otherwise one long
     list of folders. */
  const [open, setOpen] = useState(false);

  if (migration === null) return <p className="settings__machine">{SAYS.reading}</p>;

  const said = saysMigration(migration, now);
  if (said.length === 0) return <p className="settings__machine">{SAYS.nothing}</p>;
  const [first, ...rest] = said;

  return (
    <div className="settings__moved">
      <div className="settings__movedhead">
        {/* The row above already names it; this is the one line it happened in,
            so the row is readable without opening anything. */}
        <span className="settings__text">
          <span className="settings__note">{first}</span>
        </span>
        <button
          type="button"
          className="settings__folderdo settings__folderdo--wide"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? SAYS.hide : SAYS.details}
        </button>
      </div>
      {open ? (
        <>
          <ul className="settings__said">
            {rest.map((one) => (
              <li key={one} className="settings__note">
                {one}
              </li>
            ))}
          </ul>
          <div className="settings__moveddo">
            {/* The press is offered only where the copies are known to be, so
                the row never opens a folder that has nothing in it. */}
            {onBackups === undefined || migration.backups === null || migration.backups === 0 ? null : (
              <button type="button" className="settings__folderdo settings__folderdo--wide" onClick={onBackups}>
                {SAYS.backups}
              </button>
            )}
            {onCheck === undefined ? null : (
              <button type="button" className="settings__folderdo settings__folderdo--wide" onClick={onCheck}>
                {SAYS.check}
              </button>
            )}
          </div>
          {migration.backups === null || migration.backupFolder === '' ? null : (
            <p className="settings__machine">
              {SAYS.at} <code>{migration.backupFolder}</code>
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
