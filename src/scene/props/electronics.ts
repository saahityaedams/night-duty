import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Electronics, each built from separate named parts so they can come apart when smashed.
 * All builders return a group with its origin at the centre of its base.
 */

const FONT = `"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

export interface Assembly {
  group: THREE.Group;
  /** Parts that detach as separate pieces when the object breaks. */
  parts: THREE.Object3D[];
  /** Half extents of the overall collision box. */
  half: THREE.Vector3;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const shadowed = <T extends THREE.Object3D>(o: T): T => {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) c.castShadow = c.receiveShadow = true;
  });
  return o;
};

// ---------------------------------------------------------------------------------------------
// Office laser printer.

export function createPrinter(): Assembly & { screen: THREE.CanvasTexture } {
  const W = 0.4;
  const H = 0.26;
  const D = 0.38;
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0xd9d8d2, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.6 });
  const parts: THREE.Object3D[] = [];

  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H - 0.07, D, 3, 0.012), shell);
  body.position.y = 0.07 + (H - 0.07) / 2;
  group.add(body);
  parts.push(body);
  // Paper cassette (tray 2) at the bottom, slightly proud.
  const cassette = new THREE.Mesh(new RoundedBoxGeometry(W - 0.01, 0.07, D - 0.005, 2, 0.006), shell);
  cassette.position.set(0, 0.035, 0.004);
  group.add(cassette);
  parts.push(cassette);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.01), dark);
  grip.position.set(0, 0.045, D / 2 + 0.006);
  cassette.add(grip.clone());
  group.add(grip);
  // Output tray recess on top with a half-ejected sheet.
  const recess = new THREE.Mesh(new THREE.BoxGeometry(W * 0.7, 0.01, D * 0.55), dark);
  recess.position.set(0, H + 0.001, -0.02);
  group.add(recess);
  const sheet = new THREE.Mesh(
    new THREE.BoxGeometry(0.21, 0.0006, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.9 }),
  );
  sheet.position.set(0, H + 0.012, 0.02);
  sheet.rotation.x = -0.12;
  group.add(sheet);
  parts.push(sheet);
  // Control panel with LCD.
  const screen = canvasTexture(256, 96, (g) => {
    g.fillStyle = '#9fb48a';
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = '#1e2a16';
    g.font = `bold 22px ${FONT}`;
    g.fillText('Paper jam in tray 2', 10, 36);
    g.font = `18px ${FONT}`;
    g.fillText('Low toner · 1 of 86', 10, 72);
  });
  const panel = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.025, 0.07, 2, 0.006), dark);
  panel.position.set(W / 2 - 0.09, H + 0.008, D / 2 - 0.05);
  panel.rotation.x = 0.25;
  group.add(panel);
  const lcd = new THREE.Mesh(
    new THREE.PlaneGeometry(0.075, 0.028),
    new THREE.MeshStandardMaterial({ map: screen, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: 0.35, roughness: 0.3 }),
  );
  lcd.rotation.x = -Math.PI / 2;
  lcd.position.set(-0.02, 0.0131, 0);
  panel.add(lcd);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.003, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.5, 0.1), toneMapped: false }));
  led.rotation.x = -Math.PI / 2;
  led.position.set(0.05, 0.0131, 0.01);
  panel.add(led);
  parts.push(panel);
  return { group: shadowed(group), parts, half: new THREE.Vector3(W / 2, H / 2, D / 2), screen };
}

// ---------------------------------------------------------------------------------------------
// Desktop tower.

export function createTower(): Assembly {
  const W = 0.18;
  const H = 0.4;
  const D = 0.38;
  const group = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.5, metalness: 0.2 });
  const panelMat = new THREE.MeshStandardMaterial({ color: 0x232428, roughness: 0.35, metalness: 0.6 });
  const parts: THREE.Object3D[] = [];
  // Internals visible once the side panel is gone.
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.004, H - 0.08, D - 0.08), new THREE.MeshStandardMaterial({ color: 0x1f3d2a, roughness: 0.6 }));
  board.position.set(-W / 2 + 0.02, H / 2, 0);
  group.add(board);
  const psu = new THREE.Mesh(new THREE.BoxGeometry(W - 0.03, 0.08, 0.14), new THREE.MeshStandardMaterial({ color: 0x4a4c50, roughness: 0.4, metalness: 0.7 }));
  psu.position.set(0, H - 0.06, -D / 2 + 0.09);
  group.add(psu);
  parts.push(psu);
  const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.025, 20), new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.6 }));
  fan.rotation.z = Math.PI / 2;
  fan.position.set(-W / 2 + 0.05, H * 0.55, 0.02);
  group.add(fan);
  parts.push(fan);
  // Chassis: back, top, bottom, far side, front (open on the near side).
  const t = 0.008;
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  add(t, H, D, -W / 2 + t / 2, H / 2, 0, black);
  add(W, t, D, 0, H - t / 2, 0, black);
  add(W, t, D, 0, t / 2, 0, black);
  add(W, H, t, 0, H / 2, -D / 2 + t / 2, black);
  // Front bezel with mesh vents, power button and LED.
  const front = new THREE.Mesh(new RoundedBoxGeometry(W, H, 0.02, 3, 0.006), black);
  front.position.set(0, H / 2, D / 2 - 0.01);
  group.add(front);
  parts.push(front);
  const vent = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.04, H * 0.45),
    new THREE.MeshStandardMaterial({
      color: 0x111214,
      roughness: 0.9,
      map: canvasTexture(64, 128, (g) => {
        g.fillStyle = '#2a2b2e';
        g.fillRect(0, 0, 64, 128);
        g.fillStyle = '#0a0a0b';
        for (let y = 0; y < 128; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < 64; x += 6) g.fillRect(x, y, 3, 3);
      }),
    }),
  );
  vent.position.set(0, H * 0.32, 0.0101);
  front.add(vent);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.004, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.9, 2.4), toneMapped: false }));
  led.position.set(0, H * 0.38, 0.0102);
  front.add(led);
  const drive = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.03, 0.003), new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.4 }));
  drive.position.set(0, H * 0.25, 0.0105);
  front.add(drive);
  // Side panel (near side): flies off first.
  const side = new THREE.Mesh(new THREE.BoxGeometry(t, H - 0.01, D - 0.02), panelMat);
  side.position.set(W / 2 - t / 2, H / 2, 0);
  group.add(side);
  parts.push(side);
  return { group: shadowed(group), parts, half: new THREE.Vector3(W / 2, H / 2, D / 2) };
}

// ---------------------------------------------------------------------------------------------
// Her phone, face up, the lock screen full of notifications.

export const PHONE_NOTIFICATIONS = [
  'Roster updated (again)',
  'Roster updated (final)',
  'Roster updated (final v2)',
  'Department group: 112 new messages',
  'Residents group: 38 new messages',
  'Please acknowledge the circular',
  'Reminder: discharge summaries pending',
  'Logbook entries pending: 41',
  'Thesis progress report due Friday',
  'Biometric attendance not recorded',
  'Duty swap request',
  'Mess menu changed',
  'Low battery: 4%',
];

export interface Phone extends Assembly {
  screen: THREE.CanvasTexture;
  screenMaterial: THREE.MeshStandardMaterial;
  draw(unread: number, shown: string[]): void;
}

export function createPhone(): Phone {
  const W = 0.072;
  const L = 0.152;
  const T = 0.0082;
  const group = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b2c30, roughness: 0.3, metalness: 0.8 });
  const back = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.25, metalness: 0.1 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, T, L, 4, 0.0035), frame);
  body.position.y = T / 2;
  group.add(body);
  const backGlass = new THREE.Mesh(new RoundedBoxGeometry(W - 0.002, 0.001, L - 0.002, 2, 0.0004), back);
  backGlass.position.y = 0.0005;
  group.add(backGlass);

  const c = document.createElement('canvas');
  c.width = 360;
  c.height = 760;
  const g = c.getContext('2d')!;
  const screen = new THREE.CanvasTexture(c);
  screen.colorSpace = THREE.SRGBColorSpace;
  screen.anisotropy = 8;
  const draw = (unread: number, shown: string[]) => {
    const bg = g.createLinearGradient(0, 0, 0, 760);
    bg.addColorStop(0, '#1d2433');
    bg.addColorStop(1, '#0c0f16');
    g.fillStyle = bg;
    g.fillRect(0, 0, 360, 760);
    g.fillStyle = '#f2f4f8';
    g.textAlign = 'center';
    g.font = `200 108px ${FONT}`;
    g.fillText('3:47', 180, 200);
    g.font = `400 22px ${FONT}`;
    g.fillStyle = '#c7cdd8';
    g.fillText('Wednesday', 180, 238);
    g.textAlign = 'left';
    shown.slice(-6).forEach((msg, i) => {
      const y = 290 + i * 74;
      g.fillStyle = 'rgba(255,255,255,0.13)';
      g.beginPath();
      g.roundRect(16, y, 328, 64, 16);
      g.fill();
      g.fillStyle = '#e9edf3';
      g.font = `600 17px ${FONT}`;
      g.fillText(msg.length > 30 ? `${msg.slice(0, 29)}…` : msg, 32, y + 28);
      g.fillStyle = '#9aa3b2';
      g.font = `400 14px ${FONT}`;
      g.fillText('now', 32, y + 50);
    });
    // Unread badge.
    g.fillStyle = '#e5484d';
    g.beginPath();
    g.roundRect(250, 30, 92, 40, 20);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `700 22px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(String(unread), 296, 58);
    g.textAlign = 'left';
    screen.needsUpdate = true;
  };
  draw(147, PHONE_NOTIFICATIONS.slice(0, 4));
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: 0x050506,
    emissive: 0xffffff,
    emissiveMap: screen,
    emissiveIntensity: 0.5,
    roughness: 0.12,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.004, L - 0.004), screenMaterial);
  glass.rotation.x = -Math.PI / 2;
  glass.position.y = T + 0.0002;
  group.add(glass);
  return { group: shadowed(group), parts: [glass, backGlass], half: new THREE.Vector3(W / 2, T / 2, L / 2), screen, screenMaterial, draw };
}

// ---------------------------------------------------------------------------------------------
// Bedside alarm clock: red LED digits, stuck at 3:47.

export function createAlarmClock(): Assembly & { digits: THREE.MeshBasicMaterial } {
  const W = 0.13;
  const H = 0.075;
  const D = 0.07;
  const group = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 3, 0.012), new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.45 }));
  body.position.y = H / 2;
  body.rotation.x = -0.12;
  group.add(body);
  const tex = canvasTexture(256, 128, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#ff2a1a';
    g.font = `bold 92px "Courier New", monospace`;
    g.textAlign = 'center';
    g.fillText('3:47', 128, 98);
  });
  const digits = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, H - 0.025), digits);
  face.position.set(0, 0, D / 2 + 0.0005);
  body.add(face);
  const lens = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.016, H - 0.02),
    new THREE.MeshPhysicalMaterial({ color: 0x220000, roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1 }),
  );
  lens.position.set(0, 0, D / 2 + 0.0015);
  body.add(lens);
  return { group: shadowed(group), parts: [lens], half: new THREE.Vector3(W / 2, H / 2, D / 2), digits };
}
