import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../engine/physics';
import { Damage, detachParts, type DamageTarget, type HitInfo, type MaterialKind } from './damage';
import type { Particles } from '../fx/particles';
import type { PaperStorm } from '../fx/paper';
import { createCrackOverlay } from '../fx/cracks';
import { fracturePlane } from '../fracture/planar';
import { ROOM } from '../scene/room';
import { MONITOR, type Monitor } from '../scene/props/monitor';
import { createPhone, createAlarmClock, createTower, createPrinter, PHONE_NOTIFICATIONS } from '../scene/props/electronics';
import { createLocker, createWhiteboard } from '../scene/props/furniture';
import { createKeyboard, createCaseFile, createPaperStack } from '../scene/props/deskItems';
import { createPaperCup, crumple, createWaterBottle, createStapler } from '../scene/props/smallItems';

/**
 * The room's breakable objects (everything except the mugs), wired to the damage system.
 */

export const MONITOR_POPUPS = [
  'Session expired. Please log in again.',
  'Mandatory field missing',
  'Password must be changed.',
  'Are you sure you want to cancel?',
  'Changes not saved',
  'Form timed out',
  'Please fill all fields marked *',
  'Your session will expire in 00:59',
  'Update available. Restart now?',
  'Printer not found',
  '(Not responding)',
];

export interface ObjectEvent {
  name: string;
  material: MaterialKind;
  point: THREE.Vector3;
  force: number;
  /** 'hit' for damage that didn't break it, 'stage' for visible damage, 'break' when it gives. */
  kind: 'hit' | 'stage' | 'break';
}

export interface RoomObjects {
  damage: Damage;
  targets: DamageTarget[];
  /** Grabbable dynamic objects (phone, clock), mesh → body. */
  grabbable: Map<THREE.Object3D, RAPIER.RigidBody>;
  monitorTarget: DamageTarget;
  onEvent(cb: (e: ObjectEvent) => void): void;
  update(dt: number, time: number): void;
}

interface Env {
  scene: THREE.Scene;
  physics: Physics;
  particles: Particles;
  paper: PaperStorm;
  monitor: Monitor;
  monitorPosition: THREE.Vector3;
}

const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xdfe8ee, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.35, clearcoat: 1 });
const glassEdge = new THREE.MeshStandardMaterial({ color: 0x9fd0c0, roughness: 0.2, transparent: true, opacity: 0.8 });
const darkGlass = new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.08 });

