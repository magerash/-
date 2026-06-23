// JSON export/import — the portable backup of a LifeMap (data-safety requirement). Client-side.
import { type LifeMap, LIFEMAP_VERSION } from "./types";

export function exportLifeMap(lm: LifeMap): void {
  const blob = new Blob([JSON.stringify(lm, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const name = lm.profile.name?.trim().replace(/\s+/g, "-").toLowerCase() || "lifemap";
  a.href = url;
  a.download = `waypoint-${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function isLifeMap(x: unknown): x is LifeMap {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.profile === "object" &&
    o.profile !== null &&
    Array.isArray(o.blocks) &&
    typeof (o.profile as Record<string, unknown>).birthDate === "string"
  );
}

export async function importLifeMapFromFile(file: File): Promise<LifeMap> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!isLifeMap(parsed)) throw new Error("This file is not a valid Waypoint life map.");
  return { ...parsed, version: LIFEMAP_VERSION };
}
