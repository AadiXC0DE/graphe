/** What the one-time move found, read off the record it left behind.
 *
 * The move writes a marker whose counts only ever reached the log and the file
 * itself, so nothing on screen said what had been brought across, where the
 * copies of the files it replaced were, or how to get back. This turns that
 * record into the handful of numbers a person can read, and decides the one
 * case where there is nothing to say: no record means no move was needed, and a
 * screen that announces a migration nobody had is worse than a quiet one.
 *
 * Nothing here touches a disk. The caller says how many of the named copies are
 * still there, so this is a function of its arguments and a test can hand it a
 * real marker file without an app around it.
 */

import type { MigrationNow } from '../../src/lib/ipc';
import { readMarker } from './migration-service';

/** The marker file's text as it was read, plus the two things the marker cannot
 *  know about itself: whether the saved work came from a newer version of the
 *  app, and how many of the copies it names are still on the disk. */
export type ReadoutInputs = {
  /** The whole file, or null when there is not one on this computer. */
  marker: string | null;
  /** The saved work was written by a newer version of Graphe. */
  newer: boolean;
  /** Every `.bak` for a named file that is still there. */
  keptBackups: (paths: readonly string[]) => number;
  /** Where the copies are kept, which is the profile folder itself. */
  backupFolder: string;
};

const NOTHING: MigrationNow = {
  completedAt: null,
  sources: 0,
  verdicts: { verified: 0, missing: 0, gone: 0, foreign: 0 },
  connected: 0,
  unlinked: 0,
  unreadable: 0,
  backups: null,
  backupFolder: '',
  newer: false,
};

/**
 * What the screen says, or nothing to say.
 *
 * A profile from a newer app is the one thing worth saying with no record at
 * hand: the move was deliberately not run, and the reason for that is not
 * silence. Everything else with no record is a computer that never needed the
 * move.
 */
export function readoutOf(inputs: ReadoutInputs): MigrationNow {
  const marker = inputs.marker === null ? null : readMarker(inputs.marker);
  if (marker === null) {
    return { ...NOTHING, newer: inputs.newer, backupFolder: inputs.backupFolder };
  }
  return {
    completedAt: marker.completedAt,
    sources: marker.sources,
    verdicts: { ...marker.verdicts },
    connected: marker.conversations.length,
    unlinked: marker.unlinked.length,
    unreadable: marker.quarantined.length,
    /* A build that wrote no list of what it copied aside leaves this null.
       Zero would be a claim that it kept none, which is not what happened. */
    backups: marker.backups === null
      ? null
      : inputs.keptBackups(marker.backups.map((one) => `${one}.bak`)),
    backupFolder: inputs.backupFolder,
    newer: inputs.newer,
  };
}
