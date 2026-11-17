import * as THREE from 'three';

/**
 * A ceramic mug defined by its outer profile (radius, height) from the bottom centre up to the rim.
 * The same profile drives the intact lathe mesh and the shell fracture, so shards match the mug.
 */
export interface CupDesign {
  /** Outer profile points [r, y] in metres, bottom centre first, rim last. */
  profile: [number, number][];
  thickness: number;
  handle: boolean;
  glaze: THREE.ColorRepresentation;
  /** Tea level as a fraction of the height, 0 for empty. */
  fill: number;
}

export const MUG: CupDesign = {
  profile: [
    [0.0, 0.0035],
    [0.028, 0.0035],
    [0.0325, 0.0],
    [0.0362, 0.0012],
    [0.0378, 0.008],
    [0.0392, 0.04],
    [0.0404, 0.075],
    [0.0412, 0.0955],
  ],
  thickness: 0.0042,
  handle: true,
  glaze: 0xf1ede6,
  fill: 0.62,
};

export const GLAZES: THREE.ColorRepresentation[] = [0xf1ede6, 0xe9e4da, 0x2f4a5c, 0x6f2f2a, 0x3b4a3a, 0xd9cdb7];

/** Smoothed, evenly spaced outer profile, with an outward 2D normal at each point. */
export interface SampledProfile {
  points: THREE.Vector2[]; // (r, y)
  normals: THREE.Vector2[]; // outward (dr, dy)
  length: number;
}

export function sampleProfile(design: CupDesign, segments = 48): SampledProfile {
  const curve = new THREE.SplineCurve(design.profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const points = curve.getSpacedPoints(segments);
  points[0].x = 0; // keep the bottom centre on the axis
  const normals = points.map((_, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    return new THREE.Vector2(t.y, -t.x); // rotate tangent clockwise: points outward/downward
  });
  normals[0].set(0, -1);
  return { points, normals, length: curve.getLength() };
}

/** Evaluates the outer surface at (u around, v along profile 0..1). */
export function surfacePoint(p: SampledProfile, u: number, v: number, inset: number, out: THREE.Vector3, normal?: THREE.Vector3): THREE.Vector3 {
  const f = THREE.MathUtils.clamp(v, 0, 1) * (p.points.length - 1);
  const i = Math.min(Math.floor(f), p.points.length - 2);
  const t = f - i;
  const r = THREE.MathUtils.lerp(p.points[i].x, p.points[i + 1].x, t);
  const y = THREE.MathUtils.lerp(p.points[i].y, p.points[i + 1].y, t);
  const nr = THREE.MathUtils.lerp(p.normals[i].x, p.normals[i + 1].x, t);
  const ny = THREE.MathUtils.lerp(p.normals[i].y, p.normals[i + 1].y, t);
  const len = Math.hypot(nr, ny) || 1;
  const a = u * Math.PI * 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rr = Math.max(0, r - (nr / len) * inset);
  out.set(rr * c, y - (ny / len) * inset, rr * s);
  if (normal) normal.set((nr / len) * c, ny / len, (nr / len) * s);
  return out;
}

export function handleCurve(design: CupDesign): THREE.CatmullRomCurve3 {
  const top = design.profile[design.profile.length - 1];
  const h = top[1];
  const r = top[0];
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(r - 0.002, h * 0.8, 0),
    new THREE.Vector3(r + 0.016, h * 0.84, 0),
    new THREE.Vector3(r + 0.03, h * 0.66, 0),
    new THREE.Vector3(r + 0.028, h * 0.38, 0),
    new THREE.Vector3(r + 0.012, h * 0.24, 0),
    new THREE.Vector3(r - 0.003, h * 0.22, 0),
  ]);
}

export function glazeMaterial(color: THREE.ColorRepresentation): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.28,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    sheen: 0,
  });
}

/** Unglazed fired clay, seen on broken edges. */
export const bisqueMaterial = new THREE.MeshStandardMaterial({ color: 0xe6dccb, roughness: 0.92 });

export const teaMaterial = new THREE.MeshStandardMaterial({
  color: 0x22130a,
  roughness: 0.32,
  envMapIntensity: 0.12,
});

export interface CupMesh {
  group: THREE.Group;
  glaze: THREE.MeshPhysicalMaterial;
  profile: SampledProfile;
}

/** The intact mug: lathe body (outside, rounded rim, inside), handle and tea. */
export function createCupMesh(design: CupDesign, glazeColor: THREE.ColorRepresentation = design.glaze): CupMesh {
  const profile = sampleProfile(design);
  const outer = profile.points;
  const t = design.thickness;
  const inner = outer.map((pt, i) => {
    const n = profile.normals[i];
    return new THREE.Vector2(Math.max(0, pt.x - n.x * t), pt.y - n.y * t);
  });
  // Rounded rim: half circle from the outer rim point over to the inner rim point.
  const rimO = outer[outer.length - 1];
  const rimI = inner[inner.length - 1];
  const rimC = rimO.clone().add(rimI).multiplyScalar(0.5);
  const rimR = rimO.distanceTo(rimI) / 2;
  const rim: THREE.Vector2[] = [];
  for (let k = 1; k < 8; k++) {
    const a = (k / 8) * Math.PI;
    rim.push(new THREE.Vector2(rimC.x + Math.cos(a) * rimR, rimC.y + Math.sin(a) * rimR));
  }
  const lathePts = [...outer, ...rim, ...inner.slice().reverse()];
  const body = new THREE.Mesh(new THREE.LatheGeometry(lathePts, 56), glazeMaterial(glazeColor));
  body.castShadow = true;
  body.receiveShadow = true;

  const group = new THREE.Group();
  group.add(body);
  const glaze = body.material as THREE.MeshPhysicalMaterial;

  if (design.handle) {
    const handle = new THREE.Mesh(new THREE.TubeGeometry(handleCurve(design), 32, 0.0058, 12, false), glaze);
    handle.scale.z = 0.75; // slightly flattened, like a real mug handle
    handle.castShadow = true;
    group.add(handle);
  }

  if (design.fill > 0) {
    const h = outer[outer.length - 1].y * design.fill;
    // Inner radius at the tea surface.
    let r = inner[inner.length - 1].x;
    for (let i = 1; i < inner.length; i++) {
      if (inner[i].y >= h) {
        const k = (h - inner[i - 1].y) / (inner[i].y - inner[i - 1].y);
        r = THREE.MathUtils.lerp(inner[i - 1].x, inner[i].x, k);
        break;
      }
    }
    const tea = new THREE.Mesh(new THREE.CircleGeometry(r - 0.0004, 40), teaMaterial);
    tea.rotation.x = -Math.PI / 2;
    tea.position.y = h;
    group.add(tea);
  }

  return { group, glaze, profile };
}
