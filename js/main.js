// GARGANTUA - application orchestrator: boot, frame loop, screenshots,
// context-loss recovery, URL automation, window.GARGANTUA API.

import { Engine, QUALITY } from './core/engine.js';
import { CameraRig, PRESETS } from './core/camera.js';
import { Ambient } from './core/audio.js';
import { Hud } from './core/hud.js';
import { Input } from './core/input.js';
import { defaultParams, sanitizeParams, sanitizeQuality, sanitizeDebug } from './core/params.js';
import { loadState, saveState, debouncedSave, parseURL } from './core/state.js';

const VERSION = '1.0.0';

class App {
  constructor() {
    // ---- state resolution: URL overrides > localStorage > defaults
    const { config, paramOverrides } = parseURL(window.location.search);
    const persisted = config.reset ? null : loadState();
    this.params = sanitizeParams({ ...(persisted?.params ?? {}), ...paramOverrides });
    this.quality = config.quality ?? persisted?.quality ?? 'high';
    this.debug = config.debug ?? persisted?.debug ?? 0;
    this.viewIndex = config.view ?? persisted?.view ?? 0;
    this.cinematic = config.view !== undefined ? false : (persisted?.cinematic ?? true);
    this.paused = false;
    this.simTime = config.fixedTime ?? 4.0;
    this.fixedTime = config.fixedTime ?? null;
    this.config = config;

    this.container = document.getElementById('app');
    this.canvas = null;
    this.engine = null;
    this.rig = null;
    this.persisted = persisted;
    this.audio = new Ambient();
    this.frameNo = 0;
    this.fps = 60; this.ms = 16;
    this._fpsAccum = 0; this._fpsFrames = 0; this._lastHud = 0;
    this._lowFpsSince = 0; this._autoDropped = false;
    this._pendingShot = null;
    this._shotDone = false;
    this._running = false;
    this._lastT = 0;

    this._persist = debouncedSave(400, () => this._saveNow());
    this._buildUi();
    this._bootEngine();
    this._wireInput();

    window.addEventListener('resize', () => this.engine?.resize());
    document.addEventListener('visibilitychange', () => { this._lastT = 0; });

    this._exposeApi();
    this._startLoop();
  }

