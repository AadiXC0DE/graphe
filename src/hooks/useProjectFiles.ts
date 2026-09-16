/**
 * Everything each project holds, and the one file somebody has opened.
 *
 * Kept per folder for the same reason the pictures are: one project's files
 * must never be drawn under another's name, and the shell answers about
 * whatever is in front of it, so a switch mid-flight has to be caught here.
 *
 * Nothing is read while the panel is off, so somebody who never opens it never
 * pays for a folder being walked — and while a run is going the walk is
 * throttled, because a step that writes is a step that often writes again
 * straight away.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { bridge } from '../lib/bridge';
import { whenHidden } from '../lib/onscreen';
import type { Desks } from '../lib/projects';
import type { FileEntry, Where } from '../lib/ipc';

/** One file, open. `text` is null while it is on its way; `trouble` is the one
 *  sentence saying why it cannot be shown at all. */
export type Reading = { path: string; text: string | null; trouble: string | null };

/** A listing, and what the folder looked like when it was read.
 *
 * The revision is the point of keeping them together: a panel drawn from memory
 * cannot tell on its own whether the folder has moved since, and the open file
 * is the one thing on screen that would then be showing bytes nobody can still
 * find on disk. */
export type Listing = { files: readonly FileEntry[]; revision: string };

/** How often the file tree is walked while a run is going. Short enough that a
 *  new folder appears while somebody is still looking for it, long enough that
 *  a step writing forty files does not walk the project forty times. */
const FILES_APART = 1_200;

export type ProjectFiles = {
  files: Readonly<Record<string, Listing>>;
  setFiles: Dispatch<SetStateAction<Readonly<Record<string, Listing>>>>;
  reading: Reading | null;
  setReading: Dispatch<SetStateAction<Reading | null>>;
  refresh(path: string): Promise<void>;
  /** The tree while the work is still going, throttled. */
  refreshSoon(path: string): void;
  readFile(path: string): void;
  /** Whether the panel is on. Mirrored so the callbacks above are not rebuilt
   *  every time a preference changes. */
  wanted(on: boolean): void;
};

export function useProjectFiles(options: {
  desksNow: { current: Desks };
  /** The folder in front. */
  project: string | null;
  /** Whether somebody has asked to see the files at all. */
  showFiles: boolean;
}): ProjectFiles {
  const { desksNow, project, showFiles } = options;

  const [files, setFiles] = useState<Readonly<Record<string, Listing>>>({});
  const [reading, setReading] = useState<Reading | null>(null);

  const wantsFiles = useRef(showFiles);
  wantsFiles.current = showFiles;

  /* When the tree was last walked, per project. */
  const readAt = useRef<Record<string, number>>({});

  /** Whether the window is somewhere it can be seen. A tree nobody can look at
   *  is a walk nobody is owed; it is taken again on the way back. */
  const shows = useRef(true);

  /** The revision each project's listing was read at, and the file open out of
   *  it with the revision that file was read at. Held apart from the state
   *  above so a re-read can be decided without rendering, and so a listing is
   *  never compared against a file from another project. */
  const readRevision = useRef<Record<string, string>>({});
  const openFile = useRef<{ project: string; path: string; revision: string } | null>(null);

  /** Reading a file again from a callback defined before it. The ref is what
   *  keeps the two out of each other's dependency lists. */
  const readFileNow = useRef<(path: string) => void>(() => undefined);

  const refresh = useCallback(
    async (path: string) => {
      if (!wantsFiles.current) return;
      const desk = desksNow.current.byPath[path];
      const address = desk?.address ?? null;
      const where: Where = {
        project: path,
        ...(address === null ? {} : { conversation: address }),
      };
      const answer = await bridge.projectFiles(where);
      // The folder this answer is about, and the conversation it was asked
      // for. Two chats in one project share the folder, so "the same project"
      // is not enough: a late answer for the chat that was on screen a moment
      // ago would draw its files under this chat's name.
      if (!answer.ok || desksNow.current.current !== path) return;
      if ((desksNow.current.byPath[path]?.address ?? null) !== address) return;
      const before = readRevision.current[path];
      readRevision.current = { ...readRevision.current, [path]: answer.value.revision };
      setFiles((current) => ({ ...current, [path]: answer.value }));
      /* The folder moved since this panel last looked, so a file on screen was
         read out of a tree that is not there any more. It is read again rather
         than left showing bytes nobody can still find on disk — which is the
         whole reason the listing carries a revision. */
      const open = openFile.current;
      if (open !== null && open.project === path && before !== answer.value.revision) {
        readFileNow.current(open.path);
      }
    },
    [desksNow],
  );

  const refreshSoon = useCallback(
    (path: string) => {
      if (!wantsFiles.current || !shows.current) return;
      const last = readAt.current[path] ?? 0;
      const now = Date.now();
      if (now - last < FILES_APART) return;
      readAt.current = { ...readAt.current, [path]: now };
      void refresh(path);
    },
    [refresh],
  );

  /** Which read is the current one. A second press while the first is in
   *  flight makes the first nobody's. */
  const openAt = useRef(0);

  const readFile = useCallback((path: string) => {
    const token = (openAt.current += 1);
    const inFront = desksNow.current.current;
    const desk = desksNow.current.byPath[inFront ?? ''];
    const where: Where = {
      ...(inFront === null ? {} : { project: inFront }),
      ...(desk?.address == null ? {} : { conversation: desk.address }),
    };
    /* What this file was last read at, so the answer can say whether it is
       still the file that was on screen. The shell reads the bytes either way —
       what the revision buys is knowing that they are not the ones somebody was
       already looking at. */
    const project = inFront ?? '';
    const open = openFile.current;
    const expect =
      open !== null && open.project === project && open.path === path ? open.revision : undefined;
    /* Nothing on screen changes until the file is here. Emptying the panel
       first and filling it a few milliseconds later is a flicker in the panel
       and, because the panel has a height, one in the conversation beside it;
       pressing the file already open flickered it for no change at all. A read
       slow enough to need saying so still says it, after a beat. */
    const saySo = setTimeout(() => {
      if (openAt.current === token) setReading({ path, text: null, trouble: null });
    }, 150);
    void bridge.fileText(path, where, expect).then((answer) => {
      clearTimeout(saySo);
      if (openAt.current !== token) return;
      if (!answer.ok) {
        setReading({ path, text: null, trouble: answer.trouble.because });
        return;
      }
      openFile.current = { project, path, revision: answer.value.revision };
      setReading({ path, text: answer.value.text, trouble: null });
    });
  }, [desksNow]);
  readFileNow.current = readFile;

  const wanted = useCallback((on: boolean) => {
    wantsFiles.current = on;
  }, []);

  /* Nothing is walked while the window is out of sight — during a long run that
     is one write after another — and the tree in front is read again the moment
     somebody can see it. */
  useEffect(
    () =>
      whenHidden((hidden) => {
        const was = shows.current;
        shows.current = !hidden;
        if (hidden || was) return;
        const inFront = desksNow.current.current;
        if (inFront !== null && wantsFiles.current) void refresh(inFront);
      }),
    [desksNow, refresh],
  );

  /* Asked for once per project, the first time there is something to draw it
     in. */
  useEffect(() => {
    if (!showFiles || project === null || files[project] !== undefined) return;
    void refresh(project);
  }, [showFiles, project, files, refresh]);

  return useMemo(
    () => ({ files, setFiles, reading, setReading, refresh, refreshSoon, readFile, wanted }),
    [files, reading, refresh, refreshSoon, readFile, wanted],
  );
}
