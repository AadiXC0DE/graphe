import { readFlow, type Flow } from '../work/canvas';

const prefix = 'graphe:canvas-edit:';
const key = (project: string, id: string) => `${prefix}${JSON.stringify([project, id])}`;

/** A synchronous recovery copy bridges renderer shutdown and the shell's save
 * acknowledgement. Only the exact acknowledged revision may remove it. */
export function keepCanvasDraft(storage: Storage, project: string, flow: Flow): void {
  storage.setItem(key(project, flow.id), JSON.stringify(flow));
}

export function clearCanvasDraft(storage: Storage, project: string, id: string, saved?: Flow): void {
  const at = key(project, id);
  if (saved === undefined || storage.getItem(at) === JSON.stringify(saved)) storage.removeItem(at);
}

export function canvasDrafts(storage: Storage, project: string): readonly Flow[] {
  const found: Flow[] = [];
  for (let at = 0; at < storage.length; at++) {
    const name = storage.key(at);
    if (name === null || !name.startsWith(prefix)) continue;
    try {
      const owner: unknown = JSON.parse(name.slice(prefix.length));
      if (!Array.isArray(owner) || owner[0] !== project) continue;
      const flow = readFlow(JSON.parse(storage.getItem(name) ?? 'null'));
      if (flow !== null && flow.id === owner[1]) found.push(flow);
    } catch { /* Preserve unreadable recovery evidence, never replace it with an empty drawing. */ }
  }
  return found;
}
