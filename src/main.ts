import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { createRenderContext } from './engine/renderer';
import { createPostPipeline } from './engine/post';
import { Physics } from './engine/physics';
import { FrameStats } from './debug/stats';
import { setMaxAnisotropy } from './scene/textures';
import { createRoom, ROOM } from './scene/room';
import { createMonitor } from './scene/props/monitor';
import { createCupMesh, GLAZES, MUG } from './scene/props/cup';
import { CameraRig, SHOTS, type ShotName } from './scene/camera';
import { createMouse, createSheet } from './scene/props/deskItems';
import { createRoomEnvironment } from './scene/environment';
import { PaperStorm } from './fx/paper';
import { createRoomObjects } from './game/objects';
import { PEN_JAR, createPens, glassJarMaterial, glassEdgeMaterial } from './scene/props/smallItems';
import { detachParts } from './game/damage';
import { Particles } from './fx/particles';
import { Breakables } from './game/breakables';
import { Grab } from './game/grab';
import { TimeFx, CameraShake, Haptics } from './game/juice';
import { AudioEngine } from './audio/audio';
import { installMobileBehaviour } from './platform/mobile';

interface TestHooks {
  ready: boolean;
  errors: string[];
  stats(): ReturnType<FrameStats['summary']> & { activeBodies: number; drawCalls: number; triangles: number };
  resetStats(): void;
  /** Quick tap at normalized stage coordinates (0..1). Returns true if it hit an object. */
  tap(nx: number, ny: number): boolean;
  /** Press at (nx0, ny0), drag to (nx1, ny1) over `ms`, release. Returns true if it grabbed something. */
  flick(nx0: number, ny0: number, nx1: number, ny1: number, ms: number): Promise<boolean>;
  /** Breaks every intact mug at once (for screenshots and tests). */
  breakAll(force?: number): number;
  counts(): { intact: number; breaks: number; shards: number };
  audio(): { state: string; loaded: boolean; samples: Record<string, number> };
  /** Sets the window's night-to-dawn grade (0..1), for previews. */
  setDawn(v: number): void;
  /** Moves the camera to a named shot (seconds = 0 cuts). */
  shot(name: string, seconds?: number): void;
  /** Hits a named room object with a force (N), as if struck at its centre. */
  hitObject(name: string, force: number): boolean;
  /** Names of room objects and whether each is broken. */
  objects(): { name: string; broken: boolean }[];
  /** Normalized screen positions (0..1) of intact mugs' centres. */
  mugScreenPositions(): { x: number; y: number }[];
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
  flick: async () => false,
  breakAll: () => 0,
  counts: () => ({ intact: 0, breaks: 0, shards: 0 }),
  mugScreenPositions: () => [],
  audio: () => ({ state: 'none', loaded: false, samples: {} }),
  setDawn: () => {},
  shot: () => {},
  hitObject: () => false,
  objects: () => [],
  awakeBodies: () => [],
};
window.__nd = hooks;
window.addEventListener('error', (e) => hooks.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => hooks.errors.push(String(e.reason)));

/** Maximum physical shards kept in the room; older ones are removed first. */
const MAX_SHARDS = 240;

