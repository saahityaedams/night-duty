import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { createScreenUi, type ScreenUi } from './screenUi';

/**
 * A 24-inch office monitor with thin bezels on a stand, plus its screen glow light.
 * Origin at the centre of the stand's base, on the desk surface.
 */
export const MONITOR = {
  panelW: 0.545,
  panelH: 0.322,
  viewW: 0.527,
  viewH: 0.297,
  depth: 0.018,
  screenCenterY: 0.30, // above the desk surface
  tilt: -0.07, // radians, leaning back slightly
};

export interface Monitor {
  group: THREE.Group;
  ui: ScreenUi;
  screenMaterial: THREE.MeshStandardMaterial;
  glow: THREE.RectAreaLight;
  /** Box used for the static collider, in the monitor's local space. */
  collider: { half: THREE.Vector3; center: THREE.Vector3 };
}

export function createMonitor(): Monitor {
  const group = new THREE.Group();
  const plastic = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.42, metalness: 0.0 });
  const plasticMatte = new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.32, metalness: 0.9 });

  // Base.
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.23, 0.012, 0.18, 4, 0.006), metal);
  base.position.y = 0.006;
  base.castShadow = base.receiveShadow = true;
  group.add(base);

  // Neck, angled back.
  const neck = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.24, 0.022, 4, 0.008), plasticMatte);
  neck.position.set(0, 0.13, -0.055);
  neck.rotation.x = -0.12;
  neck.castShadow = true;
  group.add(neck);

  // Panel: tilts around the hinge at the top of the neck.
  const head = new THREE.Group();
  head.position.set(0, MONITOR.screenCenterY, -0.035);
  head.rotation.x = MONITOR.tilt;
  group.add(head);

  const panel = new THREE.Mesh(new RoundedBoxGeometry(MONITOR.panelW, MONITOR.panelH, MONITOR.depth, 4, 0.004), plastic);
  panel.castShadow = true;
  head.add(panel);
  // Rear housing bulge.
  const back = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.2, 0.03, 4, 0.01), plasticMatte);
  back.position.set(0, -0.02, -0.018);
  back.castShadow = true;
  head.add(back);
  // Small chin logo strip and power LED.
  const led = new THREE.Mesh(
    new THREE.CircleGeometry(0.0018, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.2, 2.0), toneMapped: false }),
  );
  led.position.set(MONITOR.panelW / 2 - 0.02, -MONITOR.panelH / 2 + 0.006, MONITOR.depth / 2 + 0.0005);
  head.add(led);

  // Screen: emissive UI behind a slightly glossy surface so it picks up reflections.
  const ui = createScreenUi();
  ui.draw({ pending: 23, clock: '03:47', popups: [] });
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: 0x050607,
    emissive: 0xffffff,
    emissiveMap: ui.texture,
    emissiveIntensity: 0.62,
    roughness: 0.22,
    metalness: 0.0,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(MONITOR.viewW, MONITOR.viewH), screenMaterial);
  screen.position.set(0, (MONITOR.panelH - MONITOR.viewH) / 2 - 0.006, MONITOR.depth / 2 + 0.0004);
  head.add(screen);

  // The screen lights the desk and whatever sits in front of it.
  const glow = new THREE.RectAreaLight(0xcfe0ff, 3.2, MONITOR.viewW, MONITOR.viewH);
  glow.position.copy(screen.position).add(new THREE.Vector3(0, 0, 0.002));
  glow.lookAt(new THREE.Vector3(0, -0.6, 2).add(glow.position));
  head.add(glow);

  return {
    group,
    ui,
    screenMaterial,
    glow,
    collider: {
      half: new THREE.Vector3(MONITOR.panelW / 2, MONITOR.panelH / 2 + 0.04, 0.05),
      center: new THREE.Vector3(0, MONITOR.screenCenterY - 0.03, -0.04),
    },
  };
}
