import * as THREE from 'three';
import { clipHalfPlane, impactSeeds, jag, polyArea, type V2 } from './voronoi2d';

/**
 * Planar fracture for flat panes: phone and monitor glass, clock lenses, plastic panels.
 * A w×h rectangle (centred on the origin, in the XY plane, thickness along Z) is split into
 * Voronoi cells clustered at the impact; each cell is extruded into a shard.
 * Group 0 = the two faces (glass/plastic), group 1 = the broken edges.
 */

export interface PlanarShard {
  geometry: THREE.BufferGeometry; // centred on its centroid
  centroid: THREE.Vector3; // in the pane's local space
  hull: Float32Array;
  volume: number;
}

export interface PlanarOptions {
  width: number;
  height: number;
  thickness: number;
  pieces: number;
  /** Impact in pane coordinates, 0..1 across and up. */
  impactU: number;
  impactV: number;
  focus: number;
  rng: () => number;
  /** Optional UV mapping for the face (so a cracked screen keeps its image). */
  uv?: boolean;
}

export function fracturePlane(o: PlanarOptions): PlanarShard[] {
  const { width: w, height: h, thickness: t, rng } = o;
  const seeds = impactSeeds(o.pieces, w, h, o.impactU * w, o.impactV * h, o.focus, Math.min(w, h) * 0.18, rng);
  const shards: PlanarShard[] = [];
  const onBoundary = (a: V2, b: V2) =>
    (Math.abs(a[0]) < 1e-5 && Math.abs(b[0]) < 1e-5) ||
    (Math.abs(a[0] - w) < 1e-5 && Math.abs(b[0] - w) < 1e-5) ||
    (Math.abs(a[1]) < 1e-5 && Math.abs(b[1]) < 1e-5) ||
    (Math.abs(a[1] - h) < 1e-5 && Math.abs(b[1] - h) < 1e-5);
  for (let i = 0; i < seeds.length; i++) {
    let poly: V2[] = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
    for (let j = 0; j < seeds.length && poly.length; j++) {
      if (j !== i) poly = clipHalfPlane(poly, seeds[i], seeds[j]);
    }
    if (poly.length < 3 || Math.abs(polyArea(poly)) < 1e-7) continue;
    const contour = jag(poly, rng, Math.min(w, h) * 0.08, onBoundary);
    const shard = extrude(contour, w, h, t, o.uv ?? false);
    if (shard) shards.push(shard);
  }
  return shards;
}

function extrude(contour: V2[], w: number, h: number, t: number, withUv: boolean): PlanarShard | null {
  if (polyArea(contour) < 0) contour.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(
    contour.map(([x, y]) => new THREE.Vector2(x, y)),
    [],
  );
  if (!tris.length) return null;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of contour) {
    cx += x;
    cy += y;
  }
  cx /= contour.length;
  cy /= contour.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    pos.push(x - cx, y - cy, z);
    nor.push(nx, ny, nz);
    if (withUv) uv.push(x / w, y / h);
  };
  // Front (+Z) and back (−Z) faces.
  for (const [a, b, c] of tris) {
    for (const k of [a, b, c]) push(contour[k][0], contour[k][1], t / 2, 0, 0, 1);
  }
  for (const [a, b, c] of tris) {
    for (const k of [a, c, b]) push(contour[k][0], contour[k][1], -t / 2, 0, 0, -1);
  }
  const faceCount = pos.length / 3;
  // Edges.
  for (let k = 0; k < contour.length; k++) {
    const [ax, ay] = contour[k];
    const [bx, by] = contour[(k + 1) % contour.length];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (by - ay) / len;
    const ny = -(bx - ax) / len;
    push(ax, ay, t / 2, nx, ny, 0);
    push(ax, ay, -t / 2, nx, ny, 0);
    push(bx, by, -t / 2, nx, ny, 0);
    push(ax, ay, t / 2, nx, ny, 0);
    push(bx, by, -t / 2, nx, ny, 0);
    push(bx, by, t / 2, nx, ny, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (withUv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.addGroup(0, faceCount, 0);
  geometry.addGroup(faceCount, pos.length / 3 - faceCount, 1);
  geometry.computeBoundingSphere();

  const hull: number[] = [];
  const step = Math.max(1, Math.floor(contour.length / 16));
  for (let k = 0; k < contour.length; k += step) {
    hull.push(contour[k][0] - cx, contour[k][1] - cy, t / 2, contour[k][0] - cx, contour[k][1] - cy, -t / 2);
  }
  return {
    geometry,
    centroid: new THREE.Vector3(cx - w / 2, cy - h / 2, 0),
    hull: new Float32Array(hull),
    volume: Math.abs(polyArea(contour)) * t,
  };
}
