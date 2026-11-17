import * as THREE from 'three';
import { createRenderContext } from './engine/renderer';
import { createPostPipeline } from './engine/post';
import { Physics } from './engine/physics';
import { FrameStats } from './debug/stats';
import { setMaxAnisotropy } from './scene/textures';
import { createRoom, ROOM } from './scene/room';
import { createMonitor } from './scene/props/monitor';
import { createCupMesh, GLAZES, MUG } from './scene/props/cup';
import { frameCamera } from './scene/camera';
import { createKeyboard, createMouse, createPaperStack, createCaseFile, createSheet } from './scene/props/deskItems';
import { createRoomEnvironment } from './scene/environment';

interface TestHooks {
  ready: boolean;
  errors: string[];
  stats(): ReturnType<FrameStats['summary']> & { activeBodies: number; drawCalls: number; triangles: number };
  resetStats(): void;
  /** Simulates a tap at normalized stage coordinates (0..1). Returns true if it hit an object. */
  tap(nx: number, ny: number): boolean;
  /** Positions and speeds of awake bodies, for diagnosing bodies that never settle. */
  awakeBodies(): { p: number[]; v: number[]; w: number[] }[];
}

declare global {
  interface Window {
    __nd: TestHooks;
  }
}

const hooks: TestHooks = {
  ready: false,
  errors: [],
  stats: () => ({ frames: 0, p50: 0, p95: 0, max: 0, activeBodies: 0, drawCalls: 0, triangles: 0 }),
  resetStats: () => {},
  tap: () => false,
  awakeBodies: () => [],
};
window.__nd = hooks;
window.addEventListener('error', (e) => hooks.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => hooks.errors.push(String(e.reason)));

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const stage = document.getElementById('stage') as HTMLElement;
  const ctx = createRenderContext(canvas, stage);
  const { renderer, camera } = ctx;
  setMaxAnisotropy(renderer);
  const physics = await Physics.create();
  const { rapier, world } = physics;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030406);

  // Reflections generated from a proxy of this room's own light sources.
  scene.environment = createRoomEnvironment(renderer);
  scene.environmentIntensity = 0.22;

  // Room, lights and static colliders.
  const room = createRoom();
  scene.add(room.group);
  for (const c of room.colliders) {
    world.createCollider(rapier.ColliderDesc.cuboid(c.half.x, c.half.y, c.half.z).setTranslation(c.center.x, c.center.y, c.center.z));
  }

  // Monitor on the desk, against the window.
  const monitor = createMonitor();
  monitor.group.position.set(0.02, ROOM.desk.top, ROOM.wallZ + 0.19);
  scene.add(monitor.group);
  {
    const c = monitor.collider;
    const p = monitor.group.position;
    world.createCollider(rapier.ColliderDesc.cuboid(c.half.x, c.half.y, c.half.z).setTranslation(p.x + c.center.x, p.y + c.center.y, p.z + c.center.z));
  }

  // Set dressing: keyboard, mouse, case file, forms.
  {
    const top = ROOM.desk.top;
    const add = (o: THREE.Object3D, x: number, z: number, ry: number, y = 0) => {
      o.position.set(x, top + y, z);
      o.rotation.y = ry;
      scene.add(o);
      return o;
    };
    add(createKeyboard(), 0.0, -0.355, 0.03);
    add(createMouse(), 0.285, -0.37, -0.12);
    add(createCaseFile('Ward 4 · Night'), -0.37, -0.53, 0.22);
    add(createPaperStack(60, 7), -0.33, -0.5, 0.32, 0.0075);
    add(createSheet('DISCHARGE SUMMARY', 4), 0.3, -0.0, -0.42, 0.0002);
  }

  // Mugs of cold tea.
  const pickables: THREE.Object3D[] = [];
  const bodyOf = new Map<THREE.Object3D, ReturnType<typeof world.createRigidBody>>();
  const cupSpots: [number, number, number, number][] = [
    // x, z, rotation, glaze index
    [-0.21, -0.19, 2.2, 0],
    [0.23, -0.21, 0.6, 2],
    [0.03, -0.08, -1.0, 1],
  ];
  for (const [x, z, rot, gi] of cupSpots) {
    const cup = createCupMesh(MUG, GLAZES[gi]);
    const y = ROOM.desk.top;
    cup.group.position.set(x, y, z);
    cup.group.rotation.y = rot;
    scene.add(cup.group);
    const q = new THREE.Quaternion().setFromEuler(cup.group.rotation);
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setAngularDamping(0.3)
        .setLinearDamping(0.02),
    );
    // Collider: cylinder for the body, offset so the body origin sits on the mug's base.
    world.createCollider(
      rapier.ColliderDesc.cylinder(0.048, 0.04).setTranslation(0, 0.048, 0).setDensity(1100).setFriction(0.6).setRestitution(0.15),
      body,
    );
    physics.bind(body, cup.group);
    cup.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        pickables.push(o);
        bodyOf.set(o, body);
      }
    });
  }

  // Post-processing and framing.
  const post = createPostPipeline(ctx, scene);
  ctx.onResize(() => frameCamera(camera));

  // Touch: tapping a mug flicks it away (placeholder until the throw system lands).
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tapAt = (nx: number, ny: number): boolean => {
    ndc.set(nx * 2 - 1, -(ny * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (!hit) return false;
    const body = bodyOf.get(hit.object)!;
    const dir = raycaster.ray.direction.clone().setY(0).normalize();
    body.applyImpulse({ x: dir.x * 0.35, y: 0.5, z: dir.z * 0.35 }, true);
    body.applyTorqueImpulse({ x: (Math.random() - 0.5) * 0.004, y: 0, z: (Math.random() - 0.5) * 0.004 }, true);
    return true;
  };
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    tapAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  });

  // Main loop.
  const stats = new FrameStats();
  const timer = new THREE.Timer();
  let last = performance.now();
  renderer.info.autoReset = false;
  renderer.setAnimationLoop(() => {
    renderer.info.reset();
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    stats.push(now - last);
    last = now;
    timer.update();
    physics.step(dt);
    room.window.update(timer.getElapsed());
    post.render(dt);
  });

  hooks.stats = () => ({
    ...stats.summary(),
    activeBodies: physics.activeBodyCount(),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  });
  hooks.resetStats = () => stats.reset();
  hooks.tap = tapAt;
  hooks.awakeBodies = () => {
    const out: { p: number[]; v: number[]; w: number[] }[] = [];
    world.forEachActiveRigidBody((b) => {
      const p = b.translation(),
        v = b.linvel(),
        w = b.angvel();
      out.push({ p: [p.x, p.y, p.z], v: [v.x, v.y, v.z], w: [w.x, w.y, w.z] });
    });
    return out;
  };
  hooks.ready = true;
}

main().catch((err) => {
  hooks.errors.push(String(err?.stack ?? err));
  console.error(err);
});
