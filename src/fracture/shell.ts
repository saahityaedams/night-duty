import * as THREE from 'three';
import { surfacePoint, type SampledProfile } from '../scene/props/cup';

/**
 * Shell fracture for thin-walled objects turned on a lathe (mugs, cups, jars, vases).
 *
 * The object's surface is unrolled into a 2D parameter space (around × along the profile),
 * scaled so distances are roughly true to 3D. Voronoi cells in that space become shards:
 * each one is mapped back onto the curved surface and given real wall thickness, with glazed
 * outer and inner faces and rough unglazed side faces along the break.
 *
 * Seeds cluster around the impact point, so pieces are small and many where it was hit and
 * large far away, as in real ceramic.
 */

export interface ShellFractureOptions {
  profile: SampledProfile;
  thickness: number;
  /** Total shard count. */
  pieces: number;
  /** Impact location in surface parameters: u (around, 0..1), v (along profile, 0..1). */
  impactU: number;
  impactV: number;
  /** 0 = pieces spread evenly, 1 = strongly clustered at the impact. */
  focus: number;
  rng: () => number;
}

export interface Shard {
  geometry: THREE.BufferGeometry; // centred on its centroid; group 0 = glaze, group 1 = broken edge
  centroid: THREE.Vector3; // in the object's local space
  hull: Float32Array; // point cloud for the convex-hull collider, centred like the geometry
  volume: number; // approximate material volume (m³) for mass
  /** Where the shard sits on the surface, for the outward burst direction. */
  outward: THREE.Vector3;
}

type V2 = [number, number];

export function fractureShell(o: ShellFractureOptions): Shard[] {
  const { profile, thickness, rng } = o;
  const meanR = profile.points.reduce((s, p) => s + p.x, 0) / profile.points.length;
  const Cu = (2 * Math.PI * meanR) / profile.length; // metric width of the u range

  // --- Seeds ---------------------------------------------------------------------------------
  const seeds: V2[] = [];
  const ix = o.impactU * Cu;
  const iy = o.impactV;
  for (let i = 0; i < o.pieces; i++) {
    if (rng() < o.focus * 0.7) {
      // Gaussian-ish cluster at the impact.
      const r = Math.sqrt(-2 * Math.log(Math.max(1e-6, rng()))) * 0.12;
      const a = rng() * Math.PI * 2;
      seeds.push([wrap(ix + Math.cos(a) * r * 1.4, Cu), clamp01(iy + Math.sin(a) * r)]);
    } else {
      seeds.push([rng() * Cu, rng()]);
    }
  }

  // --- Voronoi cells by half-plane clipping (with wrap-around ghosts) -------------------------
  const shards: Shard[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const [sx, sy] = seeds[i];
    let poly: V2[] = [
      [sx - Cu / 2, 0],
      [sx + Cu / 2, 0],
      [sx + Cu / 2, 1],
      [sx - Cu / 2, 1],
    ];
    for (let j = 0; j < seeds.length && poly.length; j++) {
      for (const shift of [-Cu, 0, Cu]) {
        if (j === i && shift === 0) continue;
        poly = clipHalfPlane(poly, [sx, sy], [seeds[j][0] + shift, seeds[j][1]]);
        if (!poly.length) break;
      }
    }
    if (poly.length < 3 || Math.abs(polyArea(poly)) < 1e-5) continue;
    const shard = buildShard(jag(poly, rng), Cu, profile, thickness);
    if (shard) shards.push(shard);
  }
  return shards;
}

// ---------------------------------------------------------------------------------------------

