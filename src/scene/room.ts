import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { pbrMaterial } from './textures';
import { createWindow, type NightWindow } from './window';

/**
 * The resident's workstation at 3:47am. Units are metres; +y up, the camera looks toward -z.
 * The desk's back edge touches the back wall, and a wide window sits right behind the monitor.
 */
export const ROOM = {
  wallZ: -0.75, // inner face of the back wall
  wallThickness: 0.16,
  desk: { width: 1.5, depth: 0.72, top: 0.76, thickness: 0.028 },
  window: { left: -0.95, right: 0.95, sill: 0.93, head: 2.1 },
  rightWallX: 1.15,
  leftWallX: -1.35,
};

export interface StaticBox {
  /** Half extents and centre, used to build matching static physics colliders. */
  half: THREE.Vector3;
  center: THREE.Vector3;
}

export interface Room {
  group: THREE.Group;
  window: NightWindow;
  lights: {
    overhead: THREE.SpotLight;
    windowLight: THREE.RectAreaLight;
    ambient: THREE.HemisphereLight;
  };
  colliders: StaticBox[];
  deskCenter: THREE.Vector3;
}

export function createRoom(): Room {
  RectAreaLightUniformsLib.init();
  const group = new THREE.Group();
  const colliders: StaticBox[] = [];
  const { wallZ, wallThickness: wt, desk, window: win } = ROOM;

  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
    opts: { collide?: boolean; cast?: boolean; receive?: boolean; radius?: number } = {},
  ) => {
    const geo = opts.radius ? new RoundedBoxGeometry(w, h, d, 3, opts.radius) : new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = opts.cast ?? false;
    mesh.receiveShadow = opts.receive ?? true;
    group.add(mesh);
    if (opts.collide !== false) {
      colliders.push({ half: new THREE.Vector3(w / 2, h / 2, d / 2), center: new THREE.Vector3(x, y, z) });
    }
    return mesh;
  };

  // --- Materials -----------------------------------------------------------------------------
  const wallMat = pbrMaterial('beige_wall_001', { repeat: [3, 3], color: 0xd9d4cb, normalScale: 0.6 });
  const floorMat = pbrMaterial('terrazzo_tiles', { repeat: [5, 5], color: 0xb8b2a8, normalScale: 0.5, roughnessScale: 0.9 });
  const deskMat = pbrMaterial('white_oak_veneer', { repeat: [1.6, 0.8], rotation: Math.PI / 2, color: 0xa3927d, normalScale: 0.4, roughnessScale: 0.8 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.55 });
  const powderCoat = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.55, metalness: 0.4 });
  const aluminium = new THREE.MeshStandardMaterial({ color: 0x6d7278, roughness: 0.55, metalness: 1.0 });
  const sillMat = new THREE.MeshStandardMaterial({ color: 0xcfcac2, roughness: 0.35 });
  const skirting = new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 0.6 });

  // --- Floor ---------------------------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  colliders.push({ half: new THREE.Vector3(4, 0.05, 4), center: new THREE.Vector3(0, -0.05, 0) });

  // --- Back wall with the window opening (four pieces around the hole) -----------------------
  const wallCz = wallZ - wt / 2;
  const totalW = ROOM.rightWallX - ROOM.leftWallX;
  const wallH = 2.8;
  const cx = (ROOM.rightWallX + ROOM.leftWallX) / 2;
  addBox(totalW, win.sill, wt, cx, win.sill / 2, wallCz, wallMat); // below sill
  addBox(totalW, wallH - win.head, wt, cx, (wallH + win.head) / 2, wallCz, wallMat); // above head
  addBox(win.left - ROOM.leftWallX, win.head - win.sill, wt, (win.left + ROOM.leftWallX) / 2, (win.head + win.sill) / 2, wallCz, wallMat);
  addBox(ROOM.rightWallX - win.right, win.head - win.sill, wt, (win.right + ROOM.rightWallX) / 2, (win.head + win.sill) / 2, wallCz, wallMat);
  addBox(totalW, 0.08, 0.012, cx, 0.04, wallZ + 0.006, skirting, { collide: false });

  // Side walls, mostly lost in darkness but they catch bounce light.
  addBox(wt, wallH, 4, ROOM.rightWallX + wt / 2, wallH / 2, wallZ + 2, wallMat);
  addBox(wt, wallH, 4, ROOM.leftWallX - wt / 2, wallH / 2, wallZ + 2, wallMat);

  // --- Window: sill, aluminium frame, glass with the city behind -----------------------------
  const winW = win.right - win.left;
  const winH = win.head - win.sill;
  const winCx = (win.left + win.right) / 2;
  const winCy = (win.sill + win.head) / 2;
  addBox(winW + 0.06, 0.025, wt + 0.05, winCx, win.sill - 0.0125, wallCz + 0.025, sillMat, { radius: 0.006, cast: true });
  const frameZ = wallZ - wt + 0.05;
  const f = 0.045;
  addBox(winW, f, 0.05, winCx, win.sill + f / 2, frameZ, aluminium, { collide: false });
  addBox(winW, f, 0.05, winCx, win.head - f / 2, frameZ, aluminium, { collide: false });
  addBox(f, winH, 0.05, win.left + f / 2, winCy, frameZ, aluminium, { collide: false });
  addBox(f, winH, 0.05, win.right - f / 2, winCy, frameZ, aluminium, { collide: false });
  addBox(0.035, winH, 0.06, winCx, winCy, frameZ + 0.005, aluminium, { collide: false }); // sliding meeting rail
  addBox(winW, 0.03, 0.05, winCx, win.sill + 0.82, frameZ, aluminium, { collide: false }); // transom
  // Glass is unbreakable: a thin static collider so thrown things bounce off it.
  colliders.push({ half: new THREE.Vector3(winW / 2, winH / 2, 0.01), center: new THREE.Vector3(winCx, winCy, frameZ) });

  const nightWindow = createWindow(winW, winH);
  nightWindow.group.position.set(winCx, winCy, frameZ - 0.03);
  group.add(nightWindow.group);

  // --- Desk ----------------------------------------------------------------------------------
  const deskCz = wallZ + desk.depth / 2 + 0.004;
  const top = addBox(desk.width, desk.thickness, desk.depth, 0, desk.top - desk.thickness / 2, deskCz, deskMat, {
    radius: 0.006,
    cast: true,
  });
  top.receiveShadow = true;
  // Darker edge banding along the front edge.
  addBox(desk.width - 0.004, desk.thickness - 0.004, 0.003, 0, desk.top - desk.thickness / 2, deskCz + desk.depth / 2 + 0.0005, edgeMat, {
    collide: false,
  });
  // Steel panel legs and modesty panel.
  for (const sx of [-1, 1]) {
    addBox(0.04, desk.top - desk.thickness, desk.depth - 0.06, sx * (desk.width / 2 - 0.05), (desk.top - desk.thickness) / 2, deskCz, powderCoat, { cast: true });
  }
  addBox(desk.width - 0.14, 0.32, 0.018, 0, desk.top - desk.thickness - 0.17, wallZ + 0.08, powderCoat, { collide: false });

  // --- Lights --------------------------------------------------------------------------------
  // Warm overhead downlight, slightly in front of the desk, the only shadow caster.
  const overhead = new THREE.SpotLight(0xffc28a, 4.6, 5, 0.29, 0.9, 1.6);
  overhead.position.set(0.18, 2.3, 0.18);
  overhead.target.position.set(-0.02, desk.top, deskCz + 0.12);
  overhead.castShadow = true;
  overhead.shadow.mapSize.set(1024, 1024);
  overhead.shadow.bias = -0.0002;
  overhead.shadow.normalBias = 0.015;
  overhead.shadow.radius = 4;
  overhead.shadow.camera.near = 0.8;
  overhead.shadow.camera.far = 3.2;
  group.add(overhead, overhead.target);

  // Cool city glow coming through the window into the room.
  const windowLight = new THREE.RectAreaLight(0x5f78ad, 0.45, winW, winH);
  windowLight.position.set(winCx, winCy, frameZ + 0.02);
  windowLight.lookAt(winCx, winCy - 0.4, 2);
  group.add(windowLight);

  // A whisper of fill so pure-black areas keep a little shape.
  const ambient = new THREE.HemisphereLight(0x1b2230, 0x0b0907, 0.05);
  group.add(ambient);

  return {
    group,
    window: nightWindow,
    lights: { overhead, windowLight, ambient },
    colliders,
    deskCenter: new THREE.Vector3(0, desk.top, deskCz),
  };
}