async function main() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const stage = document.getElementById('stage') as HTMLElement;
  installMobileBehaviour(stage);
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
    world.createCollider(
      rapier.ColliderDesc.cuboid(c.half.x, c.half.y, c.half.z).setTranslation(c.center.x, c.center.y, c.center.z).setFriction(0.7),
    );
  }

  // Monitor on the desk, against the window.
  const monitor = createMonitor();
  monitor.group.position.set(0.02, ROOM.desk.top, ROOM.wallZ + 0.19);
  scene.add(monitor.group);
  for (const c of monitor.colliders.slice(1)) {
    const p = monitor.group.position;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(c.tiltX ?? 0, 0, 0));
    world.createCollider(
      rapier.ColliderDesc.cuboid(c.half.x, c.half.y, c.half.z)
        .setTranslation(p.x + c.center.x, p.y + c.center.y, p.z + c.center.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
  }

  // Set dressing: keyboard, mouse, case file, forms. Static colliders so things land on them.
  {
    const top = ROOM.desk.top;
    const add = (o: THREE.Object3D, x: number, z: number, ry: number, y = 0, half?: [number, number, number]) => {
      o.position.set(x, top + y, z);
      o.rotation.y = ry;
      scene.add(o);
      if (half) {
        const q = new THREE.Quaternion().setFromEuler(o.rotation);
        world.createCollider(
          rapier.ColliderDesc.cuboid(...half)
            .setTranslation(x, top + half[1], z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
        );
      }
      return o;
    };
    add(createMouse(), 0.285, -0.37, -0.12, 0, [0.03, 0.016, 0.056]);
    add(createSheet('DISCHARGE SUMMARY', 4), 0.3, -0.17, -0.42, 0.0002);
  }

  // Particles land on the desk if they're above it, otherwise on the floor.
  const deskZ0 = ROOM.wallZ;
  const deskZ1 = ROOM.wallZ + ROOM.desk.depth;
  const counterX0 = ROOM.desk.width / 2 + 0.02;
  const groundAt = (x: number, z: number, y: number) => {
    const onDesk = Math.abs(x) < ROOM.desk.width / 2 && z > deskZ0 && z < deskZ1 && y >= ROOM.desk.top - 0.02;
    const onCounter = x > counterX0 && x < ROOM.rightWallX && z > deskZ0 && z < deskZ0 + 0.55 && y >= ROOM.desk.top - 0.02;
    return onDesk || onCounter ? ROOM.desk.top : 0;
  };
  const particles = new Particles(groundAt);
  scene.add(particles.group);
  const paper = new PaperStorm(groundAt);
  scene.add(paper.mesh);
  const objects = createRoomObjects({ scene, physics, particles, paper, monitor, monitorPosition: monitor.group.position.clone() });

  const breakables = new Breakables(physics, scene, particles);
  breakables.groundAt = groundAt;

  // --- Mugs ----------------------------------------------------------------------------------
  const pickable = new Map<THREE.Object3D, RAPIER.RigidBody>();
  const appearing: { group: THREE.Group; t: number }[] = [];
  const cupSpots: [number, number, number][] = [
    // x, z, rotation
    [-0.21, -0.19, 2.2],
    [0.23, -0.21, 0.6],
    [0.03, -0.08, -1.0],
  ];
  let round = 0;
  let roundBodies: RAPIER.RigidBody[] = [];

  const spawnMug = (x: number, z: number, rot: number, glaze: THREE.ColorRepresentation, animate: boolean) => {
    const cup = createCupMesh(MUG, glaze);
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
        .setLinearDamping(0.02)
        .setCcdEnabled(true),
    );
    // Body collider: cylinder offset so the body origin sits on the mug's base. Handle: a small box.
    const col = world.createCollider(
      rapier.ColliderDesc.cylinder(0.048, 0.04).setTranslation(0, 0.048, 0).setDensity(1100).setFriction(0.6).setRestitution(0.15),
      body,
    );
    world.createCollider(rapier.ColliderDesc.cuboid(0.012, 0.03, 0.005).setTranslation(0.058, 0.05, 0).setDensity(1100), body);
    physics.bind(body, cup.group);
    breakables.addMug(cup.group, body, col, MUG, cup.profile, cup.glaze);
    roundBodies.push(body);
    cup.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) pickable.set(o, body);
    });
    if (animate) {
      cup.group.scale.setScalar(0.001);
      appearing.push({ group: cup.group, t: 0 });
    }
  };

  const spawnRound = (animate: boolean) => {
    roundBodies = [];
    // Debris lying where a mug will appear would overlap its collider and jitter forever.
    for (const [x, z] of cupSpots) breakables.clearArea(x, z, 0.09);
    cupSpots.forEach(([x, z, rot], i) => spawnMug(x, z, rot + round * 0.7, GLAZES[(i + round * 2) % GLAZES.length], animate));
    round++;
  };
  spawnRound(false);

  // Glass pen jar: shatters like a mug, in glass, and the pens scatter.
  {
    const jar = createCupMesh(PEN_JAR);
    jar.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = glassJarMaterial;
    });
    const pens = createPens();
    jar.group.add(pens);
    const x = -0.17;
    const z = -0.64;
    jar.group.position.set(x, ROOM.desk.top, z);
    scene.add(jar.group);
    const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(x, ROOM.desk.top, z).setCcdEnabled(true).setAngularDamping(0.3));
    const col = world.createCollider(
      rapier.ColliderDesc.cylinder(0.053, 0.036).setTranslation(0, 0.053, 0).setDensity(1800).setFriction(0.5).setRestitution(0.1),
      body,
    );
    physics.bind(body, jar.group);
    breakables.addMug(jar.group, body, col, PEN_JAR, jar.profile, glassJarMaterial, {
      edge: glassEdgeMaterial,
      strength: 26,
      onBroken: (impact) => detachParts(physics, scene, [...pens.children], impact, { burst: 1.4, density: 900, spin: 14 }),
    });
    jar.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) pickable.set(o, body);
    });
  }

  // --- Feel, audio, input ----------------------------------------------------------------------
  const timefx = new TimeFx();
  const shake = new CameraShake(camera);
  const haptics = new Haptics();
  const audio = new AudioEngine();
  stage.addEventListener('pointerdown', () => audio.unlock(), { capture: true });

  const panOf = (p: THREE.Vector3) => p.clone().project(camera).x;

  let respawnAt = 0;
  breakables.onBreak((e) => {
    for (const [mesh, body] of pickable) if (!breakables.isIntact(body)) pickable.delete(mesh);
    audio.breakMug(e.severity, panOf(e.position));
    timefx.hitStop(35 + e.severity * 55);
    if (e.severity > 0.55) timefx.slowMo(0.3, 420 + e.severity * 300);
    shake.add(0.22 + e.severity * 0.5);
    haptics.tick(0.5 + e.severity * 0.5);
    breakables.trimShards(MAX_SHARDS);
    if (roundBodies.every((b) => !breakables.isIntact(b))) respawnAt = performance.now() + 2200;
  });
  breakables.onShardHit((e) => {
    if (e.intact) audio.knock(e.force, panOf(e.position));
    else audio.clink(e.force, panOf(e.position));
  });

  objects.onEvent((e) => {
    const pan = panOf(e.point);
    if (e.kind === 'break') {
      const sev = Math.min(1, e.force / 200);
      timefx.hitStop(45 + sev * 50);
      if (e.name === 'monitor' || e.name === 'printer' || e.name === 'locker') timefx.slowMo(0.35, 600);
      shake.add(0.3 + sev * 0.45);
      haptics.tick(0.7 + sev * 0.3);
      audio.breakObject(e.material, sev, pan);
    } else {
      shake.add(e.kind === 'stage' ? 0.22 : 0.08);
      haptics.tick(e.kind === 'stage' ? 0.5 : 0.25);
      audio.hitObject(e.material, Math.min(1, e.force / 150), pan);
    }
  });

  const grab = new Grab({
    physics,
    camera,
    element: canvas,
    pickable: () => new Map([...pickable, ...objects.grabbable]),
    minHeight: ROOM.desk.top + 0.03,
    onGrab: () => haptics.tick(0.2),
    // Steer toward whatever the camera is showing: the monitor, the locker, or the printer.
    aimTarget: () =>
      rig.current === 'left'
        ? new THREE.Vector3(-1.04, 0, ROOM.wallZ + 0.2)
        : rig.current === 'right'
          ? new THREE.Vector3(1.07, 0, ROOM.wallZ + 0.24)
          : new THREE.Vector3(monitor.group.position.x, 0, monitor.group.position.z),
  });

  // Post-processing and framing.
  const post = createPostPipeline(ctx, scene);
  const rig = new CameraRig(camera);
  const shotParam = new URLSearchParams(location.search).get('shot');
  if (shotParam && shotParam in SHOTS) rig.go(shotParam as ShotName, 0);
  ctx.onResize(() => rig.refresh());

  // --- Main loop -----------------------------------------------------------------------------
  const stats = new FrameStats();
  const timer = new THREE.Timer();
  let last = performance.now();
  renderer.info.autoReset = false;
  renderer.setAnimationLoop(() => {
    renderer.info.reset();
    const now = performance.now();
    const realDt = Math.min((now - last) / 1000, 0.1);
    stats.push(now - last);
    last = now;
    timer.update();
    const dt = timefx.scale(realDt, now);

    grab.update();
    physics.step(dt);
    breakables.flush();
    breakables.update(dt);
    objects.update(dt, timer.getElapsed());
    particles.update(dt);
    paper.update(dt, timer.getElapsed());

    for (let i = appearing.length - 1; i >= 0; i--) {
      const a = appearing[i];
      a.t += realDt / 0.45;
      const k = Math.min(1, a.t);
      // Ease out with a small overshoot.
      const s = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
      a.group.scale.setScalar(Math.max(0.001, s));
      if (k >= 1) {
        a.group.scale.setScalar(1);
        appearing.splice(i, 1);
      }
    }
    if (respawnAt && now > respawnAt) {
      respawnAt = 0;
      spawnRound(true);
    }

    rig.update(realDt);
    shake.captureBase();
    shake.update(realDt);
    room.window.update(timer.getElapsed());
    post.render(realDt);
  });

  // --- Test hooks ----------------------------------------------------------------------------
  const toClient = (nx: number, ny: number) => {
    const r = canvas.getBoundingClientRect();
    return { x: r.left + nx * r.width, y: r.top + ny * r.height };
  };
  hooks.stats = () => ({
    ...stats.summary(),
    activeBodies: physics.activeBodyCount(),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  });
  hooks.resetStats = () => stats.reset();
  hooks.tap = (nx, ny) => {
    const p = toClient(nx, ny);
    const t = performance.now();
    if (!grab.down(999, p.x, p.y, t)) return false;
    grab.up(p.x, p.y, t + 60);
    return true;
  };
  hooks.flick = async (nx0, ny0, nx1, ny1, ms) => {
    const a = toClient(nx0, ny0);
    const b = toClient(nx1, ny1);
    const t0 = performance.now();
    if (!grab.down(998, a.x, a.y, t0)) return false;
    // Hold briefly, then drag along the path at frame rate.
    await new Promise((r) => setTimeout(r, 120));
    const steps = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const k = i / steps;
      grab.move(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, performance.now());
    }
    grab.up(b.x, b.y, performance.now());
    return true;
  };
  hooks.breakAll = (force = 160) => {
    let n = 0;
    for (const body of new Set(pickable.values())) if (breakables.breakBody(body, force)) n++;
    return n;
  };
  hooks.counts = () => ({ intact: breakables.intactCount, breaks: breakables.breaks, shards: breakables.shardCount });
  hooks.audio = () => audio.info();
  hooks.setDawn = (v) => room.window.setDawn(v);
  hooks.hitObject = (name, force) => {
    const t = objects.targets.find((x) => x.name === name);
    if (!t || objects.damage.isBroken(t)) return false;
    // Some colliders are removed as an object comes apart (a door tears off); use one that's left.
    const alive = t.colliders.find((col) => world.getCollider(col.handle) === col) ?? null;
    if (!alive) return false;
    const c = alive.translation();
    objects.damage.apply(t, new THREE.Vector3(c.x + (Math.random() - 0.5) * 0.04, c.y + (Math.random() - 0.5) * 0.04, c.z + 0.05), force);
    return true;
  };
  hooks.objects = () => objects.targets.map((t) => ({ name: t.name, broken: objects.damage.isBroken(t) }));
  hooks.shot = (name, seconds = 0) => {
    if (name in SHOTS) rig.go(name as ShotName, seconds);
  };
  hooks.mugScreenPositions = () => {
    const out: { x: number; y: number }[] = [];
    for (const body of new Set(pickable.values())) {
      if (!breakables.isIntact(body)) continue;
      const t = body.translation();
      const v = new THREE.Vector3(t.x, t.y + 0.05, t.z).project(camera);
      out.push({ x: (v.x + 1) / 2, y: (1 - v.y) / 2 });
    }
    return out;
  };
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
  (window as unknown as { __ndScene: THREE.Scene }).__ndScene = scene;
  hooks.ready = true;
}

main().catch((err) => {
  hooks.errors.push(String(err?.stack ?? err));
  console.error(err);
});
