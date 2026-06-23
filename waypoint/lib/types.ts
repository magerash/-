// Core domain types for Waypoint. See docs/glossary.md and docs/specs/0001-mvp-life-in-weeks.md.

export const WEEKS_PER_YEAR = 52; // canonical Wait-But-Why grid: one row = one year

export type Category =
  | "education"
  | "career"
  | "family"
  | "health"
  | "project"
  | "other";

export const CATEGORY_META: Record<Category, { label: string; color: string }> = {
  education: { label: "Education", color: "#5a8dee" },
  career: { label: "Career", color: "#2a9d8f" },
  family: { label: "Family", color: "#e07a9b" },
  health: { label: "Health", color: "#7bbf6a" },
  project: { label: "Project", color: "#e9a23b" },
  other: { label: "Other", color: "#9b8cce" },
};

/** A named span of consecutive weeks, counted from birth (0-based, inclusive). */
export interface LifeBlock {
  id: string;
  title: string;
  category: Category;
  color: string;
  startWeekIndex: number;
  endWeekIndex: number;
  kind: "past" | "plan";
  note?: string;
  /** if-[when/where]-then-I'll implementation intention (plans). */
  intention?: { cue: string; action: string };
}

export interface Profile {
  name: string;
  birthDate: string; // ISO yyyy-mm-dd
  targetAgeYears: number;
}

export interface Settings {
  theme: "light" | "dark" | "system";
  reducedMotion: boolean;
  intensity: "gentle" | "full";
}

export interface LifeMap {
  version: number;
  profile: Profile;
  blocks: LifeBlock[];
  settings: Settings;
}

/** Bundled, read-only life of a notable person (facts only; see research_famous-people-and-legal). */
export interface FamousLifeMap {
  id: string;
  name: string;
  birthDate: string;
  deathDate?: string;
  summary?: string;
  blocks: {
    title: string;
    startWeekIndex: number;
    endWeekIndex: number;
    category?: Category;
    source: string; // Wikidata / authority URL
  }[];
}

export const LIFEMAP_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  reducedMotion: false,
  intensity: "gentle",
};

/** Calm palette offered in the block editor. */
export const BLOCK_PALETTE = [
  "#2a9d8f",
  "#5a8dee",
  "#e9a23b",
  "#e07a9b",
  "#7bbf6a",
  "#9b8cce",
  "#4cb5c4",
  "#d98c5f",
];
