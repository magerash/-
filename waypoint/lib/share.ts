// Read-only share: encode a LifeMap into a URL hash (no backend). Client-side.
import type { LifeMap } from "./types";

function toB64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShare(lm: LifeMap): string {
  return toB64Url(JSON.stringify(lm));
}

export function decodeShare(token: string): LifeMap | null {
  try {
    return JSON.parse(fromB64Url(token)) as LifeMap;
  } catch {
    return null;
  }
}

export function shareUrl(lm: LifeMap): string {
  const base = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
  return `${base}#m=${encodeShare(lm)}`;
}

/** Read a shared LifeMap from the current URL hash, if present. */
export function readShareFromHash(): LifeMap | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/m=([^&]+)/);
  return m ? decodeShare(m[1]) : null;
}
