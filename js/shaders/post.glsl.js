// GARGANTUA - HDR post-processing chain.
// bright-pass (soft knee) -> separable-ish down/up dual-filter bloom ->
// composite: chromatic dispersion + bloom + exposure + ACES + vignette +
// film grain + ordered dithering.

export const quadVert = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// --------------------------------------------------------------- bright pass
export const brightFrag = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;      // 1/src resolution
uniform float uThreshold;
uniform float uKnee;

vec3 prefilt(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}

void main() {
  vec3 a = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  vec3 col = (a + b + c + d) * 0.25 * 0.5 + e * 0.5;
  gl_FragColor = vec4(prefilt(col), 1.0);
}
`;

// ------------------------------------------------------------- down sampling
export const downFrag = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;      // 1/src resolution (bigger mip)
void main() {
  vec3 a = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  vec3 f = texture2D(tSrc, vUv + uTexel * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture2D(tSrc, vUv + uTexel * vec2(-2.0,  0.0)).rgb;
  vec3 h = texture2D(tSrc, vUv + uTexel * vec2( 0.0,  2.0)).rgb;
  vec3 i = texture2D(tSrc, vUv + uTexel * vec2( 0.0, -2.0)).rgb;
  gl_FragColor = vec4(e * 0.125 + (a + b + c + d) * 0.0625 + (f + g + h + i) * 0.09375, 1.0);
}
`;

// --------------------------------------------------------------- up sampling
export const upFrag = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;      // 1/src (smaller mip) resolution
uniform float uRadius;
void main() {
  vec2 o = uTexel * uRadius;
  vec3 s =
      texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb * 1.0 +
      texture2D(tSrc, vUv + vec2( 0.0,  o.y)).rgb * 2.0 +
      texture2D(tSrc, vUv + vec2( o.x,  o.y)).rgb * 1.0 +
      texture2D(tSrc, vUv + vec2(-o.x,  0.0)).rgb * 2.0 +
      texture2D(tSrc, vUv).rgb * 4.0 +
      texture2D(tSrc, vUv + vec2( o.x,  0.0)).rgb * 2.0 +
      texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 1.0 +
      texture2D(tSrc, vUv + vec2( 0.0, -o.y)).rgb * 2.0 +
      texture2D(tSrc, vUv + vec2( o.x, -o.y)).rgb * 1.0;
  gl_FragColor = vec4(s / 16.0, 1.0);
}
`;

// ------------------------------------------------------------------ composite
export const compositeFrag = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uGrain;
uniform float uVignette;
uniform float uDispersion;
uniform float uTime;
uniform vec2 uResolution;
uniform int uDebug;

// ACES filmic fit (Narkowicz 2015)
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;
  vec2 cuv = uv - 0.5;

  if (uDebug == 7) {
    // bloom-buffer visualization
    vec3 b = texture2D(tBloom, uv).rgb;
    gl_FragColor = vec4(pow(clamp(b, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
    return;
  }

  // radial chromatic dispersion (3 taps on scene + bloom)
  vec2 off = cuv * dot(cuv, cuv) * uDispersion * 0.018;
  vec3 col;
  col.r = texture2D(tScene, uv + off).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - off).b;
  vec3 bloom;
  bloom.r = texture2D(tBloom, uv + off * 0.7).r;
  bloom.g = texture2D(tBloom, uv).g;
  bloom.b = texture2D(tBloom, uv - off * 0.7).b;
  col += bloom * uBloomStrength;

  col *= uExposure;
  col = aces(col);

  // vignette
  float r = length(cuv) * 1.414;
  col *= 1.0 - uVignette * smoothstep(0.45, 1.25, r);

  // film grain (luminance-weighted, animated)
  float g = hash(uv * uResolution + fract(uTime) * 1731.0) - 0.5;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += g * uGrain * (1.0 - lum * 0.6);

  // output sRGB + dithering against 8-bit banding
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
  col += (hash(uv * uResolution + 7.7) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;
