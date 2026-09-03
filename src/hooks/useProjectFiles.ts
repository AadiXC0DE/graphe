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
import type { Desks } from '../lib/projects';
import type { FileEntry } from '../lib/ipc';

/** One file, open. `text` is null while it is on its way; `trouble` is the one
 *  sentence saying why it cannot be shown at all. */
export type Reading = { path: string; text: string | null; trouble: string | null };

/** How often the file tree is walked while a run is going. Short enough that a
 *  new folder appears while somebody is still looking for it, long enough that
 *  a step writing forty files does not walk the project forty times. */
const FILES_APART = 1_200;

export type ProjectFiles = {
  files: Readonly<Record<string, readonly FileEntry[]>>;
  setFiles: Dispatch<SetStateAction<Readonly<Record<string, readonly FileEntry[]>>>>;
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

  const [files, setFiles] = useState<Readonly<Record<string, readonly FileEntry[]>>>({});
  const [reading, setReading] = useState<Reading | null>(null);

  const wantsFiles = useRef(showFiles);
  wantsFiles.current = showFiles;

  /* When the tree was last walked, per project. */
  const readAt = useRef<Record<string, number>>({});

  const refresh = useCallback(
    async (path: string) => {
      if (!wantsFiles.current) return;
      const answer = await bridge.projectFiles();
      if (!answer.ok || desksNow.current.current !== path) return;
      setFiles((current) => ({ ...current, [path]: answer.value }));
    },
    [desksNow],
  );

  const refreshSoon = useCallback(
    (path: string) => {
      if (!wantsFiles.current) return;
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
    /* Nothing on screen changes until the file is here. Emptying the panel
       first and filling it a few milliseconds later is a flicker in the panel
       and, because the panel has a height, one in the conversation beside it;
       pressing the file already open flickered it for no change at all. A read
       slow enough to need saying so still says it, after a beat. */
    const saySo = setTimeout(() => {
      if (openAt.current === token) setReading({ path, text: null, trouble: null });
    }, 150);
    void bridge.fileText(path).then((answer) => {
      clearTimeout(saySo);
      if (openAt.current !== token) return;
      setReading(
        answer.ok
          ? { path, text: answer.value, trouble: null }
          : { path, text: null, trouble: answer.trouble.because },
      );
    });
  }, []);

  const wanted = useCallback((on: boolean) => {
    wantsFiles.current = on;
  }, []);

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
