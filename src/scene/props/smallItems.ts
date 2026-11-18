import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CupDesign } from './cup';

/**
 * Warm-up objects: paper cup, water bottle, glass pen jar with pens, stapler.
 */

// A plain glass tumbler used as a pen jar: thin walls, heavy base, no handle, empty.
export const PEN_JAR: CupDesign = {
  profile: [
    [0.0, 0.006],
    [0.03, 0.006],
    [0.033, 0.0],
    [0.034, 0.004],
    [0.035, 0.05],
    [0.0365, 0.105],
  ],
  thickness: 0.0028,
  handle: false,
  glaze: 0xe8f0ec,
  fill: 0,
};

export const glassJarMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xdfece6,
  roughness: 0.03,
  metalness: 0,
  transparent: true,
  opacity: 0.28,
  clearcoat: 1,
  envMapIntensity: 1.4,
  depthWrite: false,
});
export const glassEdgeMaterial = new THREE.MeshStandardMaterial({ color: 0xa8d8c4, roughness: 0.15, transparent: true, opacity: 0.85 });

/** Pens standing in the jar, as a group (detaches when the jar breaks). */
export function createPens(): THREE.Group {
  const group = new THREE.Group();
  const colours = [0x1f3d8a, 0x111111, 0xb02a2a, 0x1f3d8a, 0xdedede];
  colours.forEach((c, i) => {
    const pen = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.14, 10), new THREE.MeshStandardMaterial({ color: i === 4 ? 0xe8e4da : 0xd8d4c8, roughness: 0.4 }));
    pen.add(barrel);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.04, 10), new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 }));
    cap.position.y = 0.055;
    pen.add(cap);
    const a = (i / colours.length) * Math.PI * 2;
    pen.position.set(Math.cos(a) * 0.014, 0.075, Math.sin(a) * 0.014);
    pen.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18);
    pen.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
    group.add(pen);
  });
  return group;
}

// ---------------------------------------------------------------------------------------------
// Paper cup: thin lathe with a rolled rim. Crumples instead of breaking.

export function createPaperCup(): { group: THREE.Group; mesh: THREE.Mesh; height: number; radius: number } {
  const h = 0.09;
  const pts = [
    new THREE.Vector2(0.0, 0.002),
    new THREE.Vector2(0.025, 0.002),
    new THREE.Vector2(0.026, 0.0),
    new THREE.Vector2(0.0355, h - 0.004),
    new THREE.Vector2(0.0375, h - 0.002),
    new THREE.Vector2(0.0372, h),
    new THREE.Vector2(0.0355, h - 0.0015),
    new THREE.Vector2(0.034, h - 0.006),
    new THREE.Vector2(0.0245, 0.004),
    new THREE.Vector2(0.0, 0.004),
  ];
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f2efe8';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#7a5a3a';
    g.fillRect(0, 50, 512, 10);
    g.fillRect(0, 66, 512, 3);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, side: THREE.DoubleSide }));
  mesh.castShadow = mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return { group, mesh, height: h, radius: 0.034 };
}

/** Crumples a paper cup in place: random dents and a squash, as if fisted. */
export function crumple(mesh: THREE.Mesh, amount: number): void {
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const seed = Math.random() * 100;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const n = Math.sin(a * 5 + seed + y * 60) * 0.5 + Math.sin(a * 11 - seed * 0.7 + y * 140) * 0.5;
    const k = 1 - amount * (0.3 + 0.25 * n);
    pos.setXYZ(i, x * k, y * (1 - amount * 0.35), z * k);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

// ---------------------------------------------------------------------------------------------
// Water bottle: clear PET with a blue cap and some water left.

export function createWaterBottle(): { group: THREE.Group; height: number; radius: number; water: THREE.Mesh } {
  const pts: THREE.Vector2[] = [];
  const H = 0.21;
  const prof: [number, number][] = [
    [0.0, 0.0],
    [0.028, 0.0],
    [0.032, 0.008],
    [0.033, 0.03],
    [0.031, 0.05],
    [0.033, 0.07],
    [0.033, 0.13],
    [0.028, 0.16],
    [0.015, 0.185],
    [0.0125, 0.192],
    [0.0125, 0.2],
  ];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const pet = new THREE.MeshPhysicalMaterial({
    color: 0xd8ecf5,
    roughness: 0.05,
    transparent: true,
    opacity: 0.32,
    clearcoat: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), pet);
  body.castShadow = true;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0145, 0.016, 24), new THREE.MeshStandardMaterial({ color: 0x2a5fb0, roughness: 0.4 }));
  cap.position.y = H - 0.002;
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0334, 0.0334, 0.05, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x3f7fc8, roughness: 0.5, side: THREE.DoubleSide }),
  );
  label.position.y = 0.1;
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(0.031, 0.031, 0.06, 28),
    new THREE.MeshPhysicalMaterial({ color: 0x9cc8e0, roughness: 0.02, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  water.position.y = 0.032;
  const group = new THREE.Group();
  group.add(body, cap, label, water);
  return { group, height: H, radius: 0.033, water };
}

// ---------------------------------------------------------------------------------------------
// Stapler: base, magazine arm, anvil. The arm springs off when it breaks.

export function createStapler(): { group: THREE.Group; arm: THREE.Object3D; half: THREE.Vector3 } {
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.4 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.3, metalness: 0.9 });
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.035, 0.012, 0.15, 2, 0.005), dark);
  base.position.y = 0.006;
  group.add(base);
  const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.002, 0.03), metal);
  anvil.position.set(0, 0.0125, 0.055);
  group.add(anvil);
  const arm = new THREE.Group();
  const top = new THREE.Mesh(new RoundedBoxGeometry(0.032, 0.022, 0.14, 2, 0.008), dark);
  top.position.set(0, 0.011, 0.005);
  arm.add(top);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.01, 0.13), metal);
  mag.position.set(0, -0.002, 0.004);
  arm.add(mag);
  arm.position.set(0, 0.016, -0.004);
  arm.rotation.x = -0.05;
  group.add(arm);
  group.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = o.receiveShadow = true) : null));
  return { group, arm, half: new THREE.Vector3(0.018, 0.02, 0.075) };
}
