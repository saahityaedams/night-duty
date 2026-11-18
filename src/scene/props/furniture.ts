import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { pbrMaterial } from '../textures';
import { mergeStatic } from '../merge';

/**
 * Room furniture: steel locker, duty-roster whiteboard, side counter.
 * Each builder returns a group with its origin on the floor (or wall) at its base centre,
 * plus the parts that will later break off.
 */

// ---------------------------------------------------------------------------------------------
// Steel locker: two doors with louvres, handles and name slots. Doors are separate parts.

export interface Locker {
  group: THREE.Group;
  body: THREE.Mesh;
  doors: THREE.Group[];
  size: THREE.Vector3;
}

export function createLocker(): Locker {
  const W = 0.6;
  const H = 1.8;
  const D = 0.45;
  const steel = new THREE.MeshStandardMaterial({ color: 0x8f938d, roughness: 0.42, metalness: 0.55 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x5d615c, roughness: 0.5, metalness: 0.5 });
  const interior = new THREE.MeshStandardMaterial({ color: 0x2c2e2c, roughness: 0.7, metalness: 0.3 });
  const group = new THREE.Group();

  // Carcass: open-fronted steel box.
  const t = 0.01;
  const carcass = new THREE.Group();
  const panel = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    carcass.add(mesh);
    return mesh;
  };
  panel(t, H, D, -W / 2 + t / 2, H / 2, 0, steel);
  panel(t, H, D, W / 2 - t / 2, H / 2, 0, steel);
  panel(W, t, D, 0, H - t / 2, 0, steel);
  panel(W, 0.06, D, 0, 0.03, 0, steelDark); // plinth
  panel(W, H, t, 0, H / 2, -D / 2 + t / 2, interior);
  panel(t, H - 0.07, D - 0.02, 0, H / 2 + 0.03, 0, interior); // divider
  panel(W - 2 * t, t, D - 0.02, 0, 1.45, 0, interior); // shelf
  const body = carcass.children[0] as THREE.Mesh;
  group.add(carcass);
  mergeStatic(carcass);

  // Doors.
  const doors: THREE.Group[] = [];
  const doorW = W / 2 - 0.006;
  const doorH = H - 0.075;
  const louvreGeo = new THREE.BoxGeometry(doorW * 0.55, 0.008, 0.012);
  for (const side of [-1, 1]) {
    const door = new THREE.Group();
    const leaf = new THREE.Mesh(new RoundedBoxGeometry(doorW, doorH, 0.018, 2, 0.004), steel);
    leaf.castShadow = leaf.receiveShadow = true;
    door.add(leaf);
    // Louvres near the top and bottom.
    for (const [y0, n] of [[doorH / 2 - 0.12, 6], [-doorH / 2 + 0.12, 6]] as [number, number][]) {
      for (let i = 0; i < n; i++) {
        const l = new THREE.Mesh(louvreGeo, steelDark);
        l.position.set(0, y0 - i * 0.022 * Math.sign(y0), 0.011);
        l.rotation.x = -0.5;
        door.add(l);
      }
    }
    // Handle and name slot.
    const handle = new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.12, 0.022, 2, 0.006), steelDark);
    handle.position.set(-side * (doorW / 2 - 0.04), 0.05, 0.018);
    door.add(handle);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.004), new THREE.MeshStandardMaterial({ color: 0xd9d4c6, roughness: 0.8 }));
    slot.position.set(0, doorH / 2 - 0.32, 0.011);
    door.add(slot);
    door.position.set(side * (W / 4), 0.06 + doorH / 2 + 0.005, D / 2 + 0.01);
    // Louvres, handle and slot become a few merged meshes (the door still detaches as one group).
    door.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o !== leaf) o.castShadow = false;
    });
    mergeStatic(door);
    group.add(door);
    doors.push(door);
  }
  return { group, body, doors, size: new THREE.Vector3(W, H, D) };
}

// ---------------------------------------------------------------------------------------------
// Whiteboard with the duty roster written in marker.

export interface Whiteboard {
  group: THREE.Group;
  board: THREE.Mesh;
  size: THREE.Vector2;
}

