// GARGANTUA - render engine: fullscreen-quad raytracer pass + HDR bloom chain
// + composite. Raw Three.js (no EffectComposer): every pass is explicit so
// quality tiers and context recovery stay fully under our control.

import * as THREE from 'three';
import { blackholeVert, blackholeFrag } from '../shaders/blackhole.glsl.js';
import { quadVert, brightFrag, downFrag, upFrag, compositeFrag } from '../shaders/post.glsl.js';

export const QUALITY = {
  standard:  { label: 'STANDARD',  renderScale: 0.72, dprCap: 1.5, steps: 280, bloomMips: 4 },
  high:      { label: 'HIGH',      renderScale: 1.0,  dprCap: 2.0, steps: 380, bloomMips: 5 },
  cinematic: { label: 'CINEMATIC', renderScale: 1.15, dprCap: 2.0, steps: 520, bloomMips: 6 },
};

const RT_OPTS = { depthBuffer: false, stencilBuffer: false };

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.qualityName = 'high';
    this.renderSize = new THREE.Vector2(1, 1);
    this.disposed = false;
    this._build();
  }

  _build() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.autoClear = false;
    this.renderer.debug.checkShaderErrors = true;

    if (!this.renderer.capabilities.isWebGL2) {
      throw new Error('WebGL2 not available - GARGANTUA requires a WebGL2 context');
    }
    // HDR render targets need a float-renderable format
    this.hdr = !!this.renderer.extensions.get('EXT_color_buffer_float');
    this.rtType = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;   // fullscreen quad sits on the near plane
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._buildMaterials();
    this.setQuality(this.qualityName);
  }

  _buildMaterials() {
    this.sceneMat = new THREE.ShaderMaterial({
      vertexShader: blackholeVert,
      fragmentShader: blackholeFrag,
      depthTest: false, depthWrite: false,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uCamPos: { value: new THREE.Vector3(0, 1, 15) },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) },
        uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
        uTanFov: { value: 0.6 },
        uCamGrav: { value: 1 },
        uDiskInner: { value: 3 }, uDiskOuter: { value: 13 },
        uDiskDensity: { value: 1 }, uDiskTemp: { value: 5.6 }, uDiskSpeed: { value: 1 },
        uTurb: { value: 1 }, uTurbScale: { value: 2.2 },
        uDoppler: { value: 3 }, uRedshift: { value: 1 },
        uStars: { value: 1 }, uStarDensity: { value: 1 }, uMilkyWay: { value: 1 },
        uStarSharp: { value: 0.002 },
        uSteps: { value: 330 },
        uDebug: { value: 0 },
      },
    });

    this.brightMat = new THREE.ShaderMaterial({
      vertexShader: quadVert, fragmentShader: brightFrag,
      depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: 0.6 } },
    });
    this.downMat = new THREE.ShaderMaterial({
      vertexShader: quadVert, fragmentShader: downFrag,
      depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    });
    this.upMat = new THREE.ShaderMaterial({
      vertexShader: quadVert, fragmentShader: upFrag,
      depthTest: false, depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } },
    });
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: quadVert, fragmentShader: compositeFrag,
      depthTest: false, depthWrite: false,
      uniforms: {
        tScene: { value: null }, tBloom: { value: null },
        uBloomStrength: { value: 0.75 }, uExposure: { value: 1.4 },
        uGrain: { value: 0.045 }, uVignette: { value: 0.42 }, uDispersion: { value: 0.25 },
        uTime: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) }, uDebug: { value: 0 },
      },
    });
  }

  get quality() { return QUALITY[this.qualityName]; }

  setQuality(name) {
    this.qualityName = QUALITY[name] ? name : 'high';
    this.sceneMat.uniforms.uSteps.value = this.quality.steps;
    this.resize(true);
    return this.qualityName;
  }

  resize(force = false) {
    const q = this.quality;
    const dpr = Math.min(window.devicePixelRatio || 1, q.dprCap);
    const cssW = Math.max(1, Math.floor(this._cssWidth()));
    const cssH = Math.max(1, Math.floor(this._cssHeight()));
    const drawW = Math.max(1, Math.floor(cssW * dpr));
    const drawH = Math.max(1, Math.floor(cssH * dpr));
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';

    const rw = Math.max(8, Math.floor(drawW * q.renderScale));
    const rh = Math.max(8, Math.floor(drawH * q.renderScale));
    if (force || rw !== this.renderSize.x || rh !== this.renderSize.y || !this.rtScene) {
      this.renderSize.set(rw, rh);
      this._allocTargets();
    }
    // star PSF is recomputed each frame in render() (depends on current fov)
  }

  _cssWidth() { return this.canvas.parentElement?.clientWidth || window.innerWidth; }
  _cssHeight() { return this.canvas.parentElement?.clientHeight || window.innerHeight; }

  _allocTargets() {
    this._freeTargets();
    const opts = { ...RT_OPTS, type: this.rtType, format: THREE.RGBAFormat,
                   minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rtScene = new THREE.WebGLRenderTarget(this.renderSize.x, this.renderSize.y, opts);
    this.mips = [];
    let w = this.renderSize.x >> 1, h = this.renderSize.y >> 1;
    for (let i = 0; i < this.quality.bloomMips && w >= 4 && h >= 4; i++) {
      this.mips.push(new THREE.WebGLRenderTarget(w, h, opts));
      w >>= 1; h >>= 1;
    }
    if (this.mips.length === 0) this.mips.push(new THREE.WebGLRenderTarget(4, 4, opts));
  }

  _freeTargets() {
    this.rtScene?.dispose();
    this.mips?.forEach(m => m.dispose());
    this.rtScene = null; this.mips = null;
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  /**
   * frame: { time, cam: {pos,right,up,fwd,fovRad,camGrav}, params, debug }
   */
  render(frame) {
    const u = this.sceneMat.uniforms;
    u.uTime.value = frame.time;
    u.uCamPos.value.copy(frame.cam.pos);
    u.uCamRight.value.copy(frame.cam.right);
    u.uCamUp.value.copy(frame.cam.up);
    u.uCamFwd.value.copy(frame.cam.fwd);
    this._fovOverride = frame.cam.fovRad;
    u.uTanFov.value = Math.tan(frame.cam.fovRad * 0.5);
    u.uCamGrav.value = frame.cam.camGrav;
    u.uResolution.value.copy(this.renderSize);
    const p = frame.params;
    u.uDiskInner.value = p.diskInner; u.uDiskOuter.value = p.diskOuter;
    u.uDiskDensity.value = p.diskDensity; u.uDiskTemp.value = p.diskTemp; u.uDiskSpeed.value = p.diskSpeed;
    u.uTurb.value = p.turbulence; u.uTurbScale.value = p.turbScale;
    u.uDoppler.value = p.doppler; u.uRedshift.value = p.redshift;
    u.uStars.value = p.starBrightness; u.uStarDensity.value = p.starDensity; u.uMilkyWay.value = p.milkyWay;
    u.uDebug.value = frame.debug;
    // star PSF refresh (depends on fov)
    u.uStarSharp.value = Math.max(5e-4, (frame.cam.fovRad * 0.5 * 1.35) / this.renderSize.y);

    // 1) raytraced scene -> HDR
    this._pass(this.sceneMat, this.rtScene);

    // 2) bloom chain
    if (this.mips.length > 0) {
      const bu = this.brightMat.uniforms;
      bu.tSrc.value = this.rtScene.texture;
      bu.uTexel.value.set(1 / this.renderSize.x, 1 / this.renderSize.y);
      bu.uThreshold.value = p.bloomThreshold;
      this._pass(this.brightMat, this.mips[0]);

      for (let i = 1; i < this.mips.length; i++) {
        const du = this.downMat.uniforms;
        du.tSrc.value = this.mips[i - 1].texture;
        du.uTexel.value.set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height);
        this._pass(this.downMat, this.mips[i]);
      }
      for (let i = this.mips.length - 1; i > 0; i--) {
        const uu = this.upMat.uniforms;
        uu.tSrc.value = this.mips[i].texture;
        uu.uTexel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
        uu.uRadius.value = p.bloomRadius;
        this._pass(this.upMat, this.mips[i - 1]);
      }
    }

    // 3) composite -> screen
    const cu = this.compositeMat.uniforms;
    cu.tScene.value = this.rtScene.texture;
    cu.tBloom.value = this.mips[0].texture;
    cu.uBloomStrength.value = p.bloomStrength;
    cu.uExposure.value = p.exposure;
    cu.uGrain.value = frame.debug === 0 ? p.grain : 0;
    cu.uVignette.value = frame.debug === 0 ? p.vignette : 0;
    cu.uDispersion.value = frame.debug === 0 ? p.dispersion : 0;
    cu.uTime.value = frame.time;
    cu.uResolution.value.set(this.renderer.domElement.width, this.renderer.domElement.height);
    cu.uDebug.value = frame.debug;
    this._pass(this.compositeMat, null);
  }

  dispose(dropContext = true) {
    this.disposed = true;
    this._freeTargets();
    this.quad.geometry.dispose();
    [this.sceneMat, this.brightMat, this.downMat, this.upMat, this.compositeMat]
      .forEach(m => m.dispose());
    this.renderer.dispose();
    if (dropContext) { try { this.renderer.forceContextLoss(); } catch { /* already lost */ } }
  }
}
