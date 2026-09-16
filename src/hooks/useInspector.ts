/**
 * What the panels beside the conversation read, asked for about a named
 * conversation and answered only if it is still that one.
 *
 * Four reads live here: the project's git state, its timeline (and each child
 * project's timeline when one folder holds several), what servers the
 * conversation has kept up, and how full it is. Each is asked for with
 * `{project, conversation}` and each answer is dropped once the owner has moved
 * on.
 *
 * Two chats in one project share the folder and the panel, so "the same
 * project" is not enough to write an answer under: a slow answer for the chat
 * that was on screen a moment ago would otherwise draw its branch, its files or
 * its processes under this chat's name. That is the bug these guards exist for,
 * and it is why the ask counter is per owner rather than one number for the
 * window.
 */

import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react';

import { bridge } from '../lib/bridge';
import type { BuildPlan, Room, RunningPiece, SavedVersion, Where } from '../lib/ipc';
import { changeDesk, currentDesk, type Desks } from '../lib/projects';
import { keyOf } from '../work/owner';

/** A build plan, kept with the folder it came from so a plan is never drawn
 *  under another project's conversation. */
export type HeldPlan = { path: string; plan: BuildPlan };

export type Inspector = {
  /** The git state, the branch and the processes of the named project. */
  refreshOverview(path: string, conversation?: string | null): Promise<void>;
  /** The timeline, and each child project's own timeline. */
  refreshVersions(path: string, conversation?: string | null): Promise<void>;
  /** What the named conversation has kept up. */
  refreshRunning(where?: Where): void;
  /** How full the named conversation is. */
  refreshRoom(where?: Where): void;
  /** The build plan for the tracker above the box. */
  refreshBuildPlan(path: string): Promise<void>;
};

