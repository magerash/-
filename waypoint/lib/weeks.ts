// Single source of truth for time ⇄ week-index math. Pure, DOM-free, unit-testable.
import { WEEKS_PER_YEAR } from "./types";

export const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Total cells in a life grid for a given target age. */
export function totalWeeks(targetAgeYears: number): number {
  return Math.max(1, Math.round(targetAgeYears)) * WEEKS_PER_YEAR;
}

/** Parse an ISO yyyy-mm-dd as a local date at midnight. */
export function parseBirth(birthDate: string): Date {
  const [y, m, d] = birthDate.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * 0-based index of the week the person is currently living, counted from birth.
 * Clamped to >= 0. May exceed totalWeeks if the person has outlived their target.
 */
export function currentWeekIndex(birthDate: string, now: number = Date.now()): number {
  const birth = parseBirth(birthDate).getTime();
  return Math.max(0, Math.floor((now - birth) / MS_PER_WEEK));
}

/** Age in whole years at the start of a given week index. */
export function ageAtWeek(weekIndex: number): number {
  return Math.floor(weekIndex / WEEKS_PER_YEAR);
}

/** Grid position: row = year (0-based), col = week-of-year (0..51). */
export function weekToRowCol(weekIndex: number): { row: number; col: number } {
  return {
    row: Math.floor(weekIndex / WEEKS_PER_YEAR),
    col: weekIndex % WEEKS_PER_YEAR,
  };
}

/** Date on which a given week index begins. */
export function dateOfWeekStart(birthDate: string, weekIndex: number): Date {
  return new Date(parseBirth(birthDate).getTime() + weekIndex * MS_PER_WEEK);
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function formatDate(d: Date): string {
  return DATE_FMT.format(d);
}

/** Human label for a cell, e.g. "Week 23 · Age 35 · Jun 2061". */
export function weekLabel(birthDate: string, weekIndex: number): string {
  const { col } = weekToRowCol(weekIndex);
  const age = ageAtWeek(weekIndex);
  const d = dateOfWeekStart(birthDate, weekIndex);
  return `Week ${col + 1} · Age ${age} · ${formatDate(d)}`;
}

export interface LifeStats {
  total: number;
  lived: number;
  ahead: number;
  percentLived: number;
}

export function lifeStats(birthDate: string, targetAgeYears: number, now?: number): LifeStats {
  const total = totalWeeks(targetAgeYears);
  const lived = Math.min(total, currentWeekIndex(birthDate, now));
  const ahead = Math.max(0, total - lived);
  return { total, lived, ahead, percentLived: total ? lived / total : 0 };
}
