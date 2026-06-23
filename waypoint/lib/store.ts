// Zustand store persisted to IndexedDB via idb-keyval. Client-side only.
"use client";

import { create } from "zustand";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import {
  type LifeMap,
  type LifeBlock,
  type Profile,
  type Settings,
  DEFAULT_SETTINGS,
  LIFEMAP_VERSION,
} from "./types";

const KEY = "waypoint.lifemap";

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Forward-compatible migration hook. */
function migrate(lm: LifeMap): LifeMap {
  return { ...lm, version: LIFEMAP_VERSION };
}

interface StoreState {
  lifemap: LifeMap | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  createLifeMap: (profile: Profile) => void;
  importLifeMap: (lm: LifeMap) => void;
  updateProfile: (patch: Partial<Profile>) => void;
  setSettings: (patch: Partial<Settings>) => void;
  addBlock: (block: Omit<LifeBlock, "id">) => string;
  updateBlock: (id: string, patch: Partial<LifeBlock>) => void;
  removeBlock: (id: string) => void;
  reset: () => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(lm: LifeMap | null) {
  if (typeof window === "undefined") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (lm) void idbSet(KEY, lm);
    else void idbDel(KEY);
  }, 200);
}

function commit(set: (p: Partial<StoreState>) => void, lm: LifeMap | null) {
  persist(lm);
  set({ lifemap: lm });
}

export const useLifeStore = create<StoreState>((set, getState) => ({
  lifemap: null,
  hydrated: false,

  async hydrate() {
    if (typeof window === "undefined") return;
    try {
      // Best-effort durable storage so iOS doesn't evict after ~7 days.
      if (navigator.storage?.persist) void navigator.storage.persist();
      const stored = (await idbGet(KEY)) as LifeMap | undefined;
      set({ lifemap: stored ? migrate(stored) : null, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  createLifeMap(profile) {
    const lm: LifeMap = {
      version: LIFEMAP_VERSION,
      profile,
      blocks: [],
      settings: { ...DEFAULT_SETTINGS },
    };
    commit(set, lm);
  },

  importLifeMap(lm) {
    commit(set, migrate(lm));
  },

  updateProfile(patch) {
    const lm = getState().lifemap;
    if (!lm) return;
    commit(set, { ...lm, profile: { ...lm.profile, ...patch } });
  },

  setSettings(patch) {
    const lm = getState().lifemap;
    if (!lm) return;
    commit(set, { ...lm, settings: { ...lm.settings, ...patch } });
  },

  addBlock(block) {
    const lm = getState().lifemap;
    if (!lm) return "";
    const id = uid();
    commit(set, { ...lm, blocks: [...lm.blocks, { ...block, id }] });
    return id;
  },

  updateBlock(id, patch) {
    const lm = getState().lifemap;
    if (!lm) return;
    commit(set, {
      ...lm,
      blocks: lm.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    });
  },

  removeBlock(id) {
    const lm = getState().lifemap;
    if (!lm) return;
    commit(set, { ...lm, blocks: lm.blocks.filter((b) => b.id !== id) });
  },

  reset() {
    commit(set, null);
  },
}));
