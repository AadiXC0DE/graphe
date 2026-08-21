/**
 * Host-owned bounds for after-call verification and repair.
 *
 * Prompt guidance is not a bound. This counter lives outside the model, keyed
 * by the check and normalized touched file, and refuses a third attempt even if
 * the model asks. Two attempts matches Codex's proposed native recovery loop:
 * enough to check a repair once, small enough that an impossible check stops.
 */

import { toPosix } from '../guard/paths';

export const REPAIR_LIMITS = {
  perIncident: 2,
  perTurn: 2,
  perSession: 6,
} as const;

export type RepairIncident = { check: string; file?: string };
export type RepairDecision =
  | { allow: true; key: string; attempt: number }
  | { allow: false; key: string; reason: 'incident' | 'turn' | 'session' | 'empty' };

function normalized(value: string): string {
  return toPosix(value.trim()).replace(/^\.\//, '').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase();
}

export function repairIncidentKey(incident: RepairIncident): string {
  const check = incident.check.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const file = normalized(incident.file ?? '');
  return file === '' ? check : `${check}:${file}`;
}

export class RepairCoordinator {
  private readonly incidents = new Map<string, number>();
  private turn = 0;
  private session = 0;

  beginTurn(): void {
    this.turn = 0;
  }

  count(incident: RepairIncident): number {
    return this.incidents.get(repairIncidentKey(incident)) ?? 0;
  }

  try(incident: RepairIncident): RepairDecision {
    const key = repairIncidentKey(incident);
    if (incident.check.trim() === '' || key === '') return { allow: false, key, reason: 'empty' };
    const already = this.incidents.get(key) ?? 0;
    if (already >= REPAIR_LIMITS.perIncident) return { allow: false, key, reason: 'incident' };
    if (this.turn >= REPAIR_LIMITS.perTurn) return { allow: false, key, reason: 'turn' };
    if (this.session >= REPAIR_LIMITS.perSession) return { allow: false, key, reason: 'session' };
    const attempt = already + 1;
    this.incidents.set(key, attempt);
    this.turn += 1;
    this.session += 1;
    return { allow: true, key, attempt };
  }
}

export function repairPrompt(check: string, file: string | undefined, attempt: number): string {
  const where = file === undefined || file.trim() === '' ? '' : ` for ${normalized(file)}`;
  return [
    `After-call verification ${String(attempt)}/${String(REPAIR_LIMITS.perIncident)}: run the project check "${check}"${where}.`,
    'If it fails, repair only the touched file and run that same check once more.',
    'Do not broaden the change. If it still cannot pass at the cap, stop and say exactly what remains failing.',
  ].join(' ');
}
