import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics, ContactHit } from '../engine/physics';
import { fractureShell } from '../fracture/shell';
import { bisqueMaterial, handleCurve, type CupDesign, type SampledProfile } from '../scene/props/cup';
import type { Particles } from '../fx/particles';
import { Debris } from './debris';

/**
 * Objects that break. An intact object is one rigid body; when a contact force crosses its
 * strength it is replaced by physical shards (with real mass and convex colliders), a burst of
 * chips, and for mugs a splash of tea.
 */

export interface BreakEvent {
  kind: 'mug';
  position: THREE.Vector3;
  /** 0..1, how violent the break was. */
  severity: number;
  pieces: number;
}

export interface ShardHitEvent {
  position: THREE.Vector3;
  force: number;
  /** true for an intact object knocking into something without breaking. */
  intact: boolean;
}

interface MugEntry {
  kind: 'mug';
  group: THREE.Group;
  body: RAPIER.RigidBody;
  design: CupDesign;
  profile: SampledProfile;
  glaze: THREE.MeshPhysicalMaterial;
  /** Contact force (N) that breaks it. */
  strength: number;
  broken: boolean;
}

const CERAMIC_DENSITY = 2300; // kg/m³
/** Below this force, shard contacts are ignored for sound. */
const SHARD_HIT_THRESHOLD = 2.5;

export class Breakables {
  private readonly byCollider = new Map<number, MugEntry>();
  private readonly shardColliders = new Set<number>();
  private readonly breakListeners: ((e: BreakEvent) => void)[] = [];
  private readonly shardHitListeners: ((e: ShardHitEvent) => void)[] = [];
  private readonly pending: { entry: MugEntry; hit: ContactHit }[] = [];
  private readonly debris: Debris;
  get shardCount(): number {
    return this.debris.count;
  }
  breaks = 0;
  get intactCount(): number {
    let n = 0;
    const seen = new Set<MugEntry>();
    for (const e of this.byCollider.values()) if (!e.broken && !seen.has(e)) (seen.add(e), n++);
    return n;
  }
  rng: () => number = Math.random;
  /** Surface height below a point, for placing puddles. */
  groundAt: ((x: number, z: number, y: number) => number) | null = null;

  constructor(
    private readonly physics: Physics,
    private readonly scene: THREE.Scene,
    private readonly particles: Particles,
  ) {
    physics.onHit((hit) => this.handleHit(hit));
    // Anything that falls out of the world is removed cleanly.
    physics.onLost((body, object) => {
      const e = this.debris.removeBody(body);
      for (let i = 0; i < body.numColliders(); i++) this.shardColliders.delete(body.collider(i).handle);
      for (const [h, entry] of this.byCollider) if (entry.body === body) (this.byCollider.delete(h), (entry.broken = true));
      this.physics.removeBody(body);
      object.removeFromParent();
      e?.mesh.geometry.dispose();
    });
    this.debris = new Debris(scene, bisqueMaterial);
  }

  onBreak(cb: (e: BreakEvent) => void): void {
    this.breakListeners.push(cb);
  }
  onShardHit(cb: (e: ShardHitEvent) => void): void {
    this.shardHitListeners.push(cb);
  }

  addMug(group: THREE.Group, body: RAPIER.RigidBody, collider: RAPIER.Collider, design: CupDesign, profile: SampledProfile, glaze: THREE.MeshPhysicalMaterial): void {
    const entry: MugEntry = { kind: 'mug', group, body, design, profile, glaze, strength: 34, broken: false };
    collider.setActiveEvents(this.physics.rapier.ActiveEvents.CONTACT_FORCE_EVENTS);
    collider.setContactForceEventThreshold(6);
    this.byCollider.set(collider.handle, entry);
  }

  /** The intact entry a scene mesh belongs to, if any (for grabbing). */
  isIntact(body: RAPIER.RigidBody): boolean {
    for (const e of this.byCollider.values()) if (e.body === body) return !e.broken;
    return false;
  }

  /** Per-frame upkeep (debris batching). */
  update(dt: number): void {
    this.debris.update(dt);
  }

  /** Breaks queued during the physics step are applied here, outside the step. */
  flush(): void {
    while (this.pending.length) {
      const { entry, hit } = this.pending.shift()!;
      if (!entry.broken) this.breakMug(entry, hit);
    }
  }

