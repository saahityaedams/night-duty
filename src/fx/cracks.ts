import * as THREE from 'three';

/**
 * Crack overlays for flat surfaces (screens, lenses, glass, whiteboard).
 * A transparent plane sits just in front of the surface; each impact draws a spider-web:
 * a crushed centre, jagged radial cracks that branch, and concentric stress rings. Cracks are
 * drawn dark with a thin bright edge so they catch the light like real broken glass.
 */

export interface CrackOverlay {
  mesh: THREE.Mesh;
  /** Adds an impact at (u, v) in 0..1 of the surface. strength 0..1 sets the size. */
  impact(u: number, v: number, strength: number): void;
  /** Total cracked fraction so far (rough), for effects like screen flicker. */
  readonly damage: number;
}

export function createCrackOverlay(width: number, height: number, opts: { tint?: string; edge?: string; px?: number } = {}): CrackOverlay {
  const px = opts.px ?? 1024;
  const cw = Math.round(width >= height ? px : (px * width) / height);
  const ch = Math.round(width >= height ? (px * height) / width : px);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    roughness: 0.15,
    metalness: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = 2;
  mesh.visible = false;
  let damage = 0;
  const dark = opts.tint ?? 'rgba(8,10,14,0.9)';
  const edge = opts.edge ?? 'rgba(235,242,255,0.75)';

  const line = (pts: [number, number][], wDark: number, wEdge: number) => {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = dark;
    g.lineWidth = wDark;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.strokeStyle = edge;
    g.lineWidth = wEdge;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x + 0.8, y - 0.8) : g.moveTo(x + 0.8, y - 0.8)));
    g.stroke();
  };

  const impact = (u: number, v: number, strength: number) => {
    mesh.visible = true;
    const cx = u * cw;
    const cy = (1 - v) * ch;
    const scale = Math.max(cw, ch) * (0.18 + strength * 0.45);
    damage = Math.min(1, damage + 0.15 + strength * 0.35);

    // Crushed centre: a dense pale patch of tiny fractures.
    const crush = 6 + strength * 14;
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, crush * 2.2);
    grd.addColorStop(0, 'rgba(225,232,245,0.85)');
    grd.addColorStop(1, 'rgba(225,232,245,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, crush * 2.2, 0, Math.PI * 2);
    g.fill();

    // Radial cracks with branches.
    const spokes = Math.round(7 + strength * 10);
    const spokeEnds: [number, number][][] = [];
    for (let i = 0; i < spokes; i++) {
      const base = (i / spokes) * Math.PI * 2 + Math.random() * 0.4;
      const len = scale * (0.45 + Math.random() * 0.7);
      const pts: [number, number][] = [[cx, cy]];
      let a = base;
      let x = cx;
      let y = cy;
      const segs = 7 + Math.floor(Math.random() * 6);
      for (let s = 0; s < segs; s++) {
        a += (Math.random() - 0.5) * 0.35;
        const step = len / segs;
        x += Math.cos(a) * step;
        y += Math.sin(a) * step;
        pts.push([x, y]);
        if (Math.random() < 0.18 && s > 1) {
          // Branch.
          const ba = a + (Math.random() < 0.5 ? 1 : -1) * (0.4 + Math.random() * 0.5);
          const bl = step * (2 + Math.random() * 3);
          const bpts: [number, number][] = [[x, y]];
          let bx = x;
          let by = y;
          for (let k = 0; k < 4; k++) {
            bx += Math.cos(ba + (Math.random() - 0.5) * 0.4) * (bl / 4);
            by += Math.sin(ba + (Math.random() - 0.5) * 0.4) * (bl / 4);
            bpts.push([bx, by]);
          }
          line(bpts, 1.2, 0.6);
        }
      }
      line(pts, 1.8 + strength, 0.8);
      spokeEnds.push(pts);
    }
    // Concentric stress rings connecting the spokes.
    const rings = 2 + Math.round(strength * 3);
    for (let r = 1; r <= rings; r++) {
      const frac = r / (rings + 1);
      for (let i = 0; i < spokeEnds.length; i++) {
        if (Math.random() < 0.35) continue;
        const a = spokeEnds[i];
        const b = spokeEnds[(i + 1) % spokeEnds.length];
        const pa = a[Math.min(a.length - 1, Math.floor(frac * a.length))];
        const pb = b[Math.min(b.length - 1, Math.floor(frac * b.length))];
        const mx = (pa[0] + pb[0]) / 2 + (Math.random() - 0.5) * 6;
        const my = (pa[1] + pb[1]) / 2 + (Math.random() - 0.5) * 6;
        line([pa, [mx, my], pb], 1.1, 0.5);
      }
    }
    tex.needsUpdate = true;
  };

  return {
    mesh,
    impact,
    get damage() {
      return damage;
    },
  };
}
