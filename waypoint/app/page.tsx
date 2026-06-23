"use client";

import { useEffect, useState } from "react";
import { useLifeStore } from "@/lib/store";
import { readShareFromHash } from "@/lib/share";
import { isLifeMap } from "@/lib/exportImport";
import Onboarding from "@/components/Onboarding";
import LifeMapView from "@/components/LifeMapView";

export default function Home() {
  const hydrated = useLifeStore((s) => s.hydrated);
  const lifemap = useLifeStore((s) => s.lifemap);
  const hydrate = useLifeStore((s) => s.hydrate);
  const createLifeMap = useLifeStore((s) => s.createLifeMap);
  const importLifeMap = useLifeStore((s) => s.importLifeMap);
  const [checkedShare, setCheckedShare] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // After hydration, adopt a shared map only if there's nothing local to clobber.
  useEffect(() => {
    if (!hydrated || checkedShare) return;
    setCheckedShare(true);
    const shared = readShareFromHash();
    if (shared && isLifeMap(shared) && !lifemap) {
      importLifeMap(shared);
      history.replaceState(null, "", window.location.pathname);
    }
  }, [hydrated, checkedShare, lifemap, importLifeMap]);

  if (!hydrated) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-[var(--muted)]">
        <span className="animate-pulse">Charting your weeks…</span>
      </main>
    );
  }

  if (!lifemap) return <Onboarding onComplete={createLifeMap} />;
  return <LifeMapView />;
}
