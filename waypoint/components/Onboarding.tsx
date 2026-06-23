"use client";

import { useState } from "react";
import type { Profile } from "@/lib/types";
import { lifeStats } from "@/lib/weeks";

const TODAY = new Date().toISOString().slice(0, 10);

export default function Onboarding({ onComplete }: { onComplete: (p: Profile) => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [targetAge, setTargetAge] = useState(90);

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));

  const canName = name.trim().length > 0;
  const canBirth = !!birthDate && birthDate <= TODAY;
  const stats = canBirth ? lifeStats(birthDate, targetAge) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-8 px-6 py-12">
      <Boat />

      {step === 0 && (
        <Panel
          title="Welcome aboard."
          body="Most of us drift down the river of life like a boat without a hand on the helm. Waypoint lays your whole life out as a map of weeks — so you can take the helm and steer the weeks ahead with intention. This is a tool for reflection, not dread."
          primary="Begin"
          onPrimary={next}
        />
      )}

      {step === 1 && (
        <Panel title="What should we call you?" onPrimary={next} primary="Continue" onBack={back} primaryDisabled={!canName}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canName && next()}
            placeholder="Your name"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-[var(--current)]"
          />
        </Panel>
      )}

      {step === 2 && (
        <Panel title={`When did your journey begin, ${name.trim()}?`} onPrimary={next} primary="Continue" onBack={back} primaryDisabled={!canBirth}>
          <input
            autoFocus
            type="date"
            max={TODAY}
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-lg outline-none focus:ring-2 focus:ring-[var(--current)]"
          />
          <p className="text-sm text-[var(--muted)]">Your date of birth — the first square on your map.</p>
        </Panel>
      )}

      {step === 3 && (
        <Panel title="How long do you intend to sail?" onPrimary={next} primary="See my map" onBack={back}>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-semibold tabular-nums text-[var(--sea)]">{targetAge}</span>
            <span className="text-[var(--muted)]">years</span>
          </div>
          <input
            type="range"
            min={60}
            max={100}
            value={targetAge}
            onChange={(e) => setTargetAge(Number(e.target.value))}
            className="w-full accent-[var(--sea)]"
          />
          {stats && (
            <p className="text-sm text-[var(--muted)]">
              That&apos;s <strong className="text-[var(--text)]">{stats.total.toLocaleString()}</strong> weeks —{" "}
              <strong className="text-[var(--text)]">{stats.ahead.toLocaleString()}</strong> of them still ahead of you.
            </p>
          )}
        </Panel>
      )}

      {step === 4 && (
        <Panel
          title="Your map is ready."
          body="Each square is one week. The glowing square is this week. From here you can name the chapters you've lived and plan the ones ahead."
          primary="Open my life map"
          onPrimary={() => onComplete({ name: name.trim(), birthDate, targetAgeYears: targetAge })}
          onBack={back}
        />
      )}

      <Dots count={5} active={step} />
    </main>
  );
}

function Panel({
  title,
  body,
  children,
  primary,
  onPrimary,
  onBack,
  primaryDisabled,
}: {
  title: string;
  body?: string;
  children?: React.ReactNode;
  primary: string;
  onPrimary: () => void;
  onBack?: () => void;
  primaryDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {body && <p className="leading-relaxed text-[var(--muted)]">{body}</p>}
      {children}
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={onPrimary}
          disabled={primaryDisabled}
          className="rounded-full bg-[var(--sea)] px-6 py-3 font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {primary}
        </button>
        {onBack && (
          <button onClick={onBack} className="px-3 py-3 text-sm text-[var(--muted)] hover:text-[var(--text)]">
            Back
          </button>
        )}
      </div>
    </div>
  );
}

function Dots({ count, active }: { count: number; active: number }) {
  return (
    <div className="flex justify-center gap-2">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={"h-1.5 rounded-full transition-all " + (i === active ? "w-6 bg-[var(--sea)]" : "w-1.5 bg-[var(--line)]")}
        />
      ))}
    </div>
  );
}

function Boat() {
  return (
    <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden>
      <line x1="32" y1="10" x2="32" y2="41" stroke="var(--text)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M32 12 L32 38 L16 38 Z" fill="var(--current)" />
      <path d="M13 39 L51 39 Q47 49 32 49 Q17 49 13 39 Z" fill="var(--text)" />
      <circle cx="43" cy="34.5" r="3.1" fill="var(--plan)" />
      <path d="M7 45 q6.5 4 13 0 t13 0 t13 0 t13 0" fill="none" stroke="var(--sea)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
