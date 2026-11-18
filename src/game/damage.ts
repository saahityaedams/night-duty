import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics, ContactHit } from '../engine/physics';

/**
 * Multi-hit damage for room objects (phone, printer, tower, monitor, locker...).
 *
 * Each target has health. A hit's force above its armour becomes damage; crossing stage
 * thresholds triggers visible damage (cracks, panels popping); reaching zero breaks it.
 * Works for static colliders too: contact-force events fire when the other body (a thrown mug,
 * a tool) has events enabled, or when the target's own collider does.
 */

export type MaterialKind = 'glass' | 'metal' | 'plastic' | 'paper' | 'ceramic' | 'electronics';

export interface HitInfo {
  point: THREE.Vector3;
  force: number;
  damage: number;
}

export interface DamageTarget {
  name: string;
  colliders: RAPIER.Collider[];
  health: number;
  /** Force (N) below which a hit does nothing. */
  armour: number;
  /** Health fractions (descending) at which `onStage` fires, e.g. [0.66, 0.33]. */
  stages?: number[];
  material: MaterialKind;
  onHit?(hit: HitInfo, target: DamageTarget): void;
  onStage?(stage: number, hit: HitInfo, target: DamageTarget): void;
  onBreak(hit: HitInfo, target: DamageTarget): void;
}

interface Live extends DamageTarget {
  maxHealth: number;
  stageIndex: number;
  broken: boolean;
  lastHit: number;
}

/** Damage per newton above armour. */
const DAMAGE_PER_N = 1;
/** Relative speed (m/s, after the contact is solved) below which a contact is resting, not a hit. */
const MIN_IMPACT_SPEED = 0.4;
/** Ignore repeat contacts within this window (one impact reports over several steps). */
const HIT_COOLDOWN_MS = 90;

export class Damage {
  private readonly byCollider = new Map<number, Live>();
  private readonly pending: { t: Live; hit: HitInfo }[] = [];
  private readonly hitListeners: ((t: DamageTarget, hit: HitInfo, broke: boolean) => void)[] = [];

  constructor(private readonly physics: Physics) {
    physics.onHit((h) => this.handle(h));
  }

  register(t: DamageTarget): DamageTarget {
    const live: Live = { ...t, maxHealth: t.health, stageIndex: 0, broken: false, lastHit: 0 };
    for (const c of t.colliders) {
      c.setActiveEvents(this.physics.rapier.ActiveEvents.CONTACT_FORCE_EVENTS);
      c.setContactForceEventThreshold(Math.max(1, t.armour * 0.5));
      this.byCollider.set(c.handle, live);
    }
    return live;
  }

  /** Remove a target (e.g. after its colliders are deleted). */
  unregister(t: DamageTarget): void {
    for (const [h, live] of this.byCollider) if (live.name === t.name) this.byCollider.delete(h);
  }

  onAnyHit(cb: (t: DamageTarget, hit: HitInfo, broke: boolean) => void): void {
    this.hitListeners.push(cb);
  }

  /** The target a collider belongs to, if any (for tools striking things). */
  targetFor(collider: RAPIER.Collider): DamageTarget | null {
    const t = this.byCollider.get(collider.handle);
    return t && !t.broken ? t : null;
  }

  isBroken(t: DamageTarget): boolean {
    return (t as Live).broken === true;
  }

  /** Apply a hit directly (tools and scripted moments). */
  apply(t: DamageTarget, point: THREE.Vector3, force: number): void {
    const live = t as Live;
    if (live.broken) return;
    this.pending.push({ t: live, hit: { point, force, damage: Math.max(0, force - live.armour) * DAMAGE_PER_N } });
  }

  /** Applies queued hits outside the physics step. */
  flush(): void {
    while (this.pending.length) {
      const { t, hit } = this.pending.shift()!;
      if (t.broken || hit.damage <= 0) continue;
      t.health -= hit.damage;
      t.onHit?.(hit, t);
      const frac = Math.max(0, t.health) / t.maxHealth;
      while (t.stages && t.stageIndex < t.stages.length && frac <= t.stages[t.stageIndex]) {
        t.onStage?.(t.stageIndex, hit, t);
        t.stageIndex++;
      }
      const broke = t.health <= 0;
      if (broke) {
        t.broken = true;
        for (const c of t.colliders) this.byCollider.delete(c.handle);
        t.onBreak(hit, t);
      }
      for (const cb of this.hitListeners) cb(t, hit, broke);
    }
  }

