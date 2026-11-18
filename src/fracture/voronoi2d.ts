/**
 * 2D Voronoi helpers shared by the fracture generators.
 * Cells are built by clipping a starting polygon against the bisector half-planes of every other
 * seed (O(n²), fine for the 4–30 pieces an object breaks into).
 */

export type V2 = [number, number];

/** Keeps the part of `poly` on `keep`'s side of the bisector between `keep` and `other`. */
export function clipHalfPlane(poly: V2[], keep: V2, other: V2): V2[] {
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

export function polyArea(p: V2[]): number {
  let a = 0;
  for (let k = 0; k < p.length; k++) {
    const [x1, y1] = p[k];
    const [x2, y2] = p[(k + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * Breaks long straight cell edges into slightly irregular ones. Edges for which `keepStraight`
 * returns true (an object's outer boundary) stay straight.
 */
export function jag(poly: V2[], rng: () => number, step: number, keepStraight: (a: V2, b: V2) => boolean, clampY?: [number, number]): V2[] {
  const out: V2[] = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    out.push(a);
    if (keepStraight(a, b)) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.floor(len / step);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      const px = -(b[1] - a[1]) / len;
      const py = (b[0] - a[0]) / len;
      const amp = (rng() - 0.5) * 0.35 * (len / (steps + 1));
      let y = a[1] + (b[1] - a[1]) * t + py * amp;
      if (clampY) y = Math.min(clampY[1], Math.max(clampY[0], y));
      out.push([a[0] + (b[0] - a[0]) * t + px * amp, y]);
    }
  }
  return out;
}

/** Seeds clustered around an impact point, the rest spread uniformly over a rectangle. */
export function impactSeeds(n: number, w: number, h: number, ix: number, iy: number, focus: number, spread: number, rng: () => number): V2[] {
  const seeds: V2[] = [];
  for (let i = 0; i < n; i++) {
    if (rng() < focus * 0.7) {
      const r = Math.sqrt(-2 * Math.log(Math.max(1e-6, rng()))) * spread;
      const a = rng() * Math.PI * 2;
      seeds.push([Math.min(w, Math.max(0, ix + Math.cos(a) * r)), Math.min(h, Math.max(0, iy + Math.sin(a) * r))]);
    } else {
      seeds.push([rng() * w, rng() * h]);
    }
  }
  return seeds;
}
