// GARGANTUA - CPU mirror of the shader's geodesic integrator.
// Used by the test-suite to verify the physics the GPU executes:
//   d²x/dλ² = -1.5 h² x / r⁵      (rs = 1, h = |x × v| conserved)
// Exported so js/test/run.mjs can assert photon sphere, shadow radius,
// deflection angle and disk crossings without a GPU.

export const RS = 1.0;
export const R_SKY = 44.0;

export function rk4Step(p, v, h2, dt) {
  const len5 = (x) => {
    const r = Math.hypot(x[0], x[1], x[2]);
    return Math.pow(r, 5);
  };
  const acc = (x, out) => {
    const k = (-1.5 * h2) / len5(x);
    out[0] = k * x[0]; out[1] = k * x[1]; out[2] = k * x[2];
  };
  const a1 = [0, 0, 0], a2 = [0, 0, 0], a3 = [0, 0, 0], a4 = [0, 0, 0];
  const p2 = [0, 0, 0], p3 = [0, 0, 0], p4 = [0, 0, 0];
  const v2 = [0, 0, 0], v3 = [0, 0, 0], v4 = [0, 0, 0];

  acc(p, a1);
  for (let i = 0; i < 3; i++) { p2[i] = p[i] + v[i] * dt * 0.5; v2[i] = v[i] + a1[i] * dt * 0.5; }
  acc(p2, a2);
  for (let i = 0; i < 3; i++) { p3[i] = p[i] + v2[i] * dt * 0.5; v3[i] = v[i] + a2[i] * dt * 0.5; }
  acc(p3, a3);
  for (let i = 0; i < 3; i++) { p4[i] = p[i] + v3[i] * dt; v4[i] = v[i] + a3[i] * dt; }
  acc(p4, a4);
  for (let i = 0; i < 3; i++) {
    p[i] += (dt / 6) * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]);
    v[i] += (dt / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]);
  }
}

/**
 * Trace one ray. Mirrors the shader loop (adaptive step, plane-crossing
 * detection). Returns { captured, escaped, steps, crossings, endDir }.
 */
export function traceRay(camPos, dir, opts = {}) {
  const maxSteps = opts.maxSteps ?? 600;
  const diskInner = opts.diskInner ?? 3;
  const diskOuter = opts.diskOuter ?? 13;
  const p = [...camPos];
  const v = [...dir];
  const h = [
    p[1] * v[2] - p[2] * v[1],
    p[2] * v[0] - p[0] * v[2],
    p[0] * v[1] - p[1] * v[0],
  ];
  const h2 = h[0] * h[0] + h[1] * h[1] + h[2] * h[2];

  let captured = false, escaped = false, steps = 0;
  const crossings = [];

  for (let i = 0; i < maxSteps; i++) {
    steps = i;
    const r = Math.hypot(p[0], p[1], p[2]);
    if (r <= RS) { captured = true; break; }
    if (r > R_SKY && p[0] * v[0] + p[1] * v[1] + p[2] * v[2] > 0) { escaped = true; break; }

    let dt = Math.min(Math.max(0.05 * r, 0.04), 1.0);
    const ay = Math.abs(p[1]);
    if (r < diskOuter + 2 && ay < 0.6) dt = Math.min(dt, 0.05 + 0.5 * ay);

    const pPrev = [...p];
    rk4Step(p, v, h2, dt);

    if (pPrev[1] * p[1] < 0 && crossings.length < 4) {
      const t = pPrev[1] / (pPrev[1] - p[1]);
      const c = [
        pPrev[0] + (p[0] - pPrev[0]) * t,
        0,
        pPrev[2] + (p[2] - pPrev[2]) * t,
      ];
      const rc = Math.hypot(c[0], c[2]);
      if (rc > diskInner * 0.98 && rc < diskOuter) crossings.push(rc);
    }
  }
  return { captured, escaped, steps, crossings, endDir: v };
}

/** local circular-orbit speed (mirrors shader): β = sqrt(M/(r-2M)), M=0.5 */
export function orbitBeta(r) {
  return Math.min(Math.sqrt(0.5 / Math.max(r - 1, 0.06)), 0.995);
}
export function dopplerFactor(beta, cosAngle) {
  return Math.sqrt(1 - beta * beta) / Math.max(1 - beta * cosAngle, 1e-3);
}
