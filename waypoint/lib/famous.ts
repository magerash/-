// Loads bundled, read-only historical lifemaps and aligns them to the user's grid by age.
// Facts only, sourced from Wikidata (CC0). See docs/specs/research_famous-people-and-legal.md.
import type { Category, FamousLifeMap } from "./types";
import { MS_PER_WEEK, parseBirth } from "./weeks";

import einstein from "@/data/famous/einstein.json";
import curie from "@/data/famous/curie.json";
import ford from "@/data/famous/ford.json";
import edison from "@/data/famous/edison.json";
import davinci from "@/data/famous/davinci.json";

/** Authoring shape of the JSON files (eras dated by real calendar dates). */
interface FamousSource {
  id: string;
  name: string;
  birthDate: string;
  deathDate?: string;
  summary?: string;
  eras: {
    title: string;
    from: string;
    to?: string;
    category?: Category;
    source: string;
  }[];
}

function dateToWeekIndex(birthDate: string, iso: string): number {
  const birth = parseBirth(birthDate).getTime();
  return Math.max(0, Math.floor((parseBirth(iso).getTime() - birth) / MS_PER_WEEK));
}

function build(src: FamousSource): FamousLifeMap {
  const end = src.deathDate ?? new Date().toISOString().slice(0, 10);
  return {
    id: src.id,
    name: src.name,
    birthDate: src.birthDate,
    deathDate: src.deathDate,
    summary: src.summary,
    blocks: src.eras.map((e) => ({
      title: e.title,
      startWeekIndex: dateToWeekIndex(src.birthDate, e.from),
      endWeekIndex: dateToWeekIndex(src.birthDate, e.to ?? end),
      category: e.category,
      source: e.source,
    })),
  };
}

export const FAMOUS_LIFEMAPS: FamousLifeMap[] = [
  einstein,
  curie,
  ford,
  edison,
  davinci,
].map((s) => build(s as FamousSource));

export function getFamous(id: string): FamousLifeMap | undefined {
  return FAMOUS_LIFEMAPS.find((f) => f.id === id);
}

/** Era a famous person was in at a given age-in-weeks, for "at my age, they had…" callouts. */
export function eraAtWeek(f: FamousLifeMap, weekIndex: number) {
  return f.blocks.find((b) => weekIndex >= b.startWeekIndex && weekIndex <= b.endWeekIndex);
}
