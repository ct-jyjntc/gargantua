// GARGANTUA - HUD / toolbar / 21-parameter panel / help / toasts / overlays.
// All DOM is built here so index.html stays a shell.

import { PARAMS, PARAM_GROUPS } from './params.js';
import { PRESETS } from './camera.js';

export const DEBUG_NAMES = [
  'FINAL COMPOSITE', 'STEP COUNT', 'DISK CROSSINGS', 'DOPPLER g', 'GRAV. SHIFT',
  'DISK EMISSION', 'STARFIELD', 'BLOOM BUFFER', 'DEFLECTION', 'TURBULENCE',
];

const ICONS = {
  hud: 'HUD', panel: 'PARAMS', cine: 'CINE', audio: 'AUDIO', shot: 'SHOT', help: '?',
};

export class Hud {
  constructor(root, callbacks) {
    this.cb = callbacks;
    this.visible = true;
    this.panelOpen = false;
    this.helpOpen = false;
    this._sliders = new Map();
    this._build(root);
  }

  _build(root) {
    root.insertAdjacentHTML('beforeend', `
<div id="hud" class="hud">
  <div class="hud-title">GARGANTUA</div>
  <div class="hud-sub">SCHWARZSCHILD RAYTRACER</div>
  <div class="hud-rows">
    <div class="hud-row"><span id="hud-fps">-- FPS</span><span id="hud-ms"></span></div>
    <div class="hud-row dim" id="hud-res"></div>
    <div class="hud-row dim" id="hud-quality"></div>
    <div class="hud-row dim" id="hud-mode"></div>
    <div class="hud-row dim" id="hud-view"></div>
    <div class="hud-row dim" id="hud-debug"></div>
  </div>
</div>
<div id="toolbar"></div>
<div id="panel" class="panel"></div>
<div id="hints" class="hints">drag&nbsp;orbit&nbsp;·&nbsp;wheel&nbsp;zoom&nbsp;·&nbsp;<b>0–9</b>&nbsp;debug&nbsp;·&nbsp;<b>⇧1–4</b>&nbsp;views&nbsp;·&nbsp;<b>C</b>&nbsp;cinematic&nbsp;·&nbsp;<b>P</b>&nbsp;params&nbsp;·&nbsp;<b>?</b>&nbsp;help</div>
<div id="toast" class="toast"></div>
<div id="help" class="help hidden">
  <div class="help-card">
    <div class="help-title">KEYBOARD</div>
    <table>
      <tr><td>0 – 9</td><td>debug views (final, steps, crossings, doppler, grav, emission, stars, bloom, deflection, turbulence)</td></tr>
      <tr><td>⇧ 1 – 4</td><td>camera presets · voyager / interstellar / polar / photon ring</td></tr>
      <tr><td>[ / ]</td><td>cycle camera presets</td></tr>
      <tr><td>C</td><td>cinematic camera loop on/off</td></tr>
      <tr><td>Space</td><td>freeze / resume disk time</td></tr>
      <tr><td>P</td><td>parameter panel</td></tr>
      <tr><td>H</td><td>toggle HUD</td></tr>
      <tr><td>M</td><td>ambient score on/off</td></tr>
      <tr><td>S</td><td>screenshot (PNG)</td></tr>
      <tr><td>F</td><td>fullscreen</td></tr>
      <tr><td>R</td><td>reset parameters</td></tr>
      <tr><td>Q / W / E</td><td>quality · standard / high / cinematic</td></tr>
      <tr><td>Esc</td><td>close help / panel</td></tr>
    </table>
  </div>
</div>
<div id="overlay" class="overlay hidden"><div class="overlay-card" id="overlay-card"></div></div>`);

    this.el = {
      hud: document.getElementById('hud'),
      toolbar: document.getElementById('toolbar'),
      panel: document.getElementById('panel'),
      hints: document.getElementById('hints'),
      toast: document.getElementById('toast'),
      help: document.getElementById('help'),
      overlay: document.getElementById('overlay'),
      overlayCard: document.getElementById('overlay-card'),
      fps: document.getElementById('hud-fps'),
      ms: document.getElementById('hud-ms'),
      res: document.getElementById('hud-res'),
      quality: document.getElementById('hud-quality'),
      mode: document.getElementById('hud-mode'),
      view: document.getElementById('hud-view'),
      debug: document.getElementById('hud-debug'),
    };

    // toolbar buttons
    for (const [id, label] of Object.entries(ICONS)) {
      const b = document.createElement('button');
      b.className = 'tb-btn';
      b.id = `tb-${id}`;
      b.textContent = label;
      b.title = { hud: 'Toggle HUD (H)', panel: 'Parameters (P)', cine: 'Cinematic camera (C)',
                  audio: 'Ambient score (M)', shot: 'Screenshot (S)', help: 'Help (?)' }[id];
      b.addEventListener('click', () => this.cb[id]?.());
      this.el.toolbar.appendChild(b);
    }

    // ---- parameter panel
    const groups = {};
    for (const g of PARAM_GROUPS) {
      const sec = document.createElement('div');
      sec.className = 'panel-group';
      sec.innerHTML = `<div class="panel-group-title">${g}</div>`;
      groups[g] = sec;
      this.el.panel.appendChild(sec);
    }
    for (const p of PARAMS) {
      const row = document.createElement('label');
      row.className = 'prow';
      row.innerHTML = `
        <span class="plabel">${p.label}</span>
        <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.def}">
        <span class="pval">${p.fmt(p.def)}</span>`;
      const input = row.querySelector('input');
      const val = row.querySelector('.pval');
      input.addEventListener('input', () => {
        const v = Number(input.value);
        val.textContent = p.fmt(v);
        this.cb.onParam?.(p.key, v);
      });
      groups[p.group].appendChild(row);
      this._sliders.set(p.key, { input, val, fmt: p.fmt });
    }

    // preset buttons
    const presetSec = document.createElement('div');
    presetSec.className = 'panel-group';
    presetSec.innerHTML = `<div class="panel-group-title">VIEW PRESETS</div>`;
    PRESETS.forEach((pr, i) => {
      const b = document.createElement('button');
      b.className = 'preset-btn';
      b.textContent = `${i + 1} · ${pr.name}`;
      b.addEventListener('click', () => this.cb.onPreset?.(i));
      presetSec.appendChild(b);
    });
    this.el.panel.appendChild(presetSec);

    // keep orbit controls idle while interacting with UI surfaces
    for (const el of [this.el.toolbar, this.el.panel, this.el.help]) {
      for (const ev of ['pointerdown', 'wheel', 'contextmenu']) {
        el.addEventListener(ev, (e) => e.stopPropagation());
      }
    }

    // help close
    this.el.help.addEventListener('click', () => this.toggleHelp(false));
    this.setPanel(this.panelOpen);
  }