  private handle(h: ContactHit): void {
    const t = this.byCollider.get(h.collider1.handle) ?? this.byCollider.get(h.collider2.handle);
    if (!t || t.broken || h.force < t.armour) return;
    // Only impacts count. A heavy object resting on the desk presses with a large steady force,
    // but nothing is moving into anything.
    const v1 = h.collider1.parent()?.linvel() ?? { x: 0, y: 0, z: 0 };
    const v2 = h.collider2.parent()?.linvel() ?? { x: 0, y: 0, z: 0 };
    const rel = Math.hypot(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
    if (rel < MIN_IMPACT_SPEED) return;
    const now = performance.now();
    if (now - t.lastHit < HIT_COOLDOWN_MS) return;
    t.lastHit = now;
    const p = h.point ?? h.collider1.translation();
    this.pending.push({ t, hit: { point: new THREE.Vector3(p.x, p.y, p.z), force: h.force, damage: (h.force - t.armour) * DAMAGE_PER_N } });
  }
}

/**
 * Detaches parts of an assembly into free physical pieces: each part keeps its world pose, gets a
 * box collider fitted to its geometry, and flies away from the impact.
 */
export function detachParts(
  physics: Physics,
  scene: THREE.Scene,
  parts: THREE.Object3D[],
  impact: THREE.Vector3,
  opts: {
    burst: number;
    density?: number;
    spin?: number;
    /**
     * World direction to throw parts. Flat panels hit from the front would otherwise fly "away from
     * the impact", i.e. into their own object; doors and boards should come off along their face.
     */
    direction?: THREE.Vector3;
    /** Extra angular velocity (world), e.g. a door swinging about its hinge axis. */
    angular?: THREE.Vector3;
    onSpawn?: (mesh: THREE.Object3D, body: RAPIER.RigidBody) => void;
  },
): RAPIER.RigidBody[] {
  const { rapier, world } = physics;
  const bodies: RAPIER.RigidBody[] = [];
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  for (const part of parts) {
    if (!part.parent) continue;
    scene.attach(part); // keep world transform
    part.updateMatrixWorld(true);
    // Local-space bounds of the part's meshes.
    box.makeEmpty();
    const inv = new THREE.Matrix4().copy(part.matrixWorld).invert();
    part.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      box.union(b);
    });
    if (box.isEmpty()) continue;
    box.getSize(size);
    box.getCenter(center);
    const half = size.clone().multiplyScalar(0.5).max(new THREE.Vector3(0.002, 0.002, 0.002));
    const q = part.getWorldQuaternion(new THREE.Quaternion());
    const p = part.getWorldPosition(new THREE.Vector3());
    const dir = opts.direction
      ? opts.direction.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, Math.random() * 0.2, (Math.random() - 0.5) * 0.3))
      : p.clone().add(center.clone().applyQuaternion(q)).sub(impact);
    if (dir.lengthSq() < 1e-6) dir.set(Math.random() - 0.5, 0.5, Math.random() - 0.5);
    dir.normalize();
    const v = dir.multiplyScalar(opts.burst * (0.6 + Math.random() * 0.8));
    v.y += opts.burst * 0.35 * Math.random();
    const spin = opts.spin ?? 10;
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setLinvel(v.x, v.y, v.z)
        .setAngvel({
          x: (Math.random() - 0.5) * spin + (opts.angular?.x ?? 0),
          y: (Math.random() - 0.5) * spin + (opts.angular?.y ?? 0),
          z: (Math.random() - 0.5) * spin + (opts.angular?.z ?? 0),
        })
        .setCcdEnabled(true)
        .setAngularDamping(0.4),
    );
    world.createCollider(
      rapier.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setTranslation(center.x, center.y, center.z)
        .setDensity(opts.density ?? 900)
        .setFriction(0.6)
        .setRestitution(0.2),
      body,
    );
    physics.bind(body, part);
    opts.onSpawn?.(part, body);
    bodies.push(body);
  }
  return bodies;
}
