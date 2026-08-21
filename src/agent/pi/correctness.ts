/**
 * Deterministic selection among N candidates where there is a right answer.
 *
 * `try_ways` stays human-judged because taste has no oracle. Correctness does:
 * completed project checks first, then lint/type errors, then the smaller diff.
 * Unknown is never treated as clean and a candidate with an unfinished check
 * cannot win. Pure: callers can show every reason and test the ordering.
 */

import { checkPassed, type CheckVerdict } from './checks';

export type CandidateSignals = {
  id: string;
  checks: readonly CheckVerdict[];
  lintErrors?: number | null;
  typeErrors?: number | null;
  diffLines?: number | null;
  ready?: boolean;
};

export type RankedCandidate = {
  id: string;
  disqualified: boolean;
  passRate: number | null;
  lintTypeErrors: number | null;
  /** How many of lint and typecheck actually ran, 0..2. */
  staticSignals: number;
  diffLines: number | null;
  reasons: readonly string[];
};

export type CorrectSelection = {
  winner: string | null;
  ranking: readonly RankedCandidate[];
  tie: boolean;
  reason: string;
};

function count(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function rank(candidate: CandidateSignals): RankedCandidate {
  const finished = candidate.ready !== false && candidate.checks.every((one) => one.ok);
  const passed = candidate.checks.filter(checkPassed).length;
  const passRate = candidate.checks.length === 0 ? null : passed / candidate.checks.length;
  const lint = count(candidate.lintErrors);
  const types = count(candidate.typeErrors);
  const staticSignals = Number(lint !== null) + Number(types !== null);
  const lintTypeErrors = staticSignals === 0 ? null : (lint ?? 0) + (types ?? 0);
  const diffLines = count(candidate.diffLines);
  const hasOracle = passRate !== null || lintTypeErrors !== null;
  const disqualified = !finished || !hasOracle;
  const reasons = [
    !finished
      ? 'a check did not finish'
      : passRate === null
        ? 'no project check result'
        : `${String(passed)}/${String(candidate.checks.length)} checks passed`,
    staticSignals === 0
      ? 'lint/type not run'
      : `${String(staticSignals)}/2 lint/type signals ran; ${String(lintTypeErrors ?? 0)} errors`,
    diffLines === null ? 'diff size unknown' : `${String(diffLines)} changed lines`,
    ...(hasOracle ? [] : ['no objective correctness signal']),
  ];
  return { id: candidate.id, disqualified, passRate, lintTypeErrors, staticSignals, diffLines, reasons };
}

function unknownLast(a: number | null, b: number | null, lowerWins: boolean): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return lowerWins ? a - b : b - a;
}

function compare(a: RankedCandidate, b: RankedCandidate): number {
  if (a.disqualified !== b.disqualified) return a.disqualified ? 1 : -1;
  return (
    unknownLast(a.passRate, b.passRate, false) ||
    b.staticSignals - a.staticSignals ||
    unknownLast(a.lintTypeErrors, b.lintTypeErrors, true) ||
    unknownLast(a.diffLines, b.diffLines, true) ||
    a.id.localeCompare(b.id)
  );
}

function sameSignals(a: RankedCandidate, b: RankedCandidate): boolean {
  return (
    a.disqualified === b.disqualified &&
    a.passRate === b.passRate &&
    a.staticSignals === b.staticSignals &&
    a.lintTypeErrors === b.lintTypeErrors &&
    a.diffLines === b.diffLines
  );
}

export function selectCorrect(candidates: readonly CandidateSignals[]): CorrectSelection {
  const ranking = candidates.map(rank).sort(compare);
  const first = ranking[0];
  if (first === undefined) return { winner: null, ranking, tie: false, reason: 'No candidates were given.' };
  if (first.disqualified) {
    return { winner: null, ranking, tie: false, reason: 'No candidate has a completed objective correctness signal.' };
  }
  const second = ranking[1];
  if (second !== undefined && sameSignals(first, second)) {
    return { winner: null, ranking, tie: true, reason: 'The leading candidates tie on every objective signal.' };
  }
  const cleanChecks = first.passRate === null || first.passRate === 1;
  const cleanStatic = first.lintTypeErrors === null || first.lintTypeErrors === 0;
  if (!cleanChecks || !cleanStatic) {
    return { winner: null, ranking, tie: false, reason: 'The best candidate still has a failing correctness signal.' };
  }
  return {
    winner: first.id,
    ranking,
    tie: false,
    reason: `${first.id} wins on completed checks, then lint/type, then the smaller diff.`,
  };
}