export function createWhiteboard(): Whiteboard {
  const W = 0.62;
  const H = 0.44;
  const group = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round(1024 * (H / W));
  const g = c.getContext('2d')!;
  g.fillStyle = '#eef0ee';
  g.fillRect(0, 0, c.width, c.height);
  // Ghosting from old roster weeks, never quite erased.
  g.globalAlpha = 0.08;
  g.fillStyle = '#334';
  g.font = `48px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive`;
  g.fillText('week 46   ON  ON  POST', 70, 420);
  g.fillText('call: 4459', 600, 180);
  g.globalAlpha = 1;
  const hand = (s: string, x: number, y: number, size: number, color: string, rot = 0) => {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.fillStyle = color;
    g.font = `${size}px "Bradley Hand", "Segoe Print", "Comic Sans MS", cursive`;
    g.fillText(s, 0, 0);
    g.restore();
  };
  hand('Duty roster, week 47', 60, 92, 54, '#1d3f8a', -0.01);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const shifts = ['ON', 'ON', 'POST', 'ON', 'ON', 'POST', 'ON'];
  g.strokeStyle = '#1d3f8a';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(60, 200);
  g.lineTo(960, 202);
  g.stroke();
  days.forEach((d, i) => {
    const x = 70 + i * 128;
    hand(d, x, 180, 36, '#333');
    hand(shifts[i], x, 268, 44, shifts[i] === 'POST' ? '#b02a2a' : '#222', (i % 2 ? 0.02 : -0.02));
  });
  hand('Hours: 36', 70, 380, 50, '#b02a2a', -0.015);
  hand('Leave:', 560, 380, 46, '#333');
  g.strokeStyle = '#555';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(720, 384);
  g.lineTo(940, 386);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const surface = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.18, metalness: 0 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xb4b8bc, roughness: 0.35, metalness: 0.9 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.012), frameMat);
  board.castShadow = board.receiveShadow = true;
  group.add(board);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), surface);
  face.position.z = 0.0062;
  face.receiveShadow = true;
  board.add(face);
  // Frame.
  const f = 0.016;
  for (const [w, h, x, y] of [
    [W + f, f, 0, H / 2],
    [W + f, f, 0, -H / 2],
    [f, H, -W / 2, 0],
    [f, H, W / 2, 0],
  ] as [number, number, number, number][]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), frameMat);
    bar.position.set(x, y, 0.004);
    group.add(bar);
  }
  // Marker tray with two markers.
  const tray = new THREE.Mesh(new THREE.BoxGeometry(W * 0.6, 0.012, 0.04), frameMat);
  tray.position.set(0, -H / 2 - 0.012, 0.02);
  group.add(tray);
  for (const [x, col] of [[-0.06, 0x1d3f8a], [0.04, 0xb02a2a]] as [number, number][]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 12), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }));
    m.rotation.z = Math.PI / 2;
    m.position.set(x, -H / 2 - 0.0, 0.025);
    group.add(m);
  }
  return { group, board, size: new THREE.Vector2(W, H) };
}

// ---------------------------------------------------------------------------------------------
// Side counter: a low laminate cabinet at desk height.

export function createCounter(width: number, depth: number, height: number): THREE.Group {
  const group = new THREE.Group();
  const top = new THREE.Mesh(
    new RoundedBoxGeometry(width, 0.028, depth, 3, 0.005),
    pbrMaterial('white_oak_veneer', { repeat: [1, 0.6], rotation: Math.PI / 2, color: 0xa3927d, normalScale: 0.4, roughnessScale: 0.8 }),
  );
  top.position.y = height - 0.014;
  top.castShadow = top.receiveShadow = true;
  group.add(top);
  const carcassMat = new THREE.MeshStandardMaterial({ color: 0xcfc8bb, roughness: 0.6 });
  const carcass = new THREE.Mesh(new THREE.BoxGeometry(width - 0.02, height - 0.028 - 0.08, depth - 0.03), carcassMat);
  carcass.position.set(0, 0.08 + (height - 0.108) / 2, -0.01);
  carcass.castShadow = carcass.receiveShadow = true;
  group.add(carcass);
  const kick = new THREE.Mesh(new THREE.BoxGeometry(width - 0.06, 0.08, depth - 0.08), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 }));
  kick.position.set(0, 0.04, -0.03);
  group.add(kick);
  // Two doors with a seam and small handles.
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.3, metalness: 0.9 });
  for (const s of [-1, 1]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.003, height - 0.13, 0.002), new THREE.MeshStandardMaterial({ color: 0x8e887d }));
    seam.position.set(0, 0.08 + (height - 0.108) / 2, depth / 2 - 0.024);
    group.add(seam);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.08, 0.012), handleMat);
    h.position.set(s * 0.03, height - 0.12, depth / 2 - 0.018);
    group.add(h);
  }
  return group;
}