export function createRoomObjects(env: Env): RoomObjects {
  const { scene, physics, particles, paper } = env;
  const { rapier, world } = physics;
  const damage = new Damage(physics);
  const targets: DamageTarget[] = [];
  const grabbable = new Map<THREE.Object3D, RAPIER.RigidBody>();
  const listeners: ((e: ObjectEvent) => void)[] = [];
  const emit = (e: ObjectEvent) => listeners.forEach((cb) => cb(e));
  const top = ROOM.desk.top;
  const updaters: ((dt: number, time: number) => void)[] = [];

  const reg = (t: DamageTarget) => {
    const wrapped: DamageTarget = {
      ...t,
      onHit: (hit, self) => {
        t.onHit?.(hit, self);
        emit({ name: t.name, material: t.material, point: hit.point, force: hit.force, kind: 'hit' });
      },
      onStage: (stage, hit, self) => {
        t.onStage?.(stage, hit, self);
        emit({ name: t.name, material: t.material, point: hit.point, force: hit.force, kind: 'stage' });
      },
      onBreak: (hit, self) => {
        t.onBreak(hit, self);
        emit({ name: t.name, material: t.material, point: hit.point, force: hit.force, kind: 'break' });
      },
    };
    const live = damage.register(wrapped);
    targets.push(live);
    return live;
  };

  const staticBox = (half: THREE.Vector3, pos: THREE.Vector3, rotY = 0) =>
    world.createCollider(
      rapier.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0))),
    );

  const dynamicBody = (group: THREE.Group, half: THREE.Vector3, density: number, offsetY: number) => {
    const p = group.position;
    const q = group.quaternion;
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCcdEnabled(true)
        .setAngularDamping(0.3),
    );
    const col = world.createCollider(
      rapier.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(0, offsetY, 0).setDensity(density).setFriction(0.6).setRestitution(0.2),
      body,
    );
    physics.bind(body, group);
    return { body, col };
  };

  /** Shatters a flat pane (in its mesh's local XY plane) into physical shards. */
  const shatterPane = (pane: THREE.Mesh, w: number, h: number, thickness: number, hit: HitInfo, pieces: number, mats: THREE.Material[], withUv = false) => {
    pane.updateMatrixWorld(true);
    const local = pane.worldToLocal(hit.point.clone());
    const shards = fracturePlane({
      width: w,
      height: h,
      thickness,
      pieces,
      impactU: THREE.MathUtils.clamp(local.x / w + 0.5, 0, 1),
      impactV: THREE.MathUtils.clamp(local.y / h + 0.5, 0, 1),
      focus: 0.8,
      rng: Math.random,
      uv: withUv,
    });
    const q = pane.getWorldQuaternion(new THREE.Quaternion());
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    for (const s of shards) {
      const mesh = new THREE.Mesh(s.geometry, mats);
      const wp = s.centroid.clone().applyMatrix4(pane.matrixWorld);
      mesh.position.copy(wp);
      mesh.quaternion.copy(q);
      mesh.castShadow = true;
      scene.add(mesh);
      const away = wp.clone().sub(hit.point).normalize();
      const v = normal.clone().multiplyScalar(0.6 + Math.random() * 1.2).addScaledVector(away, 0.5 + Math.random());
      const rb = world.createRigidBody(
        rapier.RigidBodyDesc.dynamic()
          .setTranslation(wp.x, wp.y, wp.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinvel(v.x, v.y, v.z)
          .setAngvel({ x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 20, z: (Math.random() - 0.5) * 20 })
          .setCcdEnabled(true),
      );
      const desc = rapier.ColliderDesc.convexHull(s.hull) ?? rapier.ColliderDesc.ball(0.005);
      world.createCollider(desc.setMass(Math.max(0.001, s.volume * 2500)).setFriction(0.5).setRestitution(0.15), rb);
      physics.bind(rb, mesh);
    }
    pane.visible = false;
  };

  const sparks = (at: THREE.Vector3, n: number) => particles.chipsBurst(at, new THREE.Vector3(), n, new THREE.Color(1.0, 0.75, 0.35), Math.random);

  // ---------------------------------------------------------------------------------------------
  // Phone (grabbable).
  {
    const phone = createPhone();
    phone.group.position.set(0.13, top + 0.0004, -0.03);
    phone.group.rotation.y = 0.25;
    scene.add(phone.group);
    const { body, col } = dynamicBody(phone.group, phone.half, 2600, phone.half.y);
    phone.group.traverse((o) => (o as THREE.Mesh).isMesh && grabbable.set(o, body));
    const glass = phone.parts[0] as THREE.Mesh;
    const cracks = createCrackOverlay(0.068, 0.148, { px: 512 });
    cracks.mesh.rotation.x = -Math.PI / 2;
    cracks.mesh.position.y = 0.0084;
    phone.group.add(cracks.mesh);
    let unread = 147;
    const shown = PHONE_NOTIFICATIONS.slice(0, 4);
    let nextNote = 2.5;
    let alive = true;
    updaters.push((_dt, time) => {
      if (!alive || time < nextNote) return;
      nextNote = time + 3 + Math.random() * 4;
      unread += 1 + Math.floor(Math.random() * 4);
      shown.push(PHONE_NOTIFICATIONS[(shown.length + 3) % PHONE_NOTIFICATIONS.length]);
      phone.draw(unread, shown);
    });
    const localUv = (p: THREE.Vector3) => {
      const l = phone.group.worldToLocal(p.clone());
      return [THREE.MathUtils.clamp(l.x / 0.068 + 0.5, 0, 1), THREE.MathUtils.clamp(-l.z / 0.148 + 0.5, 0, 1)] as const;
    };
    reg({
      name: 'phone',
      colliders: [col],
      health: 90,
      armour: 10,
      stages: [0.6, 0.3],
      material: 'glass',
      onHit: (hit) => {
        const [u, v] = localUv(hit.point);
        cracks.impact(u, v, Math.min(1, hit.damage / 60));
        phone.screenMaterial.emissiveIntensity = 0.5 * (1 - cracks.damage * 0.5);
      },
      onBreak: (hit) => {
        alive = false;
        phone.screenMaterial.emissiveIntensity = 0;
        cracks.mesh.visible = false;
        shatterPane(glass, 0.068, 0.148, 0.0012, hit, 10, [darkGlass, glassEdge]);
        sparks(hit.point, 12);
        grabbable.forEach((b, m) => b === body && grabbable.delete(m));
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Alarm clock (grabbable).
  {
    const clock = createAlarmClock();
    clock.group.position.set(0.29, top, -0.63);
    clock.group.rotation.y = -0.35;
    scene.add(clock.group);
    const { body, col } = dynamicBody(clock.group, clock.half, 700, clock.half.y);
    clock.group.traverse((o) => (o as THREE.Mesh).isMesh && grabbable.set(o, body));
    const lens = clock.parts[0] as THREE.Mesh;
    const cracks = createCrackOverlay(0.114, 0.055, { px: 512 });
    cracks.mesh.position.set(0, 0, 0.0004);
    lens.add(cracks.mesh);
    // The LED digits blink, as the doc says.
    let blinkOn = true;
    updaters.push((_dt, time) => {
      const on = Math.floor(time * 1.6) % 2 === 0;
      if (on !== blinkOn && clock.digits.opacity !== 0) {
        blinkOn = on;
        clock.digits.color.setScalar(on ? 1.6 : 0.25);
      }
    });
    reg({
      name: 'clock',
      colliders: [col],
      health: 50,
      armour: 9,
      stages: [0.5],
      material: 'glass',
      onHit: (hit) => {
        const l = lens.worldToLocal(hit.point.clone());
        cracks.impact(THREE.MathUtils.clamp(l.x / 0.114 + 0.5, 0, 1), THREE.MathUtils.clamp(l.y / 0.055 + 0.5, 0, 1), Math.min(1, hit.damage / 40));
      },
      onBreak: (hit) => {
        clock.digits.opacity = 0;
        clock.digits.transparent = true;
        cracks.mesh.visible = false;
        shatterPane(lens, 0.114, 0.055, 0.002, hit, 8, [glassMat, glassEdge]);
        grabbable.forEach((b, m) => b === body && grabbable.delete(m));
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Desktop tower: heavy, can topple; comes apart in stages.
  {
    const tower = createTower();
    tower.group.position.set(-0.6, top, -0.55);
    scene.add(tower.group);
    const { col } = dynamicBody(tower.group, tower.half, 260, tower.half.y);
    const [psu, fan, front, side] = tower.parts;
    reg({
      name: 'tower',
      colliders: [col],
      health: 220,
      armour: 14,
      stages: [0.66, 0.33],
      material: 'electronics',
      onStage: (stage, hit) => {
        detachParts(physics, scene, [stage === 0 ? side : front], hit.point, { burst: 1.6, density: 1500, direction: stage === 0 ? new THREE.Vector3(1, 0.3, 0.2) : new THREE.Vector3(0, 0.3, 1) });
        sparks(hit.point, 10);
      },
      onBreak: (hit) => {
        detachParts(physics, scene, [psu, fan], hit.point, { burst: 2.2, density: 1200 });
        sparks(hit.point, 30);
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Printer on the side counter.
  {
    const printer = createPrinter();
    const counterX = (ROOM.desk.width / 2 + 0.02 + ROOM.rightWallX) / 2;
    const pos = new THREE.Vector3(counterX, top, ROOM.wallZ + 0.24);
    printer.group.position.copy(pos);
    printer.group.rotation.y = -0.15;
    scene.add(printer.group);
    const col = staticBox(printer.half, pos.clone().setY(top + printer.half.y), -0.15);
    const [body, cassette, sheet, panel] = printer.parts;
    const outlet = () => printer.group.localToWorld(new THREE.Vector3(0, 0.27, 0.05));
    reg({
      name: 'printer',
      colliders: [col],
      health: 240,
      armour: 14,
      stages: [0.66, 0.33],
      material: 'plastic',
      onStage: (stage, hit) => {
        if (stage === 0) {
          detachParts(physics, scene, [cassette], hit.point, { burst: 1.2, density: 600, direction: new THREE.Vector3(-0.15, 0.1, 1) });
          paper.burst(printer.group.localToWorld(new THREE.Vector3(0, 0.05, 0.2)), new THREE.Vector3(0, 0, 1), 25, 1.2);
        } else {
          detachParts(physics, scene, [panel, sheet], hit.point, { burst: 1.5, density: 600, direction: new THREE.Vector3(0, 1, 0.6) });
          paper.burst(outlet(), new THREE.Vector3(0, 1, 0), 30);
        }
      },
      onBreak: (hit) => {
        world.removeCollider(col, true);
        detachParts(physics, scene, [body], hit.point, { burst: 1.4, density: 300 });
        paper.burst(outlet(), new THREE.Vector3(0, 1.5, 0), 86, 2.2);
        sparks(hit.point, 14);
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Paperwork: case file and form stacks burst into paper.
  {
    const paperwork: [THREE.Group, number, number, number, number, THREE.Vector3][] = [
      [createCaseFile('Ward 4 · Night'), -0.37, -0.53, 0.22, 0, new THREE.Vector3(0.117, 0.006, 0.16)],
      [createPaperStack(60, 7), -0.33, -0.5, 0.32, 0.0075, new THREE.Vector3(0.105, 0.006, 0.15)],
      [createCaseFile('Discharge summaries'), -0.2, -0.62, -0.05, 0.0002, new THREE.Vector3(0.117, 0.006, 0.16)],
    ];
    paperwork.forEach(([group, x, z, ry, y, half], i) => {
      group.position.set(x, top + y, z);
      group.rotation.y = ry;
      scene.add(group);
      const col = staticBox(half, new THREE.Vector3(x, top + half.y + y, z), ry);
      reg({
        name: `paperwork-${i}`,
        colliders: [col],
        health: 12,
        armour: 5,
        material: 'paper',
        onBreak: (hit) => {
          world.removeCollider(col, true);
          scene.remove(group);
          paper.burst(new THREE.Vector3(x, top + 0.03, z), hit.point.clone().sub(new THREE.Vector3(x, top, z)).setY(0.6).normalize(), 40, 1.8);
        },
      });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Keyboard: keys burst.
  {
    const kb = createKeyboard();
    kb.position.set(0, top, -0.355);
    kb.rotation.y = 0.03;
    scene.add(kb);
    const col = staticBox(new THREE.Vector3(0.22, 0.012, 0.07), new THREE.Vector3(0, top + 0.012, -0.355), 0.03);
    reg({
      name: 'keyboard',
      colliders: [col],
      health: 70,
      armour: 10,
      material: 'plastic',
      onBreak: (hit) => {
        world.removeCollider(col, true);
        const keys = kb.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh);
        if (keys) keys.visible = false;
        particles.chipsBurst(hit.point.clone().setY(top + 0.025), new THREE.Vector3(0, 1.5, 0), 90, new THREE.Color(0x232428), Math.random);
        detachParts(physics, scene, [kb.children[0]], hit.point, { burst: 0.8, density: 500 });
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Locker: doors tear off.
  {
    const locker = createLocker();
    const lp = new THREE.Vector3(-1.04, 0, ROOM.wallZ + locker.size.z / 2 + 0.01);
    locker.group.position.copy(lp);
    scene.add(locker.group);
    staticBox(new THREE.Vector3(locker.size.x / 2, locker.size.y / 2, locker.size.z / 2 - 0.01), lp.clone().setY(locker.size.y / 2));
    // Separate colliders over each door so hits register on the doors.
    const doorCols = locker.doors.map((d) => {
      const p = d.getWorldPosition(new THREE.Vector3());
      return staticBox(new THREE.Vector3(0.15, 0.86, 0.012), p);
    });
    reg({
      name: 'locker',
      colliders: doorCols,
      health: 320,
      armour: 18,
      stages: [0.5],
      material: 'metal',
      onStage: (_s, hit) => {
        world.removeCollider(doorCols[0], true);
        detachParts(physics, scene, [locker.doors[0]], hit.point, { burst: 1.6, density: 1200, spin: 2, direction: new THREE.Vector3(-0.3, 0.2, 1), angular: new THREE.Vector3(0, 3, 0) });
      },
      onBreak: (hit) => {
        world.removeCollider(doorCols[1], true);
        detachParts(physics, scene, [locker.doors[1]], hit.point, { burst: 2, density: 1200, spin: 2, direction: new THREE.Vector3(0.3, 0.2, 1), angular: new THREE.Vector3(0, -3.5, 0) });
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Roster whiteboard: cracks, then snaps off the wall.
  {
    const board = createWhiteboard();
    const counterX = (ROOM.desk.width / 2 + 0.02 + ROOM.rightWallX) / 2;
    board.group.position.set(counterX, 1.42, ROOM.wallZ + 0.012);
    scene.add(board.group);
    const col = staticBox(new THREE.Vector3(board.size.x / 2, board.size.y / 2, 0.012), board.group.position.clone());
    const cracks = createCrackOverlay(board.size.x, board.size.y, { px: 768, tint: 'rgba(40,40,46,0.85)', edge: 'rgba(255,255,255,0.5)' });
    cracks.mesh.position.z = 0.0075;
    board.group.add(cracks.mesh);
    reg({
      name: 'whiteboard',
      colliders: [col],
      health: 140,
      armour: 12,
      material: 'plastic',
      onHit: (hit) => {
        const l = board.group.worldToLocal(hit.point.clone());
        cracks.impact(l.x / board.size.x + 0.5, l.y / board.size.y + 0.5, Math.min(1, hit.damage / 70));
      },
      onBreak: (hit) => {
        world.removeCollider(col, true);
        detachParts(physics, scene, [board.group], hit.point, { burst: 0.9, density: 500, spin: 2, direction: new THREE.Vector3(0, -0.2, 1) });
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Paper cups: crumple further with every hit; never break, always throwable.
  ([[-0.06, -0.19, 0.4], [0.34, -0.46, 1.9]] as [number, number, number][]).forEach(([x, z, ry], i) => {
    const cup = createPaperCup();
    cup.group.position.set(x, top, z);
    cup.group.rotation.y = ry;
    scene.add(cup.group);
    const { body, col } = dynamicBody(cup.group, new THREE.Vector3(cup.radius, cup.height / 2, cup.radius), 60, cup.height / 2);
    grabbable.set(cup.mesh, body);
    let crumpled = 0;
    reg({
      name: `paper-cup-${i}`,
      colliders: [col],
      health: 1e9,
      armour: 3,
      material: 'paper',
      onHit: (hit) => {
        const amount = Math.min(0.6 - crumpled, 0.15 + hit.damage / 60);
        if (amount > 0.02) {
          crumple(cup.mesh, amount);
          crumpled += amount;
        }
      },
      onBreak: () => {},
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Water bottle: dents, then bursts and sprays.
  {
    const bottle = createWaterBottle();
    bottle.group.position.set(-0.33, top, -0.36);
    scene.add(bottle.group);
    const { body, col } = dynamicBody(bottle.group, new THREE.Vector3(bottle.radius, bottle.height / 2, bottle.radius), 350, bottle.height / 2);
    bottle.group.traverse((o) => (o as THREE.Mesh).isMesh && grabbable.set(o, body));
    let dent = 0;
    reg({
      name: 'bottle',
      colliders: [col],
      health: 45,
      armour: 7,
      material: 'plastic',
      onHit: (hit) => {
        dent = Math.min(0.35, dent + hit.damage / 160);
        bottle.group.children[0].scale.set(1 - dent, 1, 1 + dent * 0.3);
      },
      onBreak: (hit) => {
        bottle.water.visible = false;
        bottle.group.children[0].scale.set(0.6, 0.92, 1.2);
        particles.splash(bottle.group.localToWorld(new THREE.Vector3(0, 0.04, 0)), new THREE.Vector3().subVectors(bottle.group.position, hit.point).setY(0.8).normalize().multiplyScalar(1.5), 120, Math.random, true);
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Stapler: the arm springs off and staples scatter.
  {
    const st = createStapler();
    st.group.position.set(0.27, top, -0.5);
    st.group.rotation.y = 0.45;
    scene.add(st.group);
    const { body, col } = dynamicBody(st.group, st.half, 2200, st.half.y);
    st.group.traverse((o) => (o as THREE.Mesh).isMesh && grabbable.set(o, body));
    reg({
      name: 'stapler',
      colliders: [col],
      health: 50,
      armour: 9,
      material: 'metal',
      onBreak: (hit) => {
        detachParts(physics, scene, [st.arm], hit.point, { burst: 1.6, density: 2000, spin: 16, direction: new THREE.Vector3(0, 1, 0) });
        particles.chipsBurst(hit.point, new THREE.Vector3(0, 1, 0), 24, new THREE.Color(0xb8bcc2), Math.random);
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Monitor: cracks and pop-ups build with each hit; the glass finally shatters.
  const monitorTarget = (() => {
    const { monitor, monitorPosition } = env;
    const cols = [
      staticBox(new THREE.Vector3(MONITOR.panelW / 2, MONITOR.panelH / 2, 0.016), monitorPosition.clone().add(new THREE.Vector3(0, MONITOR.screenCenterY, -0.04))),
    ];
    const head = monitor.group.children.find((c) => c.type === 'Group') as THREE.Group;
    const screenMesh = head.children.find((c) => (c as THREE.Mesh).material === monitor.screenMaterial) as THREE.Mesh;
    const cracks = createCrackOverlay(MONITOR.viewW, MONITOR.viewH, { px: 1024 });
    cracks.mesh.position.copy(screenMesh.position).add(new THREE.Vector3(0, 0, 0.0008));
    head.add(cracks.mesh);
    const popups: string[] = [];
    let pending = 23;
    updaters.push((_dt, time) => {
      // The quiet villain: the counter ticks up on its own.
      const p = 23 + Math.floor(time / 9);
      if (p !== pending && monitor.screenMaterial.emissiveIntensity > 0) {
        pending = p;
        monitor.ui.draw({ pending, clock: '03:47', popups });
      }
    });
    return reg({
      name: 'monitor',
      colliders: cols,
      health: 360,
      armour: 16,
      stages: [0.8, 0.6, 0.4, 0.2],
      material: 'glass',
      onHit: (hit) => {
        const l = screenMesh.worldToLocal(hit.point.clone());
        cracks.impact(l.x / MONITOR.viewW + 0.5, l.y / MONITOR.viewH + 0.5, Math.min(1, hit.damage / 120));
      },
      onStage: (stage) => {
        popups.push(MONITOR_POPUPS[stage * 2 % MONITOR_POPUPS.length], MONITOR_POPUPS[(stage * 2 + 1) % MONITOR_POPUPS.length]);
        monitor.ui.draw({ pending, clock: '03:47', popups });
      },
      onBreak: (hit) => {
        cracks.mesh.visible = false;
        // Shards keep pieces of the screen image as it was.
        const shardFace = new THREE.MeshPhysicalMaterial({
          color: 0x07080a,
          emissive: 0xffffff,
          emissiveMap: monitor.ui.texture,
          emissiveIntensity: 0.07,
          roughness: 0.08,
          clearcoat: 1,
        });
        shatterPane(screenMesh, MONITOR.viewW, MONITOR.viewH, 0.002, hit, 24, [shardFace, glassEdge], true);
        monitor.screenMaterial.emissiveIntensity = 0;
        monitor.glow.intensity = 0;
        sparks(hit.point, 40);
      },
    });
  })();

  return {
    damage,
    targets,
    grabbable,
    monitorTarget,
    onEvent: (cb) => listeners.push(cb),
    update: (dt, time) => {
      damage.flush();
      for (const u of updaters) u(dt, time);
    },
  };
}