export function useInspector(options: {
  /** The desks as they stand, read inside callbacks subscribed once. */
  desksNow: { current: Desks };
  setDesks(change: (current: Desks) => Desks): void;
  /** Where each answer is put. The state itself belongs to the window, which
   *  also takes the shell's own unsolicited reports of the same two things. */
  setRunning: Dispatch<SetStateAction<readonly RunningPiece[]>>;
  setRoom: Dispatch<SetStateAction<Room | null>>;
  setPlan: Dispatch<SetStateAction<HeldPlan | null>>;
}): Inspector {
  const { desksNow, setDesks, setRunning, setRoom, setPlan } = options;

  /** How many asks each owner has made, so a slow answer for one conversation
   *  cannot land under another. Keyed by project and conversation together. */
  const asksMade = useRef(new Map<string, number>());

  const refreshVersions = useCallback(
    async (path: string, conversation?: string | null) => {
      const deskNow = desksNow.current.byPath[path];
      const address = conversation === undefined ? (deskNow?.address ?? null) : conversation;
      const key = `versions:${keyOf(path, address ?? '')}`;
      const mine = (asksMade.current.get(key) ?? 0) + 1;
      asksMade.current.set(key, mine);
      const answer = await bridge.versions({ project: path, ...(address === null ? {} : { conversation: address }) });
      // A folder holding several projects has no timeline of its own. Each
      // project answers where it lives, and the panel shows whichever is chosen.
      // Read late: which projects a folder holds is only known once its
      // overview has answered.
      const several = desksNow.current.byPath[path]?.overview?.repos ?? [];
      const each = await Promise.all(
        several.map(
          async (one) =>
            [one.name, await bridge.versions({ project: path, repo: one.name, ...(address === null ? {} : { conversation: address }) })] as const,
        ),
      );
      if (asksMade.current.get(key) !== mine) return;
      const perRepo: Record<string, readonly SavedVersion[]> = {};
      for (const [name, got] of each) if (got.ok) perRepo[name] = got.value;
      if (!answer.ok && several.length === 0) return;
      // Against the freshest desks, not the render this ask started in. An
      // answer that arrives before the desk it was asked for has been committed
      // — the project just opened — still lands, because updaters run in call
      // order against the latest state. One for a project or conversation since
      // moved on is dropped where the state is read.
      setDesks((current) => {
        if (current.current !== path) return current;
        if ((current.byPath[path]?.address ?? null) !== address) return current;
        return changeDesk(current, path, (one) => ({
          ...one,
          versions: answer.ok ? answer.value : one.versions,
          ...(several.length === 0 ? {} : { repoVersions: perRepo }),
        }));
      });
    },
    [desksNow, setDesks],
  );

  const refreshOverview = useCallback(
    async (path: string, conversation?: string | null) => {
      const here = desksNow.current.byPath[path];
      const address = conversation === undefined ? here?.address : conversation;
      const where: Where = {
        project: path,
        ...(address == null ? {} : { conversation: address }),
      };
      /* What this answer will be about, and which ask it is. Two conversations
         in one project share the folder and the panel, so "the same project" is
         not enough to write an answer under: an older ask arriving late would
         put one chat's files, branch or processes on screen under another
         chat's name. */
      const key = `overview:${keyOf(path, address ?? '')}`;
      const mine = (asksMade.current.get(key) ?? 0) + 1;
      asksMade.current.set(key, mine);
      const answer = await bridge.overview(where);
      if (!answer.ok) return;
      if (asksMade.current.get(key) !== mine) return;
      // Against the freshest desks, for the same reason the timeline is: an
      // answer for a project just opened lands rather than losing a race with
      // its own commit, and one for a conversation since moved on is dropped.
      setDesks((current) => {
        if (current.current !== path) return current;
        if ((current.byPath[path]?.address ?? '') !== (address ?? '')) return current;
        return changeDesk(current, path, (one) => ({ ...one, overview: answer.value }));
      });
      // Which projects a folder holds is only known once this has answered, so
      // the first ask for their timelines has to be here rather than earlier —
      // otherwise the panel says "nothing saved yet" about a project that has.
      const held = answer.value.repos ?? [];
      const already = desksNow.current.byPath[path]?.repoVersions ?? {};
      if (held.some((one) => already[one.name] === undefined)) void refreshVersions(path, address);
    },
    [desksNow, refreshVersions, setDesks],
  );

  /** What is already up. The band is kept in step by events afterwards, but a
   *  window that has just opened has heard none of them yet. The destination is
   *  required: an old conversation settling must never clear the project that is
   *  on screen now. */
  const refreshRunning = useCallback(
    (where?: Where) => {
      const desk = currentDesk(desksNow.current);
      const asked: Where = where ?? {
        ...(desk === null ? {} : { project: desk.path }),
        ...(desk?.address == null ? {} : { conversation: desk.address }),
      };
      const key = `running:${keyOf(asked.project ?? '', asked.conversation ?? '')}`;
      const sequence = (asksMade.current.get(key) ?? 0) + 1;
      asksMade.current.set(key, sequence);
      void bridge.running(asked).then((answer) => {
        if (!answer.ok) return;
        const current = currentDesk(desksNow.current);
        if (asked.project !== undefined && current?.path !== asked.project) return;
        if (asked.conversation !== undefined && current?.address !== asked.conversation) return;
        if (asksMade.current.get(key) !== sequence) return;
        setRunning(answer.value);
      });
    },
    [desksNow, setRunning],
  );

  const refreshRoom = useCallback(
    (where?: Where) => {
      const desk = currentDesk(desksNow.current);
      const asked: Where = where ?? {
        ...(desk === null ? {} : { project: desk.path }),
        ...(desk?.address == null ? {} : { conversation: desk.address }),
      };
      const key = `room:${keyOf(asked.project ?? '', asked.conversation ?? '')}`;
      const sequence = (asksMade.current.get(key) ?? 0) + 1;
      asksMade.current.set(key, sequence);
      void bridge.room(asked).then((answer) => {
        if (!answer.ok) return;
        const current = currentDesk(desksNow.current);
        if (asked.project !== undefined && current?.path !== asked.project) return;
        if (asked.conversation !== undefined && current?.address !== asked.conversation) return;
        if (asksMade.current.get(key) !== sequence) return;
        setRoom(answer.value);
      });
    },
    [desksNow, setRoom],
  );

  /** Read the build plan for the project in front, for the tracker above the
   *  box. Same in-front guard as everything else that answers about a folder. */
  const refreshBuildPlan = useCallback(
    async (path: string) => {
      const key = `plan:${path}`;
      const sequence = (asksMade.current.get(key) ?? 0) + 1;
      asksMade.current.set(key, sequence);
      const answer = await bridge.buildPlan({ project: path });
      if (!answer.ok) return;
      if (asksMade.current.get(key) !== sequence) return;
      setPlan((current) => {
        if (desksNow.current.current !== path) return current;
        return answer.value === null ? null : { path, plan: answer.value };
      });
    },
    [desksNow, setPlan],
  );

  return { refreshOverview, refreshVersions, refreshRunning, refreshRoom, refreshBuildPlan };
}
