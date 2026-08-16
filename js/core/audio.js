// GARGANTUA - procedural ambient score (no audio files: everything is
// synthesised with WebAudio: deep detuned drones + filtered noise "solar
// wind" + sparse sub-bass chimes). Starts only after a user gesture.

export class Ambient {
  constructor() {
    this.ctx = null;
    this.on = false;
    this._nodes = [];
    this._chimeTimer = 0;
  }

  get context() { return this.ctx; }

  toggle() {
    if (this.on) { this.stop(); return false; }
    this.start();
    return this.on;
  }

  start() {
    if (this.on) return;
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.ctx;
      if (ctx.state === 'suspended') ctx.resume();

      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 6;
      comp.connect(master);

      // --- drone: two detuned sines + soft triangle octave
      const mk = (freq, gain, type = 'sine') => {
        const o = ctx.createOscillator();
        o.type = type; o.frequency.value = freq;
        const g = ctx.createGain(); g.gain.value = gain;
        o.connect(g); g.connect(comp); o.start();
        this._nodes.push(o, g);
        return { o, g };
      };
      const d1 = mk(34.5, 0.42);
      const d2 = mk(51.9, 0.22);
      const d3 = mk(69.1, 0.05, 'triangle');
      // slow detune drift so the drone breathes
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.06;
      const lfoG = ctx.createGain(); lfoG.gain.value = 1.8;
      lfo.connect(lfoG); lfoG.connect(d2.o.detune); lfo.start();
      this._nodes.push(lfo, lfoG);

      // --- solar wind: brown-ish noise through a slow sweeping bandpass
      const len = ctx.sampleRate * 4;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.2;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf; noise.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 160; bp.Q.value = 0.7;
      const nGain = ctx.createGain(); nGain.gain.value = 0.16;
      const sweep = ctx.createOscillator();
      sweep.frequency.value = 0.017;
      const sweepG = ctx.createGain(); sweepG.gain.value = 110;
      sweep.connect(sweepG); sweepG.connect(bp.frequency); sweep.start();
      noise.connect(bp); bp.connect(nGain); nGain.connect(comp); noise.start();
      this._nodes.push(noise, bp, nGain, sweep, sweepG);

      this.master = master;
      master.gain.setTargetAtTime(0.32, ctx.currentTime, 2.2);
      this.on = true;
      this._chimeTimer = 6;
    } catch (e) {
      this.on = false;
    }
  }

  /** sparse sub chimes; call every frame */
  tick(dt) {
    if (!this.on || !this.ctx) return;
    this._chimeTimer -= dt;
    if (this._chimeTimer > 0) return;
    this._chimeTimer = 14 + Math.random() * 18;
    try {
      const ctx = this.ctx;
      const notes = [55, 65.4, 73.4, 82.4, 98];
      const f = notes[(Math.random() * notes.length) | 0];
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine'; o2.frequency.value = f * 2.004;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.10, ctx.currentTime + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 9);
      o.connect(g); o2.connect(g); g.connect(this.master ?? ctx.destination);
      o.start(); o2.start();
      o.stop(ctx.currentTime + 9.5); o2.stop(ctx.currentTime + 9.5);
    } catch { /* chime is decoration */ }
  }

  stop() {
    if (!this.on) return;
    try {
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime(0, t, 0.5);
      const nodes = this._nodes;
      setTimeout(() => nodes.forEach(n => { try { n.stop?.(); n.disconnect?.(); } catch {} }), 1600);
    } catch { /* already gone */ }
    this._nodes = [];
    this.on = false;
  }
}
