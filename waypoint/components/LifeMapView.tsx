"use client";

import { useEffect, useRef, useState } from "react";
import { useLifeStore } from "@/lib/store";
import { CATEGORY_META, type LifeBlock } from "@/lib/types";
import { ageAtWeek, currentWeekIndex, lifeStats, totalWeeks } from "@/lib/weeks";
import { FAMOUS_LIFEMAPS, eraAtWeek, getFamous } from "@/lib/famous";
import { exportLifeMap, importLifeMapFromFile } from "@/lib/exportImport";
import { shareUrl } from "@/lib/share";
import WeekGrid, { type OverlayRange } from "./WeekGrid";
import BlockEditor from "./BlockEditor";

export default function LifeMapView() {
  const lm = useLifeStore((s) => s.lifemap);
  const addBlock = useLifeStore((s) => s.addBlock);
  const updateBlock = useLifeStore((s) => s.updateBlock);
  const removeBlock = useLifeStore((s) => s.removeBlock);
  const setSettings = useLifeStore((s) => s.setSettings);
  const importLifeMap = useLifeStore((s) => s.importLifeMap);
  const reset = useLifeStore((s) => s.reset);

  const [selecting, setSelecting] = useState(false);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const [previewEnd, setPreviewEnd] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ start: number; end: number; block?: LifeBlock } | null>(null);
  const [famousId, setFamousId] = useState<string>("");
  const [flash, setFlash] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const theme = lm?.settings.theme ?? "system";
  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove("light", "dark");
    if (theme === "light") el.classList.add("light");
    else if (theme === "dark") el.classList.add("dark");
  }, [theme]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelSelect();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!lm) return null;

  const { birthDate, targetAgeYears, name } = lm.profile;
  const total = totalWeeks(targetAgeYears);
  const current = currentWeekIndex(birthDate);
  const stats = lifeStats(birthDate, targetAgeYears);

  const famous = famousId ? getFamous(famousId) : undefined;
  const overlay: OverlayRange[] | undefined = famous
    ? famous.blocks.map((b) => ({
        startWeekIndex: b.startWeekIndex,
        endWeekIndex: b.endWeekIndex,
        color: b.category ? CATEGORY_META[b.category].color : "#9b8cce",
      }))
    : undefined;
  const famousEraNow = famous ? eraAtWeek(famous, current) : undefined;

  function cancelSelect() {
    setSelecting(false);
    setPendingStart(null);
    setPreviewEnd(null);
  }

  function onActivateWeek(w: number) {
    if (selecting) {
      if (pendingStart === null) {
        setPendingStart(w);
        setPreviewEnd(w);
      } else {
        setEditor({ start: pendingStart, end: w });
        cancelSelect();
      }
      return;
    }
    const hit = lm!.blocks.find((b) => w >= b.startWeekIndex && w <= b.endWeekIndex);
    if (hit) setEditor({ start: hit.startWeekIndex, end: hit.endWeekIndex, block: hit });
  }

  function onHoverWeek(w: number | null) {
    if (selecting && pendingStart !== null && w !== null) setPreviewEnd(w);
  }

  async function onImportFile(file: File) {
    try {
      importLifeMap(await importLifeMapFromFile(file));
      setFlash("Life map imported.");
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "Import failed.");
    }
  }

  const pending = selecting && pendingStart !== null ? { start: pendingStart, end: previewEnd ?? pendingStart } : null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{name}&apos;s life in weeks</h1>
          <p className="text-sm text-[var(--muted)]">
            <strong className="text-[var(--text)]">{stats.lived.toLocaleString()}</strong> weeks lived ·{" "}
            <strong className="text-[var(--text)]">{stats.ahead.toLocaleString()}</strong> ahead to chart ·{" "}
            {Math.round(stats.percentLived * 100)}% of {stats.total.toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            onClick={() => (selecting ? cancelSelect() : setSelecting(true))}
            className={"rounded-full px-4 py-2 font-medium transition " + (selecting ? "bg-[var(--current)] text-black" : "bg-[var(--sea)] text-white hover:brightness-110")}
          >
            {selecting ? (pendingStart === null ? "Pick the start week…" : "Pick the end week…") : "+ Add block"}
          </button>
          <ThemeToggle theme={theme} onChange={(t) => setSettings({ theme: t })} />
          <button onClick={() => { exportLifeMap(lm); }} className="rounded-full border border-[var(--line)] px-3 py-2 hover:bg-[var(--surface)]">Export</button>
          <button onClick={() => fileRef.current?.click()} className="rounded-full border border-[var(--line)] px-3 py-2 hover:bg-[var(--surface)]">Import</button>
          <button
            onClick={async () => { await navigator.clipboard?.writeText(shareUrl(lm)); setFlash("Share link copied to clipboard."); }}
            className="rounded-full border border-[var(--line)] px-3 py-2 hover:bg-[var(--surface)]"
          >
            Share
          </button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportFile(f); e.target.value = ""; }} />
        </div>
      </header>

      {selecting && (
        <p role="status" className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted)]">
          {pendingStart === null
            ? "Click (or focus + Enter) the week your block starts."
            : "Now click the week it ends. Press Esc to cancel."}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <section className="rounded-xl bg-[var(--surface)] p-3 sm:p-4">
          <WeekGrid
            birthDate={birthDate}
            targetAgeYears={targetAgeYears}
            totalWeeks={total}
            currentWeek={current}
            blocks={lm.blocks}
            overlay={overlay}
            pending={pending}
            onActivateWeek={onActivateWeek}
            onHoverWeek={onHoverWeek}
          />
          <Legend />
        </section>

        <aside className="flex flex-col gap-5">
          <Blocks blocks={lm.blocks} onEdit={(b) => setEditor({ start: b.startWeekIndex, end: b.endWeekIndex, block: b })} />
          <FamousPanel
            famousId={famousId}
            onChange={setFamousId}
            currentAge={ageAtWeek(current)}
            eraNow={famousEraNow}
            famousName={famous?.name}
          />
          <button onClick={() => { if (confirm("Start over? This erases your map on this device.")) reset(); }} className="self-start text-xs text-[var(--muted)] hover:text-red-500">
            Reset map
          </button>
        </aside>
      </div>

      {editor && (
        <BlockEditor
          start={editor.start}
          end={editor.end}
          currentWeek={current}
          initial={editor.block}
          onSave={(data) => { if (editor.block) updateBlock(editor.block.id, data); else addBlock(data); setEditor(null); }}
          onDelete={editor.block ? () => { removeBlock(editor.block!.id); setEditor(null); } : undefined}
          onClose={() => setEditor(null)}
        />
      )}

      {flash && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-[var(--text)] px-4 py-2 text-sm text-[var(--bg)] shadow-lg">
          {flash}
        </div>
      )}
    </main>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
      <Swatch style={{ backgroundColor: "color-mix(in srgb, var(--sea) 28%, transparent)" }} label="Lived" />
      <Swatch style={{ backgroundColor: "var(--current)" }} label="This week" />
      <Swatch style={{ outline: "2px solid #9b8cce" }} label="Famous overlay" />
      <Swatch style={{ border: "1px solid var(--line)" }} label="Ahead" />
    </div>
  );
}

