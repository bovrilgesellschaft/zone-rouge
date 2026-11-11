/**
 * Saving. The run is saved at each dawn, to the browser and as a string
 * the player can copy out and paste back. Both are checked against the
 * run state schema before they are trusted.
 */
import { MetaState, RunState } from '../schema/run-state.js';

const PREFIX = 'ZR1:';
export const RUN_KEY = 'zone-rouge/run/v1';
export const META_KEY = 'zone-rouge/meta/v1';

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function exportSave(state: RunState): string {
  return PREFIX + toBase64(JSON.stringify(state));
}

/** Throws a plain-English error if the string is not a sound save. */
export function importSave(text: string): RunState {
  const s = text.trim();
  if (!s.startsWith(PREFIX)) throw new Error('That is not a Zone Rouge save string. It should begin ZR1:');
  let raw: unknown;
  try {
    raw = JSON.parse(fromBase64(s.slice(PREFIX.length)));
  } catch {
    throw new Error('The save string is damaged. Check it was copied whole.');
  }
  const r = RunState.safeParse(raw);
  if (!r.success) throw new Error('The save string is from another version of the game or has been altered.');
  return r.data;
}

/** Minimal storage interface so tests can pass a fake. */
export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function saveRun(store: Store | undefined, state: RunState): boolean {
  try {
    store?.setItem(RUN_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function loadRun(store: Store | undefined): RunState | undefined {
  try {
    const raw = store?.getItem(RUN_KEY);
    if (!raw) return undefined;
    const r = RunState.safeParse(JSON.parse(raw));
    return r.success && !r.data.ended ? r.data : undefined;
  } catch {
    return undefined;
  }
}

export function clearRun(store: Store | undefined): void {
  try {
    store?.removeItem(RUN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function emptyMeta(): MetaState {
  return { version: 1, runs: 0, endings: {}, ledger: {}, beliefs: [], remains: [] };
}
