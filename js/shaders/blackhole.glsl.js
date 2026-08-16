// GARGANTUA — Schwarzschild black-hole raytracer (fragment).
// Units: Schwarzschild radius rs = 1.  ISCO = 3, photon sphere = 1.5,
// shadow impact parameter = sqrt(27)/2 ≈ 2.598.
//
// Null geodesics of the Schwarzschild metric obey the exact Cartesian ODE
// (see e.g. Riccardo Antonelli, "Ray Tracing a Black Hole"):
//     d²x/dλ² = -1.5 * h² * x / r⁵      (rs = 1, h = |x × v| conserved)
// We integrate it with RK4 + adaptive step; the ray is marched until it
// crosses the event horizon (captured, black), escapes to the sky sphere
// (procedural starfield, gravitationally lensed by construction), or runs
// out of steps. Every equatorial plane crossing inside the disk annulus
// accumulates relativistically shifted black-body emission (up to 4
// crossings → secondary/tertiary images + photon ring).

export const blackholeVert = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const blackholeFrag = /* glsl */`
precision highp float;

varying vec2 vUv;

uniform vec2  uResolution;
uniform float uTime;
uniform vec3  uCamPos;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform vec3  uCamFwd;
uniform float uTanFov;
uniform float uCamGrav;      // 1/sqrt(1 - 1/r_cam): gravitational blueshift of camera frame

uniform float uDiskInner;
uniform float uDiskOuter;
uniform float uDiskDensity;
uniform float uDiskTemp;     // peak effective temperature (kK)
uniform float uDiskSpeed;    // pattern rotation multiplier
uniform float uTurb;
uniform float uTurbScale;
uniform float uDoppler;      // beaming exponent 0..4
uniform float uRedshift;     // gravitational shift mix 0..1

uniform float uStars;
uniform float uStarDensity;
uniform float uMilkyWay;
uniform float uStarSharp;    // angular PSF radius (rad), CPU-computed
uniform float uSteps;        // max integration steps (quality tier)
uniform int   uDebug;        // 0..9

const float RS      = 1.0;   // event horizon radius
const float R_PH    = 1.5;   // photon sphere
const float R_SKY   = 44.0;  // escape radius
const int   MAX_STEPS = 640;
const int   MAX_CROSS = 4;   // tracked disk crossings

const float PI = 3.141592653589793;

// ---------------------------------------------------------------- hashing
float hash11(float n) { return fract(sin(n) * 43758.5453123); }
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// value noise + fbm (3D)
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i);
  float b = hash13(i + vec3(1.0, 0.0, 0.0));
  float c = hash13(i + vec3(0.0, 1.0, 0.0));
  float d = hash13(i + vec3(1.0, 1.0, 0.0));
  float e = hash13(i + vec3(0.0, 0.0, 1.0));
  float f1 = hash13(i + vec3(1.0, 0.0, 1.0));
  float g = hash13(i + vec3(0.0, 1.0, 1.0));
  float h = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
             mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(11.0, 17.0, 5.0);
    a *= 0.5;
  }
  return s; // ~0..1
}
float fbm6(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 6; i++) {
    s += a * vnoise(p);
    p = p * 2.11 + vec3(13.0, 7.0, 19.0);
    a *= 0.5;
  }
  return s;
}

// ------------------------------------------------------- black-body colour
// Planck spectral radiance sampled at ~R/G/B representative wavelengths,
// normalised to unit max. Physically-plausible thermal colour in linear HDR.
vec3 blackbody(float tK) {
  tK = clamp(tK, 800.0, 40000.0);
  vec3 lam = vec3(0.610e-6, 0.549e-6, 0.468e-6);       // R,G,B wavelengths (m)
  vec3 k = 1.43877e-2 / (lam * tK);                    // hc/kT per channel
  vec3 I = 1.0 / (pow(lam, vec3(5.0)) * (exp(k) - 1.0));
  return I / max(I.g, 1e-20);                          // normalize on green
}

// -------------------------------------------------------------- starfield
// Galactic frame (fixed tilt so the band crosses the frame nicely).
const vec3 GZ = vec3(0.3558, 0.8122, 0.4623);
const vec3 GX = vec3(0.9280, -0.3510, -0.1264);
const vec3 GY = vec3(0.0831, 0.4667, -0.8786);

// one shell of jittered cells projected onto the unit sphere
float starLayer(vec3 dir, float scale, float density, float psf) {
  vec3 p = dir * scale;
  vec3 cell = floor(p);
  float acc = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      for (int z = -1; z <= 1; z++) {
        vec3 c = cell + vec3(float(x), float(y), float(z));
        vec3 h = hash33(c);
        if (h.x > density) continue;
        vec3 sp = normalize(c + 0.5 + (h - 0.5) * 0.8);
        float d = length(dir - sp);
        float mag = pow(hash13(c + 7.7), 9.0);          // brightness distribution
        acc += mag * exp(-d * d / (psf * psf));
      }
    }
  }
  return acc;
}

vec3 sampleSky(vec3 dir, float psf) {
  // --- Milky Way band (galactic frame)
  vec3 gd = vec3(dot(dir, GX), dot(dir, GY), dot(dir, GZ));
  float band = exp(-gd.y * gd.y * 14.0);
  float clouds = fbm6(gd * vec3(3.2, 6.4, 3.2) + 2.0);
  float fine   = fbm(gd * 9.0 + 7.0);
  float dust   = fbm6(gd * vec3(4.5, 9.0, 4.5) + 13.0);
  float mw = band * (0.35 + 1.4 * pow(clouds, 2.0)) * (0.55 + 0.45 * fine);
  mw *= 0.35 + 0.65 * smoothstep(0.62, 0.18, dust);     // dark dust lanes
  float core = exp(-length(gd - vec3(0.92, 0.0, 0.39)) * 2.4);
  vec3 mwCol = mix(blackbody(7200.0), blackbody(4300.0), core * 0.85);
  vec3 col = mwCol * mw * 0.16 * uMilkyWay;

  // faint nebulosity
  col += mix(vec3(0.02, 0.03, 0.07), vec3(0.06, 0.04, 0.05), fine)
       * band * 0.05 * uMilkyWay;

  // --- stars (two shells: bright sparse + dim dense)
  psf = max(psf, 1e-4);
  float s1 = starLayer(dir, 26.0, 0.14 * uStarDensity, psf);
  float s2 = starLayer(dir, 54.0, 0.10 * uStarDensity, psf * 0.8);
  float t1 = mix(2600.0, 11500.0, pow(hash13(dir * 91.7), 3.0));
  vec3 starCol = blackbody(t1);
  col += starCol * (s1 * 5.0 + s2 * 1.1) * uStars;
  col += vec3(1.0) * pow(s2, 3.0) * 0.35 * uStars;       // few brilliant points
  return col;
}

// ------------------------------------------------------------ accretion disk
// Keplerian angular velocity (GM = rs/2 = 0.5), geometric units
float omegaK(float r) { return sqrt(0.5 / (r * r * r)); }

// flow-noise advection: two phase-offset fields blended so differential
// rotation never shears the pattern into infinitely thin streaks
float diskTurbulence(vec2 xz, float r, float t) {
  float w = omegaK(r) * uDiskSpeed;
  float T = 26.0;                                        // advect loop period
  float p0 = fract(t / T);
  float p1 = fract(t / T + 0.5);
  float blend = abs(p0 * 2.0 - 1.0);                     // triangle weight
  mat2 R0 = mat2(cos(-w * p0 * T), -sin(-w * p0 * T), sin(-w * p0 * T), cos(-w * p0 * T));
  mat2 R1 = mat2(cos(-w * p1 * T), -sin(-w * p1 * T), sin(-w * p1 * T), cos(-w * p1 * T));
  vec3 q0 = vec3(R0 * xz, r * 0.7) * uTurbScale;
  vec3 q1 = vec3(R1 * xz, r * 0.7) * uTurbScale;
  float n0 = fbm(q0 + vec3(0.0, 0.0, t * 0.02));
  float n1 = fbm(q1 + vec3(0.0, 0.0, t * 0.02));
  float base = mix(n0, n1, blend);
  float ridge = 1.0 - abs(2.0 * fbm(q0 * 1.7 + 4.0) - 1.0);
  float d = base * 0.72 + ridge * 0.28;
  return mix(0.62, d, clamp(uTurb, 0.0, 1.6) * 0.9 + 0.1);
}

// sample the disk at an equatorial crossing; returns rgb emission and alpha
void diskSample(vec3 pos, vec3 photonDir, out vec3 emission, out float alpha,
                out float gShift, out float gravFac) {
  float r = length(pos.xz);
  float edge = smoothstep(uDiskInner, uDiskInner * 1.14, r)
             * (1.0 - smoothstep(uDiskOuter * 0.72, uDiskOuter, r));
  float turb = diskTurbulence(pos.xz, r, uTime);
  float dens = clamp(turb * edge * uDiskDensity, 0.0, 1.0);
  alpha = clamp(dens * 0.92, 0.0, 1.0);

  // Shakura–Sunyaev temperature profile, normalised so the peak ≈ uDiskTemp
  float x = uDiskInner / r;
  float tprof = pow(x, 0.75) * pow(max(1.0 - sqrt(x), 0.02), 0.25);
  float tpeak = pow(4.0 / 3.0, 0.75) * pow(1.0 - sqrt(3.0 / 4.0), 0.25);
  float T = 1000.0 * uDiskTemp * tprof / tpeak;

  // --- relativistic shifts -------------------------------------------
  // local circular-orbit speed (static observer): v² = M/(r-2M), M=0.5
  // (= 0.5 c at the ISCO r=3, -> c at the photon sphere r=1.5)
  float v2 = 0.5 / max(r - 1.0, 0.06);
  float beta = clamp(sqrt(v2), 0.0, 0.995);
  // orbital velocity direction (counter-clockwise seen from +y)
  vec3 tangent = normalize(vec3(-pos.z, 0.0, pos.x));
  // photon propagation direction (emitter -> camera) is -photonDir
  vec3 dHat = -photonDir;
  // relativistic Doppler factor  δ = sqrt(1-β²)/(1-β·d̂)
  float dop = sqrt(1.0 - beta * beta) / max(1.0 - beta * dot(tangent, dHat), 1e-3);
  // gravitational: ν_o/ν_e = sqrt(1-rs/r_e) * uCamGrav
  gravFac = sqrt(max(1.0 - 1.0 / r, 0.0)) * uCamGrav;
  // beaming: intensity scales as dop^uDoppler (uDoppler: 0 none .. 4 bolometric)
  float g = mix(1.0, gravFac, uRedshift) * pow(dop, clamp(uDoppler, 0.0, 4.0));
  gShift = g;

  // observed temperature shifts; intensity beams as g^3 (photon count)
  float Tobs = T * g;
  float lum = pow(tprof / tpeak, 2.2);                    // radial luminosity falloff
  emission = blackbody(Tobs) * lum * pow(g, 3.0) * (0.35 + 1.3 * dens);
  emission *= 5.2;                                        // HDR headroom before bloom
}

// --------------------------------------------------------------- integrator
// RK4 step of x' = v, v' = -1.5 h² x / r⁵
void rk4(inout vec3 p, inout vec3 v, float h2, float dt) {
  vec3 a1 = -1.5 * h2 * p / pow(length(p), 5.0);
  vec3 p2 = p + v * (dt * 0.5);
  vec3 v2 = v + a1 * (dt * 0.5);
  vec3 a2 = -1.5 * h2 * p2 / pow(length(p2), 5.0);
  vec3 p3 = p + v2 * (dt * 0.5);
  vec3 v3 = v + a2 * (dt * 0.5);
  vec3 a3 = -1.5 * h2 * p3 / pow(length(p3), 5.0);
  vec3 p4 = p + v3 * dt;
  vec3 v4 = v + a3 * dt;
  vec3 a4 = -1.5 * h2 * p4 / pow(length(p4), 5.0);
  p += (dt / 6.0) * (v + 2.0 * v2 + 2.0 * v3 + v4);
  v += (dt / 6.0) * (a1 + 2.0 * a2 + 2.0 * a3 + a4);
}

vec3 viridis(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.267, 0.005, 0.329);
  vec3 c1 = vec3(0.128, 0.567, 0.551);
  vec3 c2 = vec3(0.993, 0.906, 0.144);
  vec3 lo = mix(c0, c1, t * 2.0);
  vec3 hi = mix(c1, c2, t * 2.0 - 1.0);
  return mix(lo, hi, step(0.5, t));
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  ndc.x *= uResolution.x / uResolution.y;
  vec3 dir = normalize(uCamRight * (ndc.x * uTanFov) + uCamUp * (ndc.y * uTanFov) + uCamFwd);

  vec3 p = uCamPos;
  vec3 v = dir;
  vec3 h = cross(p, v);
  float h2 = dot(h, h);

  vec3 col = vec3(0.0);
  float trans = 1.0;         // transmittance
  int crossings = 0;
  bool captured = false;
  bool escaped = false;
  float usedSteps = 0.0;
  float dbgDoppler = -1.0;
  float dbgGrav = -1.0;
  float dbgEmit = 0.0;
  float dbgTurb = -1.0;
  float deflection = 0.0;

  float psf = uStarSharp;

  for (int i = 0; i < MAX_STEPS; i++) {
    if (float(i) >= uSteps) break;
    float r = length(p);
    if (r <= RS) { captured = true; usedSteps = float(i); break; }
    if (r > R_SKY && dot(p, v) > 0.0) { escaped = true; usedSteps = float(i); break; }

    // adaptive step: proportional to r (fine near the photon sphere),
    // clamped when skimming the disk plane for exact crossing interpolation
    float dt = clamp(0.05 * r, 0.04, 1.0);
    float ay = abs(p.y);
    if (r < uDiskOuter + 2.0 && ay < 0.6) dt = min(dt, 0.05 + 0.5 * ay);

    vec3 pPrev = p;
    rk4(p, v, h2, dt);

    // --- equatorial plane crossing → disk sampling
    if (pPrev.y * p.y < 0.0 && crossings < MAX_CROSS && trans > 0.004) {
      float t = pPrev.y / (pPrev.y - p.y);
      vec3 c = mix(pPrev, p, t);
      float rc = length(c.xz);
      if (rc > uDiskInner * 0.98 && rc < uDiskOuter) {
        vec3 e; float a; float g; float gv;
        vec3 photonDir = normalize(v);
        diskSample(c, photonDir, e, a, g, gv);
        if (uDebug != 6 && uDebug != 9) {
          col += trans * e * a;
          trans *= (1.0 - a);
        }
        crossings++;
        // store factors of the first (front) crossing for debug views
        if (crossings == 1) {
          dbgDoppler = g; dbgGrav = gv;
          dbgEmit = dot(e, vec3(0.299, 0.587, 0.114));
          dbgTurb = a;
        }
      }
    }
  }

  // background (lensed starfield) or event-horizon black
  if (!captured) {
    vec3 d = normalize(v);
    vec3 sky = sampleSky(d, psf);
    if (!escaped) sky *= 0.35;   // step-starved rays: dim fallback rather than black
    col += trans * sky;
  }
  deflection = acos(clamp(dot(dir, normalize(v)), -1.0, 1.0));

  // ------------------------------------------------------- debug views
  if (uDebug == 1) {
    col = viridis(usedSteps / uSteps);
  } else if (uDebug == 2) {
    col = mix(vec3(0.02), viridis(float(crossings) / float(MAX_CROSS)), step(0.5, float(crossings)));
  } else if (uDebug == 3) {
    col = mix(vec3(0.02), viridis((dbgDoppler - 0.4) / 1.6), step(0.0, dbgDoppler));
  } else if (uDebug == 4) {
    col = mix(vec3(0.02), viridis(dbgGrav), step(0.0, dbgGrav));
  } else if (uDebug == 5) {
    col = vec3(0.0);
    if (dbgEmit > 0.0) col = viridis(log2(1.0 + dbgEmit) / 6.0);
  } else if (uDebug == 6) {
    // starfield-only already produced above (disk skipped); keep as is
  } else if (uDebug == 8) {
    col = viridis(deflection / PI);
  } else if (uDebug == 9) {
    float r = dbgTurb; // alpha carries turbulence density of front crossing
    col = mix(vec3(0.03), viridis(r), step(0.0, r));
  }

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;