function clipHalfPlane(poly: V2[], keep: V2, other: V2): V2[] {
  // Keep the side of the bisector closest to `keep`.
  const nx = other[0] - keep[0];
  const ny = other[1] - keep[1];
  const mx = (keep[0] + other[0]) / 2;
  const my = (keep[1] + other[1]) / 2;
  const side = (p: V2) => (p[0] - mx) * nx + (p[1] - my) * ny; // <= 0 keeps
  const out: V2[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    const da = side(a);
    const db = side(b);
    if (da <= 0) out.push(a);
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Breaks long straight cell edges into slightly irregular ones, except along the rim and base. */
function jag(poly: V2[], rng: () => number): V2[] {
  const out: V2[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    out.push(a);
    const onBoundary = (Math.abs(a[1] - 1) < 1e-4 && Math.abs(b[1] - 1) < 1e-4) || (a[1] < 1e-4 && b[1] < 1e-4);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = onBoundary ? 0 : Math.floor(len / 0.035);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      const px = -(b[1] - a[1]) / len;
      const py = (b[0] - a[0]) / len;
      const amp = (rng() - 0.5) * 0.35 * (len / (steps + 1));
      out.push([a[0] + (b[0] - a[0]) * t + px * amp, clamp01(a[1] + (b[1] - a[1]) * t + py * amp)]);
    }
  }
  return out;
}

function polyArea(p: V2[]): number {
  let a = 0;
  for (let k = 0; k < p.length; k++) {
    const [x1, y1] = p[k];
    const [x2, y2] = p[(k + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

const MAX_EDGE = 0.045; // metric units; enough to follow the curve without wasting triangles

function buildShard(contour: V2[], Cu: number, profile: SampledProfile, t: number): Shard | null {
  if (polyArea(contour) < 0) contour.reverse(); // counter-clockwise
  const tris = THREE.ShapeUtils.triangulateShape(
    contour.map(([x, y]) => new THREE.Vector2(x, y)),
    [],
  );
  if (!tris.length) return null;

  // Subdivide triangles so the shard follows the surface curvature.
  const pts: V2[] = contour.slice();
  let faces = tris.map((f) => [f[0], f[1], f[2]]);
  const midCache = new Map<string, number>();
  const mid = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let m = midCache.get(key);
    if (m === undefined) {
      m = pts.length;
      pts.push([(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2]);
      midCache.set(key, m);
    }
    return m;
  };
  for (let pass = 0; pass < 2; pass++) {
    const longest = Math.max(...faces.map(([a, b, c]) => Math.max(d2(pts[a], pts[b]), d2(pts[b], pts[c]), d2(pts[c], pts[a]))));
    if (longest < MAX_EDGE * MAX_EDGE) break;
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    faces = next;
  }

  // Map to 3D: outer and inner surfaces.
  const outerP: THREE.Vector3[] = [];
  const outerN: THREE.Vector3[] = [];
  const innerP: THREE.Vector3[] = [];
  for (const [x, y] of pts) {
    const u = x / Cu;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    surfacePoint(profile, u, y, 0, p, n);
    outerP.push(p);
    outerN.push(n);
    innerP.push(surfacePoint(profile, u, y, t, new THREE.Vector3()));
  }

  const centroid = new THREE.Vector3();
  for (let k = 0; k < pts.length; k++) centroid.add(outerP[k]).add(innerP[k]);
  centroid.multiplyScalar(1 / (pts.length * 2));

  const pos: number[] = [];
  const nor: number[] = [];
  const pushV = (p: THREE.Vector3, n: THREE.Vector3) => {
    pos.push(p.x - centroid.x, p.y - centroid.y, p.z - centroid.z);
    nor.push(n.x, n.y, n.z);
  };

  // Outer surface: counter-clockwise in parameter space faces inward, so reverse winding.
  let area = 0;
  for (const [a, b, c] of faces) {
    pushV(outerP[a], outerN[a]);
    pushV(outerP[c], outerN[c]);
    pushV(outerP[b], outerN[b]);
    area += new THREE.Triangle(outerP[a], outerP[b], outerP[c]).getArea();
  }
  // Inner surface: same triangles, normal flipped, original winding.
  const neg = (n: THREE.Vector3) => n.clone().negate();
  for (const [a, b, c] of faces) {
    pushV(innerP[a], neg(outerN[a]));
    pushV(innerP[b], neg(outerN[b]));
    pushV(innerP[c], neg(outerN[c]));
  }
  const glazeCount = pos.length / 3;

  // Broken side faces along the refined mesh's boundary (edges used by exactly one triangle),
  // so they meet the subdivided surfaces with no cracks.
  const edgeUse = new Map<string, { a: number; b: number; c: number; n: number }>();
  for (const [a, b, c] of faces) {
    for (const [p, q, r] of [[a, b, c], [b, c, a], [c, a, b]]) {
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      const e = edgeUse.get(key);
      if (e) e.n++;
      else edgeUse.set(key, { a: p, b: q, c: r, n: 1 });
    }
  }
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const fn = new THREE.Vector3();
  for (const e of edgeUse.values()) {
    if (e.n !== 1) continue;
    const oa = outerP[e.a];
    const ob = outerP[e.b];
    const ib = innerP[e.b];
    const ia = innerP[e.a];
    // Reference point inside the shard (toward the triangle's third vertex), at mid-thickness.
    const ref = outerP[e.c].clone().add(innerP[e.c]).multiplyScalar(0.5);
    fn.crossVectors(tmpA.subVectors(ob, oa), tmpB.subVectors(ia, oa)).normalize();
    const faceMid = tmpA.copy(oa).add(ob).add(ib).add(ia).multiplyScalar(0.25);
    const flip = fn.dot(tmpB.subVectors(faceMid, ref)) < 0;
    const quad = flip ? [oa, ia, ib, ob] : [oa, ob, ib, ia];
    const n = flip ? fn.clone().negate() : fn.clone();
    pushV(quad[0], n);
    pushV(quad[1], n);
    pushV(quad[2], n);
    pushV(quad[0], n);
    pushV(quad[2], n);
    pushV(quad[3], n);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.addGroup(0, glazeCount, 0);
  geometry.addGroup(glazeCount, pos.length / 3 - glazeCount, 1);
  geometry.computeBoundingSphere();

  // Hull points: the contour on both surfaces plus a few interior points.
  const hullPts: number[] = [];
  const step = Math.max(1, Math.floor(pts.length / 24));
  for (let k = 0; k < pts.length; k += step) {
    for (const p of [outerP[k], innerP[k]]) hullPts.push(p.x - centroid.x, p.y - centroid.y, p.z - centroid.z);
  }

  const outward = new THREE.Vector3();
  for (const n of outerN) outward.add(n);
  outward.normalize();

  return { geometry, centroid, hull: new Float32Array(hullPts), volume: area * t, outward };
}

function d2(a: V2, b: V2): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
function wrap(v: number, m: number): number {
  return ((v % m) + m) % m;
}
