import * as THREE from 'three';

/**
 * The view through the window: a rainy night city, fully procedural.
 * - Out-of-focus skyline: hazy far towers, darker near blocks, many small soft lit windows.
 * - Soft bokeh street lights near the horizon (HDR values so they bloom).
 * - Rain on the glass: beads and running drops that refract the city and catch room light.
 * - uDawn (0..1) turns night into a grey-blue then warm sunrise for the ending.
 */

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uDawn;
  uniform float uRain;
  uniform float uAspect;

  float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }

  float dawnAmt() { return smoothstep(0.0, 1.0, uDawn); }

  vec3 sky(vec2 uv) {
    vec3 nightTop = vec3(0.004, 0.005, 0.009);
    vec3 nightLow = vec3(0.030, 0.022, 0.022); // faint sodium glow over the city
    vec3 night = mix(nightLow, nightTop, smoothstep(0.1, 0.9, uv.y));
    vec3 dawnTop = vec3(0.16, 0.20, 0.30);
    vec3 dawnLow = vec3(1.05, 0.60, 0.36);
    vec3 dawn = mix(dawnLow, dawnTop, smoothstep(0.05, 0.8, uv.y));
    float d = dawnAmt();
    vec3 blue = mix(night, vec3(0.07, 0.09, 0.13) * (0.6 + uv.y), smoothstep(0.0, 0.5, d));
    return mix(blue, dawn, smoothstep(0.45, 1.0, d));
  }

  // One out-of-focus layer of buildings.
  // colW: building width (aspect-corrected units), rowH: window row spacing (uv), blur: edge softness.
  void layer(vec2 uv, float seed, float baseH, float varH, float colW, float rowH, float litP, float blur,
             vec3 bodyNight, vec3 bodyDawn, float litGain, inout vec3 c) {
    float x = uv.x * uAspect / colW;
    float col = floor(x);
    float fx = fract(x);
    float h = baseH + varH * pow(hash11(col * 17.3 + seed), 1.6);
    float gap = 0.04 + 0.08 * hash11(col * 3.1 + seed);
    float inside = smoothstep(gap, gap + blur * 3.0, fx) * smoothstep(1.0 - gap, 1.0 - gap - blur * 3.0, fx);
    float cover = inside * smoothstep(h + blur * 0.4, h - blur * 0.4, uv.y);
    float d = dawnAmt();
    c = mix(c, mix(bodyNight, bodyDawn, d), cover);

    // Windows: small, many, softly blurred; most dark.
    float cols = floor(7.0 + 6.0 * hash11(col * 5.7 + seed));
    vec2 g = vec2((fx - gap) / (1.0 - 2.0 * gap) * cols, uv.y / rowH);
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float r = hash21(cell + vec2(col * 13.7, seed));
    float shape = smoothstep(0.5, 0.18, abs(f.x)) * smoothstep(0.5, 0.12, abs(f.y));
    float on = step(1.0 - litP, r);
    float warm = step(0.25, hash21(cell + 7.7 + col));
    vec3 wc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.70, 0.40), warm);
    float valid = step(0.0, g.x) * step(g.x, cols) * step(uv.y, h - rowH * 0.8);
    float night = 1.0 - smoothstep(0.35, 0.9, d);
    c += wc * shape * on * valid * cover * litGain * (0.5 + 0.8 * hash11(r * 91.0)) * night;
  }

  vec3 city(vec2 uv) {
    vec3 c = sky(uv);
    // Far towers: hazy, low contrast.
    layer(uv, 1.0, 0.34, 0.42, 0.075, 0.016, 0.10, 0.02, vec3(0.020, 0.019, 0.024), vec3(0.16, 0.17, 0.20), 0.35, c);
    // Mid blocks.
    layer(uv + vec2(0.21, 0.0), 4.0, 0.22, 0.30, 0.13, 0.024, 0.09, 0.015, vec3(0.010, 0.010, 0.013), vec3(0.09, 0.09, 0.11), 0.6, c);
    // Near block, darkest.
    layer(uv + vec2(0.57, 0.0), 9.0, 0.08, 0.16, 0.24, 0.036, 0.07, 0.012, vec3(0.004, 0.004, 0.005), vec3(0.04, 0.04, 0.05), 0.9, c);

    // Bokeh street lights and traffic near the bottom.
    float night = 1.0 - smoothstep(0.35, 0.9, dawnAmt());
    for (int i = 0; i < 18; i++) {
      float fi = float(i);
      vec2 p = vec2(hash11(fi * 7.1), 0.015 + 0.09 * hash11(fi * 3.7));
      // Some lights drift slowly sideways: distant traffic.
      p.x = fract(p.x + step(0.6, hash11(fi * 2.3)) * uTime * (0.004 + 0.006 * hash11(fi)) * (hash11(fi * 9.1) > 0.5 ? 1.0 : -1.0));
      float rad = 0.012 + 0.02 * hash11(fi * 1.9);
      vec2 d = (uv - p) * vec2(uAspect, 1.0);
      float disc = smoothstep(rad, rad * 0.55, length(d));
      vec3 lc = mix(vec3(1.0, 0.55, 0.22), vec3(0.9, 0.92, 1.0), step(0.72, hash11(fi * 5.3)));
      c += lc * disc * (0.6 + 0.8 * hash11(fi)) * night;
    }
    return c;
  }

  // Rain on glass. Returns refraction offset (xy) and drop mask (z); w = highlight.
  vec4 rain(vec2 uv, float t) {
    vec2 a = vec2(uAspect, 1.0);
    vec4 acc = vec4(0.0);
    // Running drops: two layers of grid cells, one drop per cell, sliding down with a trail.
    for (int layerI = 0; layerI < 2; layerI++) {
      float s = layerI == 0 ? 5.0 : 8.0;
      vec2 grid = vec2(floor(s * uAspect), s);
      vec2 p = uv * grid;
      vec2 id = floor(p);
      vec2 n = hash22(id + float(layerI) * 31.0);
      if (n.y < 0.35) continue;
      float speed = 0.05 + 0.10 * n.y;
      // Drops pause and lurch, like real ones.
      float tt = t * speed + n.x * 10.0;
      float y = 1.0 - fract(tt + 0.15 * sin(tt * 6.2831));
      vec2 cuv = fract(p) - 0.5;
      vec2 dp = vec2((n.x - 0.5) * 0.5 + 0.06 * sin(tt * 3.0 + n.y * 30.0), y - 0.5);
      vec2 d = (cuv - dp) * vec2(grid.y / grid.x * uAspect, 1.0);
      float r = 0.045 + 0.035 * n.x;
      float drop = smoothstep(r, r * 0.7, length(d * vec2(1.0, 0.8)));
      // Trail of tiny beads above the drop.
      float tx = smoothstep(0.03, 0.0, abs(cuv.x - dp.x));
      float above = step(dp.y, cuv.y) * (1.0 - smoothstep(dp.y, dp.y + 0.45, cuv.y));
      float beads = smoothstep(0.4, 0.0, length(vec2((cuv.x - dp.x) * 14.0, fract(cuv.y * 14.0) - 0.5)));
      float trail = tx * above * beads;
      vec2 nrm = d / r;
      acc.xy += nrm * drop * 0.8 + vec2(0.0, 0.2) * trail;
      acc.z += drop + trail * 0.6;
      acc.w += drop * smoothstep(0.2, 0.9, -nrm.y) * smoothstep(1.0, 0.4, length(nrm)) + trail * 0.3;
    }
    // Static beads on the glass.
    vec2 sp = uv * vec2(55.0 * uAspect, 55.0);
    vec2 sid = floor(sp);
    vec2 sn = hash22(sid);
    vec2 sd = fract(sp) - 0.5 - (sn - 0.5) * 0.5;
    float br = 0.12 + 0.18 * sn.x;
    float bead = smoothstep(br, br * 0.5, length(sd)) * step(0.6, sn.y);
    acc.xy += sd / br * bead * 0.35;
    acc.z += bead * 0.6;
    acc.w += bead * smoothstep(0.0, -0.3, sd.y) * 0.5;
    return acc * uRain;
  }

  void main() {
    vec2 uv = vUv;
    vec4 r = rain(uv, uTime);
    // Drops act as tiny lenses: they show the city flipped and shifted.
    vec2 ruv = uv - r.xy * 0.03;
    vec3 col = city(ruv);
    // Drops darken slightly at their edges and catch a cool highlight from the monitor.
    col *= 1.0 - 0.25 * clamp(r.z, 0.0, 1.0) * (1.0 - dawnAmt() * 0.5);
    col += vec3(0.55, 0.65, 0.8) * r.w * 0.05 * (1.0 + dawnAmt() * 2.0);
    // Condensation haze between drops.
    col = mix(col, col * 0.8 + vec3(0.006, 0.007, 0.010), 0.4 * (1.0 - clamp(r.z, 0.0, 1.0)));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface NightWindow {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  update(time: number): void;
  setDawn(v: number): void;
}

export function createWindow(width: number, height: number): NightWindow {
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uTime: { value: 0 },
      uDawn: { value: 0 },
      uRain: { value: 1 },
      uAspect: { value: width / height },
    },
    toneMapped: false,
    fog: false,
  });
  const view = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  const group = new THREE.Group();
  group.add(view);
  return {
    group,
    material,
    update(time) {
      material.uniforms.uTime.value = time;
    },
    setDawn(v) {
      material.uniforms.uDawn.value = v;
    },
  };
}