function Swatch({ style, label }: { style: React.CSSProperties; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-[2px]" style={style} />
      {label}
    </span>
  );
}

function Blocks({ blocks, onEdit }: { blocks: LifeBlock[]; onEdit: (b: LifeBlock) => void }) {
  if (blocks.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No blocks yet. Use <strong>+ Add block</strong> to name a chapter you&apos;ve lived or plan one ahead.</p>;
  }
  const sorted = [...blocks].sort((a, b) => a.startWeekIndex - b.startWeekIndex);
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-sm font-semibold">Your blocks</h2>
      {sorted.map((b) => (
        <button key={b.id} onClick={() => onEdit(b)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--surface)]">
          <span className="h-3 w-3 shrink-0 rounded-[2px]" style={{ backgroundColor: b.color }} />
          <span className="flex-1 truncate">{b.title}</span>
          <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{ageAtWeek(b.startWeekIndex)}–{ageAtWeek(b.endWeekIndex)}</span>
        </button>
      ))}
    </div>
  );
}

function FamousPanel({
  famousId,
  onChange,
  currentAge,
  eraNow,
  famousName,
}: {
  famousId: string;
  onChange: (id: string) => void;
  currentAge: number;
  eraNow?: { title: string };
  famousName?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Compare a life</h2>
      <select value={famousId} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--current)]">
        <option value="">None</option>
        {FAMOUS_LIFEMAPS.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      {famousName && (
        <div className="rounded-lg bg-[var(--surface)] p-3 text-sm">
          {eraNow ? (
            <p>At your age (<strong>{currentAge}</strong>), {famousName} was in:<br /><strong>{eraNow.title}</strong></p>
          ) : (
            <p className="text-[var(--muted)]">{famousName}&apos;s mapped life doesn&apos;t reach your current age yet.</p>
          )}
          <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">
            Educational/factual eras from Wikidata. Not affiliated with or endorsed by anyone featured.
          </p>
        </div>
      )}
    </div>
  );
}

function ThemeToggle({ theme, onChange }: { theme: "light" | "dark" | "system"; onChange: (t: "light" | "dark" | "system") => void }) {
  const order: ("system" | "light" | "dark")[] = ["system", "light", "dark"];
  const labels = { system: "Auto", light: "Light", dark: "Dark" } as const;
  const next = order[(order.indexOf(theme) + 1) % order.length];
  return (
    <button onClick={() => onChange(next)} className="rounded-full border border-[var(--line)] px-3 py-2 hover:bg-[var(--surface)]" title="Toggle theme">
      {labels[theme]}
    </button>
  );
}