  // ------------------------------------------------------------ engine boot
  _bootEngine() {
    try {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'gl';
      this.container.appendChild(this.canvas);
      this.engine = new Engine(this.canvas);
      this.engine.setQuality(this.quality);
      // controls bind to the canvas itself; re-attached after GPU recovery
      this.rig = new CameraRig(this.canvas, this.params);
      this.rig.onUserInteract = () => {
        if (this.cinematic) { this.cinematic = false; this.hud.setCineActive(false); this._persist(); }
      };
      this.rig.setPreset(this.viewIndex, true);
      if (this.cinematic) this.rig.startCinematic();

      this.canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this._stopLoop();
        this.hud.showOverlay('<div class="ov-title">GPU CONTEXT LOST</div><div class="ov-sub">recovering renderer…</div>');
      }, false);
      this.canvas.addEventListener('webglcontextrestored', () => this._recover(), false);
    } catch (err) {
      this._fatal(err);
    }
  }

  _recover() {
    // Rebuild the whole GPU stack on the same (now restored) canvas.
    try {
      this.engine?.dispose(false);        // keep the restored context alive
      this.engine = new Engine(this.canvas);
      this.engine.setQuality(this.quality);
      this.rig?.attachControls(this.canvas);
      this._autoDropped = false;
      this.hud.hideOverlay();
      this.hud.toast('GPU context recovered');
      this._startLoop();
    } catch (err) {
      this._fatal(err);
    }
  }

  _fatal(err) {
    console.error('[gargantua] fatal:', err);
    this.hud.showOverlay(`
      <div class="ov-title">RENDERER UNAVAILABLE</div>
      <div class="ov-sub">${String(err?.message ?? err).replace(/</g, '&lt;')}</div>
      <div class="ov-sub dim">GARGANTUA needs WebGL2. Try another browser or enable hardware acceleration.</div>`);
    this._stopLoop();
  }

  // ------------------------------------------------------------------- UI
  _buildUi() {
    this.hud = new Hud(this.container, {
      onParam: (k, v) => { this.params[k] = v; this._persist(); },
      onPreset: (i) => this.setView(i),
      hud: () => this.toggleHud(),
      panel: () => this.togglePanel(),
      cine: () => this.toggleCinematic(),
      audio: () => this.toggleAudio(),
      shot: () => this.requestShot(),
      help: () => this.hud.toggleHelp(),
    });
    this.hud.setParams(this.params);
    this.hud.setVisible(!this.config.hideui);
    this.hud.setPanel(!this.config.hideui && (this.persisted?.panelOpen ?? false));
    if (this.config.hideui) this.hud.setPanel(false);
    this.hud.setCineActive(this.cinematic);
  }

  _wireInput() {
    this.input = new Input({
      setDebug: (n) => { this.debug = n; this._persist(); },
      setPreset: (i) => this.setView(i),
      cyclePreset: (d) => this.setView(this.rig.viewIndex + d),
      toggleCinematic: () => this.toggleCinematic(),
      togglePause: () => { this.paused = !this.paused; this.hud.toast(this.paused ? 'TIME FROZEN' : 'TIME RESUMED'); },
      togglePanel: () => this.togglePanel(),
      toggleHud: () => this.toggleHud(),
      toggleAudio: () => this.toggleAudio(),
      screenshot: () => this.requestShot(),
      toggleFullscreen: () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.();
      },
      resetParams: () => this.resetParams(),
      setQuality: (q) => this.setQuality(q),
      toggleHelp: () => this.hud.toggleHelp(),
      escape: () => { this.hud.toggleHelp(false); this.hud.setPanel(false); },
    });
  }

  // ------------------------------------------------------------- actions
  setView(i) {
    this.viewIndex = ((i % 4) + 4) % 4;
    this.rig.setPreset(this.viewIndex);
    this.cinematic = false;
    this.hud.setCineActive(false);
    this.hud.toast(`VIEW ${this.viewIndex + 1} · ${PRESETS[this.viewIndex].name}`);
    this._persist();
  }
  toggleCinematic() {
    this.cinematic = !this.cinematic;
    if (this.cinematic) this.rig.startCinematic();
    this.hud.setCineActive(this.cinematic);
    this.hud.toast(this.cinematic ? 'CINEMATIC CAMERA' : 'FREE ORBIT');
    this._persist();
  }
  togglePanel() { this.hud.setPanel(!this.hud.panelOpen); this._persist(); }
  toggleHud() { this.hud.setVisible(!this.hud.visible); this._persist(); }
  toggleAudio() {
    const on = this.audio.toggle();
    this.hud.setAudioActive(on);
    this.hud.toast(on ? 'AMBIENT SCORE ON' : 'AMBIENT SCORE OFF');
  }
  setQuality(q) {
    this.quality = this.engine.setQuality(sanitizeQuality(q));
    this._autoDropped = this.quality === 'standard' ? this._autoDropped : false;
    this.hud.toast(`QUALITY ${QUALITY[this.quality].label}`);
    this._persist();
  }
  resetParams() {
    this.params = defaultParams();
    this.hud.setParams(this.params);
    this.hud.toast('PARAMETERS RESET');
    this._persist();
  }
  setParam(k, v) {
    const clean = sanitizeParams({ [k]: v });
    if (clean[k] === undefined) return false;
    this.params[k] = clean[k];
    this.hud.setParams(this.params);
    this._persist();
    return true;
  }

  requestShot() {
    this._pendingShot = { download: !this.config.noDownload, when: this.frameNo + 1 };
  }

  _captureFrame(download) {
    const src = this.engine.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const dataUrl = c.toDataURL('image/png');
    window.__GARGANTUA_SHOT__ = dataUrl;
    if (download) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `gargantua_${Date.now()}.png`;
      a.click();
      this.hud.toast('SCREENSHOT SAVED');
    }
    return dataUrl;
  }

  // ---------------------------------------------------------------- loop
  _startLoop() {
    if (this._running) return;
    this._running = true;
    this._lastT = 0;
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }
  _stopLoop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  _frame(tMs) {
    if (!this._running) return;
    this._raf = requestAnimationFrame((t) => this._frame(t));
    if (document.hidden) { this._lastT = 0; return; }
    if (!this.engine || !this.rig) return;   // boot failed -> overlay is up

    const t = tMs / 1000;
    let dt = this._lastT ? Math.min(t - this._lastT, 0.1) : 0.016;
    this._lastT = t;

    // fixed disk time for reproducible automation shots
    if (this.fixedTime === null && !this.paused) this.simTime += dt * this.params.timeScale;

    const basis = this.rig.update(dt);
    this.audio.tick(dt);

    this.engine.render({
      time: this.simTime,
      cam: basis,
      params: this.params,
      debug: this.debug,
    });

    // ---- fps accounting
    this._fpsAccum += dt; this._fpsFrames++;
    this.ms = dt * 1000;
    if (this._fpsAccum > 0.25) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0; this._fpsFrames = 0;
    }

    // ---- auto quality guard (once, never during automated shots)
    if (!this.config.shot && !this._autoDropped && this.frameNo > 90 &&
        this.quality !== 'standard' && this.fps < 22) {
      this._lowFpsSince += dt;
      if (this._lowFpsSince > 4) {
        this._autoDropped = true;
        this.setQuality(this.quality === 'cinematic' ? 'high' : 'standard');
        this.hud.toast('AUTO QUALITY: performance guard engaged');
      }
    } else {
      this._lowFpsSince = 0;
    }

    // ---- HUD refresh @4Hz
    if (t - this._lastHud > 0.25) {
      this._lastHud = t;
      const q = QUALITY[this.quality];
      this.hud.update({
        fps: this.fps, ms: this.ms,
        width: this.engine.renderSize.x, height: this.engine.renderSize.y,
        scale: (this.engine.quality.renderScale * Math.min(devicePixelRatio, q.dprCap)),
        hdr: this.engine.hdr, quality: this.quality, steps: q.steps,
        cinematic: this.cinematic, paused: this.paused,
        viewIndex: this.rig.viewIndex, viewName: PRESETS[this.rig.viewIndex].name,
        debug: this.debug,
      });
    }

    this.frameNo++;

    // ---- screenshot (same-task capture right after render)
    if (this._pendingShot && this.frameNo >= this._pendingShot.when) {
      const { download } = this._pendingShot;
      this._pendingShot = null;
      this._captureFrame(download);
    }

    // ---- URL automation: shot after warm-up frames
    if (this.config.shot && !this._shotDone && this.frameNo >= this.config.frames) {
      this._shotDone = true;
      const url = this._captureFrame(!this.config.noDownload);
      window.__GARGANTUA_READY__ = true;
      const payload = {
        type: 'gargantua-shot-ready',
        frames: this.frameNo,
        width: this.engine.renderer.domElement.width,
        height: this.engine.renderer.domElement.height,
        bytes: url.length,
        quality: this.quality,
        debug: this.debug,
        params: { ...this.params },
      };
      console.log('[gargantua]', JSON.stringify(payload));
      this._resolveReady?.(payload);
    }
  }

  // ------------------------------------------------------------ plumbing
  _saveNow() {
    saveState({
      params: this.params, quality: this.quality, debug: this.debug,
      view: this.viewIndex, hudVisible: this.hud.visible,
      panelOpen: this.hud.panelOpen, cinematic: this.cinematic,
    });
  }

  _exposeApi() {
    const app = this;
    window.GARGANTUA = {
      version: VERSION,
      ready: new Promise((res) => { app._resolveReady = res; if (app.config.shot) return; res({ type: 'gargantua-ready' }); }),
      get params() { return { ...app.params }; },
      get quality() { return app.quality; },
      get debug() { return app.debug; },
      setParam: (k, v) => app.setParam(k, v),
      setQuality: (q) => app.setQuality(q),
      setView: (i) => app.setView(i),
      setDebug: (n) => { app.debug = sanitizeDebug(n); app._persist(); },
      screenshot: (download = true) => { app._pendingShot = { download, when: app.frameNo + 1 }; },
      reset: () => app.resetParams(),
    };
  }
}

// boot ------------------------------------------------------------------
window.addEventListener('error', (e) => {
  const app = window.__APP__;
  if (app && !app.hud.el.overlay.classList.contains('hidden')) return;
  if (app) app.hud.showOverlay(`<div class="ov-title">RUNTIME ERROR</div><div class="ov-sub">${String(e.message).replace(/</g, '&lt;')}</div>`);
});

try {
  window.__APP__ = new App();
} catch (err) {
  document.getElementById('app').insertAdjacentHTML('beforeend',
    `<div class="overlay"><div class="overlay-card"><div class="ov-title">BOOT FAILURE</div>
     <div class="ov-sub">${String(err?.message ?? err).replace(/</g, '&lt;')}</div></div></div>`);
}
