import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Set dressing that makes the desk read as a real workstation: keyboard, mouse, case file,
 * A4 forms. Static for now; they become breakable in milestone 2.
 * Each builder returns a group whose origin sits on the desk surface.
 */

// ---------------------------------------------------------------------------------------------
// Keyboard: full-size office keyboard with individually modelled keycaps (instanced).

export function createKeyboard(): THREE.Group {
  const group = new THREE.Group();
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.55 });
  const keyMat = new THREE.MeshStandardMaterial({ color: 0x232428, roughness: 0.62 });

  const W = 0.44;
  const D = 0.14;
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, 0.016, D, 3, 0.005), caseMat);
  body.position.y = 0.008;
  body.rotation.x = 0.045; // feet raise the back slightly
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  // Key layout in units (1u = 18.5mm pitch). Rows from the back (function row) to the front.
  const u = 0.0185;
  const rows: number[][] = [
    [1, -0.5, 1, 1, 1, 1, -0.5, 1, 1, 1, 1, -0.5, 1, 1, 1, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
    [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
    [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
    [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75],
    [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25],
  ];
  const keyGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
  const placements: THREE.Matrix4[] = [];
  const left = -W / 2 + 0.012;
  rows.forEach((row, ri) => {
    let x = left;
    const z = -D / 2 + 0.016 + ri * u + (ri > 0 ? 0.006 : 0);
    for (const w of row) {
      if (w < 0) {
        x += -w * u;
        continue;
      }
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x + (w * u) / 2, 0.019 + (D / 2 - z) * 0.045, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.045, 0, 0)),
        new THREE.Vector3(w * u - 0.0028, 0.008, u - 0.0028),
      );
      placements.push(m);
      x += w * u;
    }
  });
  // Navigation cluster and numpad.
  const navX = left + 15.25 * u;
  for (let r = 1; r <= 2; r++) for (let c = 0; c < 3; c++) placements.push(keyAt(navX + c * u, r));
  placements.push(keyAt(navX + u, 4), keyAt(navX, 5), keyAt(navX + u, 5), keyAt(navX + 2 * u, 5));
  const padX = left + 18.5 * u;
  for (let r = 1; r <= 5; r++) for (let c = 0; c < 4; c++) if (padX + c * u < W / 2 - 0.01) placements.push(keyAt(padX + c * u, r));

  function keyAt(x: number, row: number): THREE.Matrix4 {
    const z = -D / 2 + 0.016 + row * u + 0.006;
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x + u / 2, 0.019 + (D / 2 - z) * 0.045, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.045, 0, 0)),
      new THREE.Vector3(u - 0.0028, 0.008, u - 0.0028),
    );
  }

  const keys = new THREE.InstancedMesh(keyGeo, keyMat, placements.length);
  placements.forEach((m, i) => keys.setMatrixAt(i, m));
  keys.castShadow = true;
  keys.receiveShadow = true;
  group.add(keys);
  return group;
}

// ---------------------------------------------------------------------------------------------
// Mouse.

export function createMouse(): THREE.Group {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.45 }),
  );
  shell.scale.set(0.03, 0.017, 0.056);
  shell.position.y = 0.0;
  shell.castShadow = true;
  // Keep only the top half visible by sinking it into the desk.
  group.add(shell);
  const wheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0045, 0.0045, 0.004, 16),
    new THREE.MeshStandardMaterial({ color: 0x3a3b40, roughness: 0.8 }),
  );
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(0, 0.0165, -0.026);
  group.add(wheel);
  return group;
}

// ---------------------------------------------------------------------------------------------
// Paper: A4 sheets with a printed form, and a manila case file.

const FONT = `Arial, Helvetica, sans-serif`;