  /** Force-break a mug (used by tests and scripted moments). */
  breakBody(body: RAPIER.RigidBody, force = 120): boolean {
    for (const e of this.byCollider.values()) {
      if (e.body === body && !e.broken) {
        const p = body.translation();
        this.breakMug(e, { collider1: body.collider(0), collider2: body.collider(0), force, point: { x: p.x, y: p.y + 0.05, z: p.z } });
        return true;
      }
    }
    return false;
  }

  /** Clears debris from a spot (e.g. where a new object is about to appear). */
  clearArea(x: number, z: number, radius: number): void {
    for (const { mesh, body } of this.debris.removeNear(x, z, radius)) {
      for (let i = 0; i < body.numColliders(); i++) this.shardColliders.delete(body.collider(i).handle);
      this.physics.removeBody(body);
      mesh.geometry.dispose();
    }
  }

  /** Removes the oldest shards beyond `max`, so long sessions stay fast. */
  trimShards(max: number): void {
    for (const { mesh, body } of this.debris.trim(max)) {
      for (let i = 0; i < body.numColliders(); i++) this.shardColliders.delete(body.collider(i).handle);
      this.physics.removeBody(body);
      mesh.geometry.dispose();
    }
  }

  private handleHit(hit: ContactHit): void {
    const e = this.byCollider.get(hit.collider1.handle) ?? this.byCollider.get(hit.collider2.handle);
    if (e && !e.broken) {
      if (hit.force >= e.strength) {
        this.pending.push({ entry: e, hit });
      } else if (hit.force > 8 && hit.point) {
        const position = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
        for (const cb of this.shardHitListeners) cb({ position, force: hit.force, intact: true });
      }
      return;
    }
    if ((this.shardColliders.has(hit.collider1.handle) || this.shardColliders.has(hit.collider2.handle)) && hit.force > SHARD_HIT_THRESHOLD && hit.point) {
      const position = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
      for (const cb of this.shardHitListeners) cb({ position, force: hit.force, intact: false });
    }
  }

