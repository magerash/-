"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { WEEKS_PER_YEAR, type LifeBlock } from "@/lib/types";
import { weekLabel } from "@/lib/weeks";

export interface OverlayRange {
  startWeekIndex: number;
  endWeekIndex: number;
  color: string;
}

interface WeekGridProps {
  birthDate: string;
  targetAgeYears: number;
  totalWeeks: number;
  currentWeek: number;
  blocks: LifeBlock[];
  overlay?: OverlayRange[];
  /** A range currently being drawn (start chosen, awaiting end). */
  pending?: { start: number; end: number } | null;
  onActivateWeek?: (weekIndex: number) => void;
  onHoverWeek?: (weekIndex: number | null) => void;
}

interface Paint {
  fill?: string;
  overlay?: string;
  lived: boolean;
  current: boolean;
}

export default function WeekGrid({
  birthDate,
  targetAgeYears,
  totalWeeks,
  currentWeek,
  blocks,
  overlay,
  pending,
  onActivateWeek,
  onHoverWeek,
}: WeekGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(() => Math.min(currentWeek, totalWeeks - 1));

  const paint = useMemo(() => {
    const arr: Paint[] = Array.from({ length: totalWeeks }, () => ({
      lived: false,
      current: false,
    }));
    for (let i = 0; i < totalWeeks; i++) {
      arr[i].lived = i < currentWeek;
      arr[i].current = i === currentWeek;
    }
    for (const b of blocks) {
      const s = Math.max(0, b.startWeekIndex);
      const e = Math.min(totalWeeks - 1, b.endWeekIndex);
      for (let i = s; i <= e; i++) arr[i].fill = b.color;
    }
    if (overlay) {
      for (const o of overlay) {
        const s = Math.max(0, o.startWeekIndex);
        const e = Math.min(totalWeeks - 1, o.endWeekIndex);
        for (let i = s; i <= e; i++) arr[i].overlay = o.color;
      }
    }
    if (pending) {
      const s = Math.max(0, Math.min(pending.start, pending.end));
      const e = Math.min(totalWeeks - 1, Math.max(pending.start, pending.end));
      for (let i = s; i <= e; i++) arr[i].fill = "var(--plan)";
    }
    return arr;
  }, [totalWeeks, currentWeek, blocks, overlay, pending]);

  const weekFromEvent = (target: EventTarget | null): number | null => {
    const el = (target as HTMLElement | null)?.closest?.("[data-week]") as
      | HTMLElement
      | null;
    if (!el) return null;
    const n = Number(el.dataset.week);
    return Number.isFinite(n) ? n : null;
  };

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const w = weekFromEvent(e.target);
      if (w !== null) {
        setFocused(w);
        onActivateWeek?.(w);
      }
    },
    [onActivateWeek],
  );

  const handleOver = useCallback(
    (e: React.MouseEvent) => {
      const w = weekFromEvent(e.target);
      onHoverWeek?.(w);
    },
    [onHoverWeek],
  );

  const focusWeek = useCallback((w: number) => {
    const clamped = Math.max(0, Math.min(w, totalWeeks - 1));
    setFocused(clamped);
    const node = containerRef.current?.querySelector<HTMLElement>(
      `[data-week="${clamped}"]`,
    );
    node?.focus();
  }, [totalWeeks]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      let next = focused;
      switch (e.key) {
        case "ArrowRight": next = focused + 1; break;
        case "ArrowLeft": next = focused - 1; break;
        case "ArrowDown": next = focused + WEEKS_PER_YEAR; break;
        case "ArrowUp": next = focused - WEEKS_PER_YEAR; break;
        case "Home": next = focused - (focused % WEEKS_PER_YEAR); break;
        case "End": next = focused - (focused % WEEKS_PER_YEAR) + (WEEKS_PER_YEAR - 1); break;
        case "Enter":
        case " ":
          e.preventDefault();
          onActivateWeek?.(focused);
          return;
        default:
          return;
      }
      e.preventDefault();
      focusWeek(next);
    },
    [focused, focusWeek, onActivateWeek],
  );

  const rows = Math.ceil(totalWeeks / WEEKS_PER_YEAR);

  return (
    <div className="w-full overflow-x-auto">
      <div
        ref={containerRef}
        role="grid"
        aria-label="Your life in weeks"
        aria-rowcount={rows}
        aria-colcount={WEEKS_PER_YEAR}
        onClick={handleClick}
        onMouseOver={handleOver}
        onMouseLeave={() => onHoverWeek?.(null)}
        onKeyDown={handleKey}
        className="grid min-w-[560px] gap-[2px] select-none"
        style={{ gridTemplateColumns: `2ch repeat(${WEEKS_PER_YEAR}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: rows }, (_, row) => {
          const showLabel = row === 0 || (row + 1) % 5 === 0;
          return (
            <div key={row} role="row" style={{ display: "contents" }}>
              <div
                role="rowheader"
                className="flex items-center justify-end pr-1 text-[9px] tabular-nums text-[var(--muted)]"
                aria-label={`Age ${row}`}
              >
                {showLabel ? row : ""}
              </div>
              {Array.from({ length: WEEKS_PER_YEAR }, (_, col) => {
                const i = row * WEEKS_PER_YEAR + col;
                if (i >= totalWeeks) {
                  return <div key={col} role="gridcell" aria-hidden className="aspect-square" />;
                }
                const p = paint[i];
                const style: CSSProperties = { aspectRatio: "1 / 1" };
                if (p.fill) style.backgroundColor = p.fill;
                else if (p.lived) style.backgroundColor = "color-mix(in srgb, var(--sea) 28%, transparent)";
                if (p.current) {
                  style.backgroundColor = "var(--current)";
                  style.boxShadow = "0 0 0 2px var(--current)";
                }
                if (p.overlay) style.outline = `2px solid ${p.overlay}`;
                return (
                  <button
                    key={col}
                    type="button"
                    data-week={i}
                    role="gridcell"
                    tabIndex={i === focused ? 0 : -1}
                    aria-selected={p.current}
                    aria-label={weekLabel(birthDate, i)}
                    title={weekLabel(birthDate, i)}
                    className={
                      "aspect-square w-full rounded-[2px] border border-[var(--line)] " +
                      "transition-colors hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[var(--current)] " +
                      (p.current ? "animate-[waypoint-pulse_2s_ease-in-out_infinite]" : "")
                    }
                    style={style}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
