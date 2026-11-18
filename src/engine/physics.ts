import RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';

export type Rapier = typeof RAPIER;

/** Fixed simulation rate. */
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
  /** Held by the player's finger: no settle damping. */
  held: boolean;
  /** Seconds spent awake while barely moving (for the sleep watchdog). */
  slowFor: number;
}

/** A contact whose force crossed a collider's threshold during one physics step. */
export interface ContactHit {
  collider1: RAPIER.Collider;
  collider2: RAPIER.Collider;
  /** Total contact force magnitude over the step (N). */
  force: number;
  /** World-space contact point, if the narrow phase reported one. */
  point: { x: number; y: number; z: number } | null;
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
/**
 * Watchdog: thin shards occasionally wedge slightly into a surface and jitter or spin in place,
 * so the solver never lets them sleep. Anything barely translating for this long is put to sleep.
 */
const WATCHDOG_SPEED = 0.15; // m/s
const WATCHDOG_SECONDS = 4;
/** Bodies that fall below this height have left the world and are removed. */
const KILL_HEIGHT = -2;

export class Physics {
  readonly world: RAPIER.World;
  private readonly events: RAPIER.EventQueue;
  private accumulator = 0;
  private readonly bindings = new Map<number, PhysicsBinding>(); // by body handle
  private readonly hitListeners: ((hit: ContactHit) => void)[] = [];
  private readonly lostListeners: ((body: RAPIER.RigidBody, object: THREE.Object3D) => void)[] = [];

  private constructor(readonly rapier: Rapier) {
    this.world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;
    this.events = new rapier.EventQueue(true);
  }

  static async create(): Promise<Physics> {
    await RAPIER.init();
    return new Physics(RAPIER);
  }

  /** Keeps a scene object glued to a rigid body each frame. */
  bind(body: RAPIER.RigidBody, object: THREE.Object3D): PhysicsBinding {
    const b: PhysicsBinding = {
      body,
      object,
      baseLinearDamping: body.linearDamping(),
      baseAngularDamping: body.angularDamping(),
      settling: false,
      held: false,
      slowFor: 0,
    };
    this.bindings.set(body.handle, b);
    return b;
  }

  binding(body: RAPIER.RigidBody): PhysicsBinding | undefined {
    return this.bindings.get(body.handle);
  }

  /** Removes a body (and its colliders) from the world and stops syncing its object. */
  removeBody(body: RAPIER.RigidBody): void {
    this.bindings.delete(body.handle);
    this.world.removeRigidBody(body);
  }

  onHit(cb: (hit: ContactHit) => void): void {
    this.hitListeners.push(cb);
  }

  /**
   * Called after a body fell out of the world and was removed (with its object), so systems that
   * track bodies can forget it. Listeners must not remove it again.
   */
  onLost(cb: (body: RAPIER.RigidBody, object: THREE.Object3D) => void): void {
    this.lostListeners.push(cb);
  }

  /** Advances the simulation by elapsed time (seconds, already scaled for slow motion). */
  step(dt: number): void {
    this.accumulator = Math.min(this.accumulator + dt, PHYSICS_DT * MAX_STEPS_PER_FRAME);
    while (this.accumulator >= PHYSICS_DT) {
      this.world.step(this.events);
      this.accumulator -= PHYSICS_DT;
      this.drainEvents();
    }
    this.settle(dt);
    this.sync();
  }

  /** Number of rigid bodies currently awake and moving. */
  activeBodyCount(): number {
    let n = 0;
    this.world.forEachActiveRigidBody(() => n++);
    return n;
  }

  private drainEvents(): void {
    if (!this.hitListeners.length) {
      this.events.clear();
      return;
    }
    const hits: ContactHit[] = [];
    this.events.drainContactForceEvents((e) => {
      const c1 = this.world.getCollider(e.collider1());
      const c2 = this.world.getCollider(e.collider2());
      if (!c1 || !c2) return;
      let point: ContactHit['point'] = null;
      this.world.contactPair(c1, c2, (manifold) => {
        if (!point && manifold.numSolverContacts() > 0) {
          const p = manifold.solverContactPoint(0);
          if (p) point = { x: p.x, y: p.y, z: p.z };
        }
      });
      hits.push({ collider1: c1, collider2: c2, force: e.totalForceMagnitude(), point });
    });
    // Listeners may remove bodies, so call them after draining.
    for (const h of hits) for (const cb of this.hitListeners) cb(h);
  }

  private settle(dt: number): void {
    const lost: PhysicsBinding[] = [];
    for (const b of this.bindings.values()) {
      const { body } = b;
      if (body.isSleeping() || !body.isDynamic()) continue;
      if (body.translation().y < KILL_HEIGHT) {
        lost.push(b);
        continue;
      }
      const v = body.linvel();
      const speed2 = v.x * v.x + v.y * v.y + v.z * v.z;
      b.slowFor = !b.held && speed2 < WATCHDOG_SPEED ** 2 ? b.slowFor + dt : 0;
      if (b.slowFor > WATCHDOG_SECONDS) {
        body.setLinvel({ x: 0, y: 0, z: 0 }, false);
        body.setAngvel({ x: 0, y: 0, z: 0 }, false);
        body.sleep();
        b.slowFor = 0;
        continue;
      }
      const slow = !b.held && v.x * v.x + v.z * v.z < SETTLE_HORIZONTAL_SPEED ** 2 && Math.abs(v.y) < SETTLE_VERTICAL_SPEED;
      if (slow !== b.settling) {
        b.settling = slow;
        body.setLinearDamping(slow ? SETTLE_DAMPING : b.baseLinearDamping);
        body.setAngularDamping(slow ? SETTLE_DAMPING : b.baseAngularDamping);
      }
    }
    for (const b of lost) {
      // Listeners clean up their records first (they may still read the body), then it goes.
      for (const cb of this.lostListeners) cb(b.body, b.object);
      this.removeBody(b.body);
      b.object.removeFromParent();
    }
  }

  private sync(): void {
    for (const { body, object } of this.bindings.values()) {
      if (body.isSleeping()) continue;
      const p = body.translation();
      const r = body.rotation();
      object.position.set(p.x, p.y, p.z);
      object.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }
}
