// GARGANTUA - persistence (localStorage) + URL automation interface.
//
// URL parameters (for screenshots / CI automation):
//   ?shot=1              capture a PNG after warm-up frames and auto-download
//   &frames=12           frames to warm up before capture (default 8)
//   &w=1280&h=720        canvas size override for the session
//   &quality=cinematic   standard | high | cinematic
//   &view=2              camera preset 0..3
//   &debug=3             debug view 0..9
//   &hideui=1            hide HUD/panel/hints
//   &t=12.5              freeze disk time at t seconds (reproducible)
//   &nodl=1              don't auto-download (still sets window.__GARGANTUA_SHOT__)
//   &p_bloomStrength=1.2 override any of the 21 parameters

export const LS_KEY = 'gargantua.state.v1';

import { sanitizeParams, sanitizeQuality, sanitizeDebug, PARAM_KEYS } from './params.js';

export function loadState(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return {
      params: sanitizeParams(s.params),
      quality: sanitizeQuality(s.quality ?? 'high'),
      debug: sanitizeDebug(s.debug ?? 0),
      view: Number.isInteger(s.view) && s.view >= 0 && s.view <= 3 ? s.view : 0,
      hudVisible: s.hudVisible !== false,
      panelOpen: s.panelOpen === true,
      cinematic: s.cinematic === true,
    };
  } catch {
    return null; // corrupted state -> fresh start, never a black screen
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(LS_KEY, JSON.stringify({
      params: sanitizeParams(state.params),
      quality: state.quality,
      debug: state.debug,
      view: state.view,
      hudVisible: state.hudVisible,
      panelOpen: state.panelOpen,
      cinematic: state.cinematic,
    }));
  } catch { /* private mode / quota: persistence is best-effort */ }
}

export function debouncedSave(ms, fn) {
  let t = 0;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/** Parse the automation/config URL. Returns {config, paramOverrides}. */
export function parseURL(search, defaults = {}) {
  const q = new URLSearchParams(search);
  const num = (k) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  const dv = num('view');
  const dd = num('debug');
  const config = {
    shot: q.get('shot') === '1',
    frames: Math.max(1, Math.min(600, num('frames') ?? 8)),
    width: num('width') ?? num('w'),
    height: num('height') ?? num('h'),
    quality: q.has('quality') ? sanitizeQuality(q.get('quality')) : (defaults.quality ?? 'high'),
    view: Number.isInteger(dv) && dv >= 0 && dv <= 3 ? dv : undefined,
    debug: Number.isInteger(dd) && dd >= 0 && dd <= 9 ? dd : undefined,
    hideui: q.get('hideui') === '1',
    fixedTime: num('t'),
    noDownload: q.get('nodl') === '1',
    reset: q.get('reset') === '1',
  };
  const paramOverrides = {};
  for (const [k, v] of q.entries()) {
    if (k.startsWith('p_')) {
      const key = k.slice(2);
      if (PARAM_KEYS.includes(key)) paramOverrides[key] = Number(v);
    }
  }
  return { config, paramOverrides };
}