  setParams(params) {
    for (const [key, s] of this._sliders) {
      s.input.value = params[key];
      s.val.textContent = s.fmt(params[key]);
    }
  }

  setPanel(open) {
    this.panelOpen = open;
    this.el.panel.classList.toggle('open', open);
    document.getElementById('tb-panel')?.classList.toggle('active', open);
  }

  setVisible(v) {
    this.visible = v;
    this.el.hud.classList.toggle('hidden', !v);
    this.el.hints.classList.toggle('hidden', !v);
  }

  toggleHelp(force) {
    this.helpOpen = force !== undefined ? force : !this.helpOpen;
    this.el.help.classList.toggle('hidden', !this.helpOpen);
  }

  setAudioActive(on) {
    document.getElementById('tb-audio')?.classList.toggle('active', on);
  }
  setCineActive(on) {
    document.getElementById('tb-cine')?.classList.toggle('active', on);
  }

  toast(msg, ms = 2200) {
    this.el.toast.textContent = msg;
    this.el.toast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.el.toast.classList.remove('show'), ms);
  }

  showOverlay(html) {
    this.el.overlayCard.innerHTML = html;
    this.el.overlay.classList.remove('hidden');
  }
  hideOverlay() {
    this.el.overlay.classList.add('hidden');
  }

  update(info) {
    if (!this.visible) return;
    this.el.fps.textContent = `${info.fps.toFixed(0)} FPS`;
    this.el.ms.textContent = `${info.ms.toFixed(1)} ms`;
    this.el.res.textContent = `${info.width}×${info.height} ×${info.scale.toFixed(2)}${info.hdr ? ' HDR' : ' LDR'}`;
    this.el.quality.textContent = `QUALITY ${info.quality.toUpperCase()} · ${info.steps} STEPS`;
    this.el.mode.textContent = info.paused ? 'TIME FROZEN' : (info.cinematic ? 'CINEMATIC CAM' : 'FREE ORBIT');
    this.el.view.textContent = `VIEW ${info.viewIndex + 1} · ${info.viewName}`;
    this.el.debug.textContent = info.debug === 0 ? 'DEBUG OFF' : `DEBUG ${info.debug} · ${DEBUG_NAMES[info.debug]}`;
  }
}
