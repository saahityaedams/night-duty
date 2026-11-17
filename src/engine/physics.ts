import RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';

export type Rapier = typeof RAPIER;

/** Fixed simulation rate. Rendering interpolates on top of this. */
export const PHYSICS_HZ = 60;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
/** Never simulate more than this many steps per frame, so a long stall can't spiral. */
const MAX_STEPS_PER_FRAME = 4;

export interface PhysicsBinding {
  body: RAPIER.RigidBody;
  object: THREE.Object3D;
  /** Damping the body was created with, restored whenever it is moving fast again. */
  baseLinearDamping: number;
  baseAngularDamping: number;
  settling: boolean;
}

/**
 * Rapier has no rolling resistance, so a cup or shard rolling on the floor slows only through
 * linear damping and can roll for many seconds. A body moving slowly sideways with almost no
 * vertical speed is resting on something, so it is treated as "settling" and gets heavy damping;
 * debris then comes to rest quickly and falls asleep. Angular speed is deliberately ignored:
 * small objects spin fast even when rolling slowly. Anything falling gains vertical speed within
 * a frame or two, so objects tipping off an edge are not slowed mid-fall.
 */
const SETTLE_HORIZONTAL_SPEED = 1.0; // m/s
const SETTLE_VERTICAL_SPEED = 0.3; // m/s
const SETTLE_DAMPING = 6;

export class Physics {
  readonly world: RAPIER.World;
  private accumulator = 0;
  private readonly bindings: PhysicsBinding[] = [];

  private constructor(readonly rapier: Rapier) {
    this.world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics(RAPIER);
  }

  /** Keeps a scene object glued to a rigid body each frame. */
  bind(body: RAPIER.RigidBody, object: THREE.Object3D): void {
    this.bindings.push({
      body,
      object,
      baseLinearDamping: body.linearDamping(),
      baseAngularDamping: body.angularDamping(),
      settling: false,
    });
  }

  /** Advances the simulation by real elapsed time (seconds, already scaled for slow motion). */
  step(dt: number): void {
    this.accumulator = Math.min(this.accumulator + dt, PHYSICS_DT * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= PHYSICS_DT) {
      this.world.step();
      this.accumulator -= PHYSICS_DT;
    }
    this.settle();
    this.sync();
  }

  /** Number of rigid bodies currently awake and moving. */
  activeBodyCount(): number {
    let n = 0;
    this.world.forEachActiveRigidBody(() => n++);
    return n;
  }

  private settle(): void {
    for (const b of this.bindings) {
      const { body } = b;
      if (body.isSleeping() || !body.isDynamic()) continue;
      const v = body.linvel();
      const slow = v.x * v.x + v.z * v.z < SETTLE_HORIZONTAL_SPEED ** 2 && Math.abs(v.y) < SETTLE_VERTICAL_SPEED;
      if (slow !== b.settling) {
        b.settling = slow;
        body.setLinearDamping(slow ? SETTLE_DAMPING : b.baseLinearDamping);
        body.setAngularDamping(slow ? SETTLE_DAMPING : b.baseAngularDamping);
      }
    }
  }

  private sync(): void {
    for (const { body, object } of this.bindings) {
      if (body.isSleeping()) continue;
      const p = body.translation();
      const r = body.rotation();
      object.position.set(p.x, p.y, p.z);
      object.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}
