import * as THREE from 'three';

/**
 * The view through the window: real photographs of a city (CC0), graded live.
 * - Night: a night photo of lit towers from a high window, cooled and deepened to 3:47am, its
 *   lights lifted slightly so they bloom.
 * - Dawn (uDawn 0..1): the glass fogs with condensation, and when it clears the view is a
 *   city at sunrise. The plate swap happens under the fog, so the change of skyline is hidden.
 * - Out of focus: the city is sampled with a disc blur, so lights become soft bokeh.
 * - Rain on the glass: beads and running drops. Each drop is a tiny lens showing a sharper,
 *   flipped image of the city, as real drops do.
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
  uniform sampler2D uPlate;      // night
  uniform sampler2D uPlateDawn;
  uniform vec4 uCropDawn;
  uniform float uTime;
  uniform float uDawn;
  uniform float uRain;
  uniform float uAspect;     // window width / height
  uniform vec4 uCrop;        // plate region: x0, y0, width, height (uv of the photo)
  uniform float uSkyLine;    // plate v (in crop space) above which it's mostly sky

  float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  float swapAmt() { return smoothstep(0.34, 0.40, uDawn); }

  vec3 sampleBoth(vec2 uv, float bias) {
    vec3 n = texture2D(uPlate, uCrop.xy + uv * uCrop.zw, bias).rgb;
    float k = swapAmt();
    if (k <= 0.0) return n;
    vec3 d = texture2D(uPlateDawn, uCropDawn.xy + uv * uCropDawn.zw, bias).rgb;
    return mix(n, d, k);
  }

  // Disc blur: out-of-focus city. Two rings of taps, rotated randomly per pixel so the pattern
  // dissolves into smooth bokeh instead of visible rings. bias raises the mip level.
  vec3 defocus(vec2 uv, float radius, float bias) {
    float rot = hash11(dot(floor(gl_FragCoord.xy), vec2(1.0, 157.0))) * 6.2831;
    vec3 acc = sampleBoth(uv, bias);
    float w = 1.0;
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float ring = i < 5 ? 0.5 : 1.0;
      float a = rot + fi * (i < 5 ? 1.2566 : 0.8976);
      vec2 o = vec2(cos(a), sin(a)) * radius * ring * vec2(1.0 / uAspect, 1.0);
      acc += sampleBoth(uv + o, bias);
      w += 1.0;
    }
    return acc / w;
  }

  vec3 grade(vec2 uv, vec3 base, vec3 blurred) {
    float d = smoothstep(0.0, 1.0, uDawn);
    float skyMask = smoothstep(uSkyLine - 0.04, uSkyLine + 0.03, uv.y);
    // Night plate: cooler, deeper, horizon glow pulled down to a dull sodium haze.
    float l = lum(base);
    vec3 night = base * vec3(0.55, 0.6, 0.78);
    // 3:47am: no evening glow left, just a faint dull haze over the city.
    night = mix(night, vec3(l) * vec3(0.16, 0.15, 0.17) + vec3(0.006, 0.006, 0.009), skyMask * 0.95);
    // Lights: points brighter than their surroundings, lifted so they bloom.
    float lightMask = smoothstep(0.04, 0.2, l - lum(blurred) + max(0.0, l - 0.45));
    night += base * vec3(1.0, 0.85, 0.65) * lightMask * 0.9 * (1.0 - skyMask);
    // Dawn plate: its own colours, a touch hazy.
    vec3 dawn = mix(base, vec3(lum(base)) * vec3(1.05, 0.95, 0.9), 0.1) * 1.05;
    return mix(night, dawn, swapAmt());
  }

  // Rain on glass. xy: lens centre offset for refraction; z: drop mask; w: highlight.
  vec4 rain(vec2 uv, float t, out vec2 lensUv) {
    vec4 acc = vec4(0.0);
    lensUv = uv;
    for (int layerI = 0; layerI < 2; layerI++) {
      float s = layerI == 0 ? 5.0 : 8.0;
      vec2 grid = vec2(floor(s * uAspect), s);
      vec2 p = uv * grid;
      vec2 id = floor(p);
      vec2 n = hash22(id + float(layerI) * 31.0);
      if (n.y < 0.35) continue;
      float speed = 0.05 + 0.10 * n.y;
      float tt = t * speed + n.x * 10.0;
      float y = 1.0 - fract(tt + 0.15 * sin(tt * 6.2831));
      vec2 cuv = fract(p) - 0.5;
      vec2 dp = vec2((n.x - 0.5) * 0.5 + 0.06 * sin(tt * 3.0 + n.y * 30.0), y - 0.5);
      vec2 d = (cuv - dp) * vec2(grid.y / grid.x * uAspect, 1.0);
      float r = 0.045 + 0.035 * n.x;
      float drop = smoothstep(r, r * 0.75, length(d * vec2(1.0, 0.8)));
      float tx = smoothstep(0.03, 0.0, abs(cuv.x - dp.x));
      float above = step(dp.y, cuv.y) * (1.0 - smoothstep(dp.y, dp.y + 0.45, cuv.y));
      float beads = smoothstep(0.4, 0.0, length(vec2((cuv.x - dp.x) * 14.0, fract(cuv.y * 14.0) - 0.5)));
      float trail = tx * above * beads;
      vec2 nrm = d / r;
      if (drop > 0.01) {
        // Lens: a flipped, magnified view of the scene around the drop.
        vec2 centre = (id + dp + 0.5) / grid;
        lensUv = centre - nrm * 0.06;
      }
      acc.z += drop + trail * 0.6;
      acc.w += drop * smoothstep(0.2, 0.9, -nrm.y) * smoothstep(1.0, 0.4, length(nrm)) + trail * 0.3;
    }
    // Static beads.
    vec2 sp = uv * vec2(55.0 * uAspect, 55.0);
    vec2 sid = floor(sp);
    vec2 sn = hash22(sid);
    vec2 sd = fract(sp) - 0.5 - (sn - 0.5) * 0.5;
    float br = 0.12 + 0.18 * sn.x;
    float bead = smoothstep(br, br * 0.5, length(sd)) * step(0.6, sn.y);
    acc.z += bead * 0.6;
    acc.w += bead * smoothstep(0.0, -0.3, sd.y) * 0.5;
    acc.xy = sd / br * bead;
    // The rain stops as the sun comes up.
    return acc * uRain * (1.0 - smoothstep(0.3, 0.55, uDawn));
  }

  void main() {
    vec2 uv = vUv;
    vec2 lensUv;
    vec4 r = rain(uv, uTime, lensUv);
    float dropMask = clamp(r.z, 0.0, 1.0);

    // Out-of-focus city behind the glass.
    vec3 base = defocus(uv - r.xy * 0.004, 0.007, 1.0);
    vec3 wide = sampleBoth(uv, 4.5);
    vec3 col = grade(uv, base, wide);
    // Condensation: during the silence after the finale, the glass fogs over and clears to dawn.
    float fog = smoothstep(0.12, 0.34, uDawn) * (1.0 - smoothstep(0.42, 0.75, uDawn));
    if (fog > 0.001) {
      vec3 fogged = sampleBoth(uv, 6.0);
      col = mix(col, grade(uv, fogged, fogged) * 0.9 + vec3(0.02, 0.022, 0.026) * (1.0 + uDawn * 3.0), fog);
    }

    // Through each drop: a sharper, flipped view.
    if (dropMask > 0.01) {
      vec2 luv = clamp(lensUv, 0.0, 1.0);
      vec3 lb = sampleBoth(luv, 0.5);
      vec3 lw = sampleBoth(luv, 4.0);
      vec3 lensCol = grade(luv, lb, lw);
      col = mix(col, lensCol * 1.1, dropMask * 0.85 * (1.0 - fog));
    }
    // Drops catch a cool highlight from the monitor.
    col += vec3(0.5, 0.6, 0.75) * r.w * 0.04 * (1.0 + uDawn * 2.0);
    // Condensation haze between drops.
    col = mix(col, col * 0.85 + vec3(0.005, 0.006, 0.009), 0.35 * (1.0 - dropMask));
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
  const loadPlate = (name: string) => {
    const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/city/${name}`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  };
  const plate = loadPlate('night_plate_1k.jpg');
  const plateDawn = loadPlate('dawn_plate_1k.jpg');

  // The window is wider than the photo; crop it so the skyline sits where it's visible above the
  // monitor, with sky in the top band.
  const winAspect = width / height;
  const photoAspect = 1024 / 682;
  const cropH = Math.min(1, photoAspect / winAspect);
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uPlate: { value: plate },
      uPlateDawn: { value: plateDawn },
      // Dawn plate (sunrise over a dense city): upper city and skyline in the visible band.
      uCropDawn: { value: new THREE.Vector4(0, 0.236, 1, cropH) },
      uTime: { value: 0 },
      uDawn: { value: 0 },
      uRain: { value: 1 },
      uAspect: { value: winAspect },
      // From the seated camera, the window is visible from v ≈ 0.20 (just above the monitor) to
      // v ≈ 0.46 (top of the screen), plus the strips beside the monitor down to the sill. Full
      // photo width, undistorted; that band shows the upper city and the skyline.
      // Night plate (lit towers from a high window): rooftops, lit windows and the dark horizon.
      uCrop: { value: new THREE.Vector4(0, 0.08, 1, cropH) },
      uSkyLine: { value: 0.44 },
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
