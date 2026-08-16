// GARGANTUA - camera rig: OrbitControls (free flight) + cinematic keyframed
// loop + 4 director presets. Output basis vectors feed the raytracer directly.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const PRESETS = [
  { name: 'VOYAGER',       r: 15.5, el: 9,   az: -38, fov: 58 },
  { name: 'INTERSTELLAR',  r: 7.4,  el: 2.5, az: 196, fov: 64 },
  { name: 'POLAR',         r: 13.5, el: 64,  az: 120, fov: 56 },
  { name: 'PHOTON RING',   r: 4.1,  el: 8,   az: 150, fov: 84 },
];

const DEG = Math.PI / 180;

// cinematic loop keyframes (spherical + fov + roll), ~96 s cycle
const KEYS = [
  { t: 0.00, r: 16.0, el: 10, az: -40, fov: 57, roll: 0 },
  { t: 0.14, r: 12.0, el: 4,  az: 25,  fov: 60, roll: 2.0 },
  { t: 0.28, r: 8.0,  el: 1.2,az: 92,  fov: 65, roll: -2.5 },
  { t: 0.40, r: 6.4,  el: 16, az: 148, fov: 62, roll: 1.5 },
  { t: 0.52, r: 10.0, el: 46, az: 205, fov: 55, roll: -1.0 },
  { t: 0.66, r: 14.5, el: 24, az: 262, fov: 54, roll: 0.5 },
  { t: 0.80, r: 9.0,  el: 3,  az: 318, fov: 62, roll: -2.0 },
  { t: 1.00, r: 16.0, el: 10, az: 320 - 360, fov: 57, roll: 0 },
];
const CYCLE = 96; // seconds

function catmull(p0, p1, p2, p3, u) {
  return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
}

function evalCinematic(t) {
  const tc = (t / CYCLE) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t < tc) i++;
  const k0 = KEYS[Math.max(0, i - 1)], k1 = KEYS[i], k2 = KEYS[i + 1], k3 = KEYS[Math.min(KEYS.length - 1, i + 2)];
  const span = (k2.t - k1.t) || 1;
  const u = (tc - k1.t) / span;
  return {
    r: catmull(k0.r, k1.r, k2.r, k3.r, u),
    el: catmull(k0.el, k1.el, k2.el, k3.el, u),
    az: catmull(k0.az, k1.az, k2.az, k3.az, u),
    fov: catmull(k0.fov, k1.fov, k2.fov, k3.fov, u),
    roll: catmull(k0.roll, k1.roll, k2.roll, k3.roll, u),
  };
}

export class CameraRig {
  constructor(domElement, params) {
    this.params = params;               // live reference (fov lives here)
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 200);
    this.mode = 'cinematic';            // 'cinematic' | 'orbit'
    this.cineTime = 12;
    this.viewIndex = 0;
    this._basis = { pos: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3() };
    this._transition = null;

    this._attach(domElement);
    this.setPreset(0, true);
  }

  /** (re)bind orbit controls to an interaction surface (canvas swaps on GPU recovery) */
  _attach(domElement) {
    this.controls?.dispose();
    this.domElement = domElement;
    const controls = new OrbitControls(this.camera, domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 2.15;
    controls.maxDistance = 38;
    controls.addEventListener('start', () => { this.mode = 'orbit'; this._transition = null; this.onUserInteract?.(); });
    this.controls = controls;
  }

  attachControls(domElement) { this._attach(domElement); this.controls.update(); }

  sphericalToPos(r, el, az, out = new THREE.Vector3()) {
    const e = el * DEG, a = az * DEG;
    return out.set(r * Math.cos(e) * Math.cos(a), r * Math.sin(e), r * Math.cos(e) * Math.sin(a));
  }

  _curSpherical() {
    const p = this.camera.position;
    const r = p.length();
    return { r, el: Math.asin(p.y / r) / DEG, az: Math.atan2(p.z, p.x) / DEG, fov: this.params.fov };
  }

  setPreset(i, immediate = false) {
    this.viewIndex = ((i % PRESETS.length) + PRESETS.length) % PRESETS.length;
    const target = { ...PRESETS[this.viewIndex], fov: this.params.fov };
    if (immediate) {
      this.sphericalToPos(target.r, target.el, target.az, this.camera.position);
      this.camera.lookAt(0, 0, 0);
      this._transition = null;
    } else {
      // normalise azimuth for shortest path
      const cur = this._curSpherical();
      let dAz = ((target.az - cur.az + 540) % 360) - 180;
      target.az = cur.az + dAz;
      this._transition = { from: cur, to: target, t: 0, dur: 1.6 };
    }
    this.mode = 'orbit';
    this.controls.update();
  }

  startCinematic() {
    this.mode = 'cinematic';
    this._transition = null;
  }

  update(dt) {
    // user-driven fov persists across cinematic: cinematic uses its own fov,
    // orbit uses the FOV parameter.
    if (this._transition) {
      const tr = this._transition;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const e = tr.t < 0.5 ? 4 * tr.t ** 3 : 1 - (-2 * tr.t + 2) ** 3 / 2; // easeInOutCubic
      const { from, to } = tr;
      this.sphericalToPos(
        from.r + (to.r - from.r) * e,
        from.el + (to.el - from.el) * e,
        from.az + (to.az - from.az) * e,
        this.camera.position,
      );
      this.camera.lookAt(0, 0, 0);
      if (tr.t >= 1) this._transition = null;
    } else if (this.mode === 'cinematic') {
      this.cineTime += dt;
      const k = evalCinematic(this.cineTime);
      // subtle handheld drift
      const t = this.cineTime;
      const drift = Math.sin(t * 0.31) * 0.6 + Math.sin(t * 0.83 + 1.7) * 0.35;
      this.sphericalToPos(k.r, k.el + drift * 0.4, k.az, this.camera.position);
      this._cineFov = k.fov;
      this._cineRoll = k.roll + drift * 0.12;
    } else {
      this.controls.update();
    }

    // ---- derive world-space basis with roll
    const pos = this.camera.position;
    const fwd = this._basis.fwd.copy(pos).multiplyScalar(-1).normalize();
    const upWorld = Math.abs(fwd.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = this._basis.right.crossVectors(upWorld, fwd).normalize();
    const up = this._basis.up.crossVectors(fwd, right).normalize();

    const fovDeg = this.mode === 'cinematic' ? (this._cineFov ?? 58) : this.params.fov;
    const roll = this.mode === 'cinematic' ? (this._cineRoll ?? 0) : 0;
    if (roll !== 0) {
      const cr = Math.cos(roll * DEG), sr = Math.sin(roll * DEG);
      const r2 = right.clone().multiplyScalar(cr).addScaledVector(up, sr).normalize();
      const u2 = up.clone().multiplyScalar(cr).addScaledVector(right, -sr).normalize();
      right.copy(r2); up.copy(u2);
    }

    const r = pos.length();
    this._basis.pos.copy(pos);
    this._basis.camGrav = 1 / Math.sqrt(Math.max(1 - 1 / Math.max(r, 1.05), 1e-4));
    this._basis.fovRad = fovDeg * DEG;
    return this._basis;
  }

  dispose() {
    this.controls.dispose();
  }
}