function formTexture(title: string, seed: number): THREE.CanvasTexture {
  const W = 620;
  const H = 877; // A4 ratio
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f2ec';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#2b2b2b';
  g.font = `bold 26px ${FONT}`;
  g.textAlign = 'center';
  g.fillText(title, W / 2, 70);
  g.font = `15px ${FONT}`;
  g.fillStyle = '#555';
  g.fillText('Department of Medicine', W / 2, 98);
  g.strokeStyle = '#333';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(40, 118);
  g.lineTo(W - 40, 118);
  g.stroke();
  const fields = ['IP No.', 'Ward / Bed', 'Date of admission', 'Date of discharge', 'Diagnosis', 'Course in hospital', 'Investigations', 'Advice on discharge', 'Follow-up', 'Signature'];
  g.textAlign = 'left';
  let y = 160;
  fields.forEach((f, i) => {
    g.fillStyle = '#333';
    g.font = `bold 15px ${FONT}`;
    g.fillText(f, 44, y);
    g.strokeStyle = '#9a9a9a';
    g.lineWidth = 1;
    const lines = i >= 4 && i <= 7 ? 3 : 1;
    for (let l = 0; l < lines; l++) {
      g.beginPath();
      g.moveTo(i >= 4 ? 44 : 200, y + 10 + l * 30 + (i >= 4 ? 18 : 0));
      g.lineTo(W - 44, y + 10 + l * 30 + (i >= 4 ? 18 : 0));
      g.stroke();
    }
    y += i >= 4 && i <= 7 ? 116 : 44;
  });
  // A sticky note on some sheets.
  if (seed % 2 === 0) {
    g.save();
    g.translate(W - 170, 150);
    g.rotate(0.06);
    g.fillStyle = '#e8d76a';
    g.fillRect(0, 0, 140, 120);
    g.fillStyle = '#3a3420';
    g.font = `22px "Bradley Hand", "Segoe Print", cursive`;
    g.fillText(seed % 4 === 0 ? 'Sign by 9am' : 'Resubmit', 14, 52);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const paperGeo = new THREE.BoxGeometry(0.21, 0.0004, 0.297);

export function createSheet(title: string, seed: number): THREE.Mesh {
  const face = new THREE.MeshStandardMaterial({ map: formTexture(title, seed), roughness: 0.92 });
  const edge = new THREE.MeshStandardMaterial({ color: 0xe9e6de, roughness: 0.95 });
  // BoxGeometry material order: +x, -x, +y (top), -y, +z, -z.
  const sheet = new THREE.Mesh(paperGeo, [edge, edge, face, edge, edge, edge]);
  sheet.receiveShadow = true;
  sheet.castShadow = true;
  return sheet;
}

export function createPaperStack(count: number, seed: number): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry(seed);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.95 });
  // Body of the stack as one block, top sheet printed.
  const h = count * 0.0001;
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.21, h, 0.297), edgeMat);
  block.position.y = h / 2;
  block.castShadow = block.receiveShadow = true;
  group.add(block);
  for (let i = 0; i < 4; i++) {
    const s = createSheet('DISCHARGE SUMMARY', seed + i);
    s.position.set((rand() - 0.5) * 0.012, h + 0.0004 * (i + 1), (rand() - 0.5) * 0.012);
    s.rotation.y = (rand() - 0.5) * 0.08;
    group.add(s);
  }
  return group;
}

export function createCaseFile(label: string): THREE.Group {
  const group = new THREE.Group();
  const card = new THREE.MeshStandardMaterial({ color: 0xc9a86c, roughness: 0.85 });
  const W = 0.235;
  const D = 0.32;
  const back = new THREE.Mesh(new THREE.BoxGeometry(W, 0.0012, D), card);
  back.position.y = 0.0006;
  back.castShadow = back.receiveShadow = true;
  group.add(back);
  // Papers inside, slightly offset.
  const inner = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.004, 0.297), new THREE.MeshStandardMaterial({ color: 0xebe8e0, roughness: 0.95 }));
  inner.position.set(0.006, 0.0032, 0.004);
  inner.castShadow = true;
  group.add(inner);
  // Front cover with a printed label.
  const c = document.createElement('canvas');
  c.width = 470;
  c.height = 640;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9a86c';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(80,60,30,0.08)';
  for (let i = 0; i < 400; i++) g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
  g.fillStyle = '#f2efe6';
  g.fillRect(90, 120, 290, 110);
  g.strokeStyle = '#6b5a3a';
  g.strokeRect(90, 120, 290, 110);
  g.fillStyle = '#2b2620';
  g.font = `bold 26px ${FONT}`;
  g.textAlign = 'center';
  g.fillText(label, 235, 168);
  g.font = `18px ${FONT}`;
  g.fillText('Urgent (again)', 235, 204);
  const coverTex = new THREE.CanvasTexture(c);
  coverTex.colorSpace = THREE.SRGBColorSpace;
  coverTex.anisotropy = 8;
  const coverMat = new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.85 });
  const front = new THREE.Mesh(new THREE.BoxGeometry(W, 0.0012, D), [card, card, coverMat, card, card, card]);
  front.position.set(0, 0.0064, 0);
  front.rotation.y = 0.02;
  front.castShadow = front.receiveShadow = true;
  group.add(front);
  return group;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