  private breakMug(e: MugEntry, hit: ContactHit): void {
    e.broken = true;
    const { rapier, world } = this.physics;
    const rng = this.rng;
    const body = e.body;
    const linvel = new THREE.Vector3().copy(body.linvel() as THREE.Vector3Like);
    const angvel = new THREE.Vector3().copy(body.angvel() as THREE.Vector3Like);
    const bodyPos = new THREE.Vector3().copy(body.translation() as THREE.Vector3Like);
    const bodyRot = new THREE.Quaternion().copy(body.rotation() as THREE.QuaternionLike);
    const matrix = new THREE.Matrix4().compose(bodyPos, bodyRot, new THREE.Vector3(1, 1, 1));

    // Impact in the mug's local space -> surface parameters.
    const impactWorld = hit.point ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : bodyPos.clone().add(new THREE.Vector3(0, 0.05, 0));
    const local = impactWorld.clone().applyMatrix4(matrix.clone().invert());
    const height = e.design.profile[e.design.profile.length - 1][1];
    const impactU = (((Math.atan2(local.z, local.x) / (Math.PI * 2)) % 1) + 1) % 1;
    const impactV = THREE.MathUtils.clamp(0.25 + (local.y / height) * 0.75, 0.02, 0.98);

    const severity = THREE.MathUtils.clamp((hit.force - e.strength) / 160, 0, 1);
    const pieces = Math.round(5 + severity * 13 + rng() * 3);

    const shards = fractureShell({
      profile: e.profile,
      thickness: e.design.thickness,
      pieces,
      impactU,
      impactV,
      focus: 0.35 + severity * 0.6,
      rng,
    });

    // Remove the intact mug.
    this.scene.remove(e.group);
    this.physics.removeBody(body);
    for (const [h, entry] of this.byCollider) if (entry === e) this.byCollider.delete(h);

    const burst = 0.35 + severity * 1.6;
    const mats: THREE.Material[] = [e.glaze, bisqueMaterial];
    const spawn = (geometry: THREE.BufferGeometry, centroidLocal: THREE.Vector3, hull: Float32Array, mass: number, outwardLocal: THREE.Vector3) => {
      const worldPos = centroidLocal.clone().applyMatrix4(matrix);
      const mesh = new THREE.Mesh(geometry, mats);
      // Only sizeable pieces cast shadows; tiny shards' shadows are invisible at phone size.
      mesh.castShadow = mass > 0.012;
      mesh.receiveShadow = true;
      mesh.position.copy(worldPos);
      mesh.quaternion.copy(bodyRot);
      this.scene.add(mesh);

      const r = worldPos.clone().sub(bodyPos);
      const v = linvel.clone().add(new THREE.Vector3().crossVectors(angvel, r));
      const out = outwardLocal.clone().applyQuaternion(bodyRot);
      const fromImpact = worldPos.clone().sub(impactWorld).normalize();
      v.addScaledVector(out, burst * (0.4 + rng() * 0.8)).addScaledVector(fromImpact, burst * (0.3 + rng() * 0.6));
      v.y += burst * 0.4 * rng();

      const rb = world.createRigidBody(
        rapier.RigidBodyDesc.dynamic()
          .setTranslation(worldPos.x, worldPos.y, worldPos.z)
          .setRotation({ x: bodyRot.x, y: bodyRot.y, z: bodyRot.z, w: bodyRot.w })
          .setLinvel(v.x, v.y, v.z)
          .setAngvel({ x: angvel.x + (rng() - 0.5) * 30, y: angvel.y + (rng() - 0.5) * 30, z: angvel.z + (rng() - 0.5) * 30 })
          .setCcdEnabled(true)
          .setAngularDamping(0.4)
          .setLinearDamping(0.05),
      );
      const desc = rapier.ColliderDesc.convexHull(hull) ?? rapier.ColliderDesc.ball(0.01);
      desc.setMass(Math.max(0.002, mass)).setFriction(0.7).setRestitution(0.25);
      desc.setActiveEvents(rapier.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(SHARD_HIT_THRESHOLD);
      const col = world.createCollider(desc, rb);
      this.shardColliders.add(col.handle);
      this.physics.bind(rb, mesh);
      this.debris.add(mesh, rb, e.glaze);
    };

    for (const s of shards) spawn(s.geometry, s.centroid, s.hull, s.volume * CERAMIC_DENSITY, s.outward);

    // The handle snaps off, usually in one piece, sometimes two.
    if (e.design.handle) {
      const curve = handleCurve(e.design);
      const parts = severity > 0.5 && rng() < 0.6 ? [[0, 0.5], [0.5, 1]] : [[0, 1]];
      for (const [a, b] of parts) {
        const pts = curve.getSpacedPoints(24).slice(Math.round(a * 24), Math.round(b * 24) + 1);
        const sub = new THREE.CatmullRomCurve3(pts);
        const geo = new THREE.TubeGeometry(sub, 12, 0.0058, 10, false);
        geo.scale(1, 1, 0.75);
        geo.computeBoundingBox();
        const center = geo.boundingBox!.getCenter(new THREE.Vector3());
        geo.translate(-center.x, -center.y, -center.z);
        // Glaze on the tube, so the group-based material array still works: one group, index 0.
        geo.clearGroups();
        geo.addGroup(0, geo.index ? geo.index.count : geo.attributes.position.count, 0);
        const hull = new Float32Array(geo.attributes.position.array);
        const length = sub.getLength();
        spawn(geo, center, hull, Math.PI * 0.0058 * 0.0058 * 0.75 * length * CERAMIC_DENSITY, new THREE.Vector3(1, 0, 0));
      }
    }

    // Chips and tea.
    const chipColor = new THREE.Color().copy(e.glaze.color);
    this.particles.chipsBurst(impactWorld, linvel, Math.round(14 + severity * 40), chipColor, rng);
    if (e.design.fill > 0) {
      const teaPos = new THREE.Vector3(0, height * e.design.fill * 0.8, 0).applyMatrix4(matrix);
      this.particles.splash(teaPos, linvel, 70 + severity * 110, rng);
      // If it broke on or near a surface, the rest of the tea pools there.
      const ground = this.groundAt ? this.groundAt(bodyPos.x, bodyPos.z, bodyPos.y) : null;
      if (ground !== null && bodyPos.y - ground < 0.08) this.particles.puddle(bodyPos.x, ground, bodyPos.z, 0.11 + rng() * 0.06);
    }

    this.breaks++;
    const evt: BreakEvent = { kind: 'mug', position: impactWorld, severity, pieces: shards.length };
    for (const cb of this.breakListeners) cb(evt);
  }
}
