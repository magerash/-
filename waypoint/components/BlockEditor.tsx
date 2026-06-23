"use client";

import { useState } from "react";
import {
  type Category,
  type LifeBlock,
  CATEGORY_META,
  BLOCK_PALETTE,
} from "@/lib/types";
import { ageAtWeek } from "@/lib/weeks";

interface Props {
  start: number;
  end: number;
  currentWeek: number;
  initial?: LifeBlock;
  onSave: (data: Omit<LifeBlock, "id">) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export default function BlockEditor({ start, end, currentWeek, initial, onSave, onDelete, onClose }: Props) {
  const s = Math.min(start, end);
  const e = Math.max(start, end);
  const kind: LifeBlock["kind"] = e < currentWeek ? "past" : "plan";

  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState<Category>(initial?.category ?? (kind === "past" ? "education" : "project"));
  const [color, setColor] = useState(initial?.color ?? CATEGORY_META[initial?.category ?? "project"].color);
  const [note, setNote] = useState(initial?.note ?? "");
  const [cue, setCue] = useState(initial?.intention?.cue ?? "");
  const [action, setAction] = useState(initial?.intention?.action ?? "");

  const weeks = e - s + 1;

  const save = () => {
    onSave({
      title: title.trim() || (kind === "past" ? "Chapter" : "Plan"),
      category,
      color,
      startWeekIndex: s,
      endWeekIndex: e,
      kind,
      note: note.trim() || undefined,
      intention: kind === "plan" && (cue.trim() || action.trim()) ? { cue: cue.trim(), action: action.trim() } : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-[var(--surface)] p-6 shadow-xl sm:rounded-2xl"
        onClick={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "Edit block" : "New block"}
      >
        <div className="mb-4 flex items-center justify-between">
          <span
            className="rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ backgroundColor: kind === "past" ? "color-mix(in srgb, var(--sea) 22%, transparent)" : "color-mix(in srgb, var(--plan) 22%, transparent)" }}
          >
            {kind === "past" ? "Chapter (already lived)" : "Plan (weeks ahead)"}
          </span>
          <span className="text-sm tabular-nums text-[var(--muted)]">
            Age {ageAtWeek(s)}–{ageAtWeek(e)} · {weeks} {weeks === 1 ? "week" : "weeks"}
          </span>
        </div>

        <label className="block text-sm font-medium">Title</label>
        <input
          autoFocus
          value={title}
          onChange={(ev) => setTitle(ev.target.value)}
          placeholder={kind === "past" ? "e.g. University" : "e.g. Write my book"}
          className="mt-1 mb-4 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--current)]"
        />

        <label className="block text-sm font-medium">Category</label>
        <select
          value={category}
          onChange={(ev) => {
            const c = ev.target.value as Category;
            setCategory(c);
            setColor(CATEGORY_META[c].color);
          }}
          className="mt-1 mb-4 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--current)]"
        >
          {Object.entries(CATEGORY_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        <label className="block text-sm font-medium">Color</label>
        <div className="mt-2 mb-4 flex flex-wrap gap-2">
          {BLOCK_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              className={"h-7 w-7 rounded-full transition " + (color === c ? "ring-2 ring-offset-2 ring-[var(--text)] ring-offset-[var(--surface)]" : "")}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        {kind === "plan" && (
          <div className="mb-4 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3">
            <p className="mb-2 text-sm font-medium">Make it stick (optional)</p>
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <span className="w-12 text-[var(--muted)]">When</span>
                <input value={cue} onChange={(ev) => setCue(ev.target.value)} placeholder="every Sunday morning" className="flex-1 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 outline-none focus:ring-2 focus:ring-[var(--current)]" />
              </label>
              <label className="flex items-center gap-2">
                <span className="w-12 text-[var(--muted)]">I will</span>
                <input value={action} onChange={(ev) => setAction(ev.target.value)} placeholder="write for one hour" className="flex-1 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 outline-none focus:ring-2 focus:ring-[var(--current)]" />
              </label>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            {onDelete && (
              <button onClick={onDelete} className="text-sm text-red-500 hover:underline">Delete</button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-full px-4 py-2 text-sm text-[var(--muted)] hover:text-[var(--text)]">Cancel</button>
            <button onClick={save} className="rounded-full bg-[var(--sea)] px-5 py-2 text-sm font-medium text-white hover:brightness-110">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
