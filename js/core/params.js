// GARGANTUA - the 21 tweakable parameters (schema shared by HUD, state, URL)

export const PARAM_GROUPS = ['GEOMETRY', 'DISK', 'RELATIVITY', 'SKY', 'CAMERA', 'POST'];

export const PARAMS = [
  // GEOMETRY
  { key: 'diskInner',  group: 'GEOMETRY', label: 'Disk inner R (rs)', min: 2.2, max: 5.0,  step: 0.05, def: 3.0,  fmt: v => v.toFixed(2) },
  { key: 'diskOuter',  group: 'GEOMETRY', label: 'Disk outer R (rs)', min: 6.0, max: 18.0, step: 0.1,  def: 13.0, fmt: v => v.toFixed(1) },
  // DISK
  { key: 'diskDensity',group: 'DISK', label: 'Disk density',      min: 0.05, max: 3.0, step: 0.01, def: 1.0,  fmt: v => v.toFixed(2) },
  { key: 'diskTemp',   group: 'DISK', label: 'Disk peak T (kK)',  min: 2.0,  max: 12.0, step: 0.1,  def: 5.6,  fmt: v => v.toFixed(1) },
  { key: 'diskSpeed',  group: 'DISK', label: 'Rotation speed ×',  min: 0.0,  max: 3.0, step: 0.01, def: 1.0,  fmt: v => v.toFixed(2) },
  { key: 'turbulence', group: 'DISK', label: 'Turbulence',        min: 0.0,  max: 2.0, step: 0.01, def: 1.0,  fmt: v => v.toFixed(2) },
  { key: 'turbScale',  group: 'DISK', label: 'Turbulence scale',  min: 0.5,  max: 6.0, step: 0.05, def: 2.2,  fmt: v => v.toFixed(2) },
  // RELATIVITY
  { key: 'doppler',    group: 'RELATIVITY', label: 'Doppler beaming g^n', min: 0.0, max: 4.0, step: 0.05, def: 3.0, fmt: v => v.toFixed(2) },
  { key: 'redshift',   group: 'RELATIVITY', label: 'Grav. redshift mix', min: 0.0, max: 1.0, step: 0.01, def: 1.0, fmt: v => v.toFixed(2) },
  // SKY
  { key: 'starBrightness', group: 'SKY', label: 'Star brightness', min: 0.0, max: 3.0, step: 0.01, def: 1.0, fmt: v => v.toFixed(2) },
  { key: 'starDensity',    group: 'SKY', label: 'Star density',    min: 0.2, max: 3.0, step: 0.01, def: 1.0, fmt: v => v.toFixed(2) },
  { key: 'milkyWay',       group: 'SKY', label: 'Milky Way',       min: 0.0, max: 3.0, step: 0.01, def: 1.0, fmt: v => v.toFixed(2) },
  // CAMERA
  { key: 'fov',        group: 'CAMERA', label: 'Field of view °', min: 30, max: 95, step: 0.5, def: 62, fmt: v => v.toFixed(0) },
  { key: 'timeScale',  group: 'CAMERA', label: 'Time scale ×',    min: 0.0, max: 3.0, step: 0.01, def: 1.0, fmt: v => v.toFixed(2) },
  // POST
  { key: 'exposure',       group: 'POST', label: 'Exposure',          min: 0.4, max: 4.0,  step: 0.01, def: 1.4,  fmt: v => v.toFixed(2) },
  { key: 'bloomStrength',  group: 'POST', label: 'Bloom strength',    min: 0.0, max: 2.0,  step: 0.01, def: 0.75, fmt: v => v.toFixed(2) },
  { key: 'bloomRadius',    group: 'POST', label: 'Bloom radius',      min: 0.2, max: 1.6,  step: 0.01, def: 0.85, fmt: v => v.toFixed(2) },
  { key: 'bloomThreshold', group: 'POST', label: 'Bloom threshold',   min: 0.0, max: 2.0,  step: 0.01, def: 1.0,  fmt: v => v.toFixed(2) },
  { key: 'grain',          group: 'POST', label: 'Film grain',        min: 0.0, max: 0.15, step: 0.001,def: 0.045,fmt: v => (v).toFixed(3) },
  { key: 'vignette',       group: 'POST', label: 'Vignette',          min: 0.0, max: 1.0,  step: 0.01, def: 0.42, fmt: v => v.toFixed(2) },
  { key: 'dispersion',     group: 'POST', label: 'Dispersion',        min: 0.0, max: 1.0,  step: 0.01, def: 0.25, fmt: v => v.toFixed(2) },
];

export const PARAM_KEYS = PARAMS.map(p => p.key);

export function defaultParams() {
  const o = {};
  for (const p of PARAMS) o[p.key] = p.def;
  return o;
}

export function clampParam(key, value) {
  const p = PARAMS.find(p => p.key === key);
  if (!p) return undefined;
  const v = Number(value);
  if (!Number.isFinite(v)) return p.def;
  return Math.min(p.max, Math.max(p.min, v));
}

// sanitize an arbitrary object into a valid params record
export function sanitizeParams(input) {
  const out = defaultParams();
  if (input && typeof input === 'object') {
    for (const p of PARAMS) {
      if (input[p.key] !== undefined) out[p.key] = clampParam(p.key, input[p.key]);
    }
  }
  return out;
}

export const QUALITY_TIERS = ['standard', 'high', 'cinematic'];
export function sanitizeQuality(q) {
  return QUALITY_TIERS.includes(q) ? q : 'high';
}
export function sanitizeDebug(d) {
  const n = Number(d);
  return Number.isInteger(n) && n >= 0 && n <= 9 ? n : 0;
}
