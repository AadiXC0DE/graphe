// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInspector, type Inspector } from '../src/hooks/useInspector';
import { noDesks, openDesk, showThread, type Desks } from '../src/lib/projects';

const api = vi.hoisted(() => ({ versions: vi.fn(), overview: vi.fn(), running: vi.fn(), room: vi.fn(), buildPlan: vi.fn() }));
vi.mock('../src/lib/bridge', () => ({ bridge: api }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const clean: (() => void)[] = [];
afterEach(() => { for (const close of clean.splice(0)) close(); vi.resetAllMocks(); });

function mounted() {
  const desksNow = { current: showThread(openDesk(noDesks, { path: '/one', name: 'One' }), '/one', 'chat-a', { turns: [] }) };
  const setDesks = (change: (current: Desks) => Desks) => { desksNow.current = change(desksNow.current); };
  const setRunning = vi.fn();
  const setRoom = vi.fn();
  const setPlan = vi.fn();
  let inspector!: Inspector;
  function Probe() { inspector = useInspector({ desksNow, setDesks, setRunning, setRoom, setPlan }); return null; }
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(createElement(Probe)));
  clean.push(() => act(() => root.unmount()));
  return { desksNow, inspector, setRunning, setRoom, setPlan };
}

describe('inspector query ownership', () => {
  it('qualifies timeline reads and refuses late answers after a chat switch', async () => {
    const held = Promise.withResolvers<unknown>();
    api.versions.mockReturnValue(held.promise);
    const { desksNow, inspector } = mounted();
    const request = inspector.refreshVersions('/one');
    expect(api.versions).toHaveBeenCalledWith({ project: '/one', conversation: 'chat-a' });
    desksNow.current = showThread(desksNow.current, '/one', 'chat-b', { turns: [] });
    held.resolve({ ok: true, value: [{ id: 'from-a' }] });
    await request;
    expect(desksNow.current.byPath['/one']?.versions).toEqual([]);
  });

  it('keeps independent timeline and overview generations', async () => {
    const held = Promise.withResolvers<unknown>();
    api.versions.mockReturnValue(held.promise);
    api.overview.mockResolvedValue({ ok: true, value: { repos: [] } });
    const { desksNow, inspector } = mounted();
    const request = inspector.refreshVersions('/one');
    await inspector.refreshOverview('/one', 'chat-a');
    held.resolve({ ok: true, value: [{ id: 'saved' }] });
    await request;
    expect(desksNow.current.byPath['/one']?.versions).toEqual([{ id: 'saved' }]);
  });

  it('rejects an older running query and qualifies build-plan reads', async () => {
    const old = Promise.withResolvers<unknown>();
    api.running.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ok: true, value: ['new'] });
    api.buildPlan.mockResolvedValue({ ok: true, value: null });
    const { inspector, setRunning } = mounted();
    inspector.refreshRunning();
    inspector.refreshRunning();
    await Promise.resolve();
    old.resolve({ ok: true, value: ['old'] });
    await Promise.resolve();
    expect(setRunning.mock.calls).toEqual([[['new']]]);
    await inspector.refreshBuildPlan('/one');
    expect(api.buildPlan).toHaveBeenCalledWith({ project: '/one' });
  });
});
