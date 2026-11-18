import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../engine/physics';
import type { Damage } from './damage';
import type { Breakables } from './breakables';

/**
 * Tools beyond the hand.
 * - Bat: swipe across the screen; everything the swipe crosses is struck, harder for faster swipes.
 *   A bat sweeps through the frame along the swipe.
 * - Sledgehammer: press and hold to charge (a ring grows under the finger), release to bring it
 *   down on that spot. Big damage there, and loose things nearby are blasted outward.
 */

export type ToolName = 'hand' | 'bat' | 'hammer';

export interface StrikeEvent {
  tool: ToolName;
  point: THREE.Vector3;
  force: number;
  /** Whether anything breakable was struck (vs the desk or a wall). */
  hitSomething: boolean;
}

interface Options {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  element: HTMLElement;
  stage: HTMLElement;
  physics: Physics;
  damage: Damage;
  breakables: Breakables;
}

const BAT_FORCE_PER_SPEED = 95; // N per (screen heights / s)
const BAT_MAX_FORCE = 260;
/** Even a gentle swipe breaks a mug (strength ~30 N). */
const BAT_MIN_FORCE = 70;
/** Screen heights per second; anything slower is a drag, not a swing. */
const BAT_MIN_SPEED = 0.25;
/** A tap with the bat: a short chop at whatever is under the finger. */
const BAT_TAP_FORCE = 120;
/** Forgiveness: the swing connects with anything within this distance (m) of the finger's ray. */
const BAT_REACH = 0.06;
/** How long the swipe streak lingers (ms). */
const TRAIL_MS = 200;
const HAMMER_MIN = 170;
const HAMMER_MAX = 520;
const HAMMER_CHARGE_S = 0.9;
/** Shockwave radius (m) for an uncharged and a fully charged blow. */
const HAMMER_RADIUS_MIN = 0.2;
const HAMMER_RADIUS_MAX = 0.34;
/** The hammer's aim is more forgiving than the bat's: it lands on the nearest thing it can hurt. */
const HAMMER_REACH = 0.09;

export class Tools {
  current: ToolName = 'hand';
  /** Finale: every hammer swing lands here, wherever she taps. */
  scriptedTarget: (() => { collider: RAPIER.Collider; point: THREE.Vector3 } | null) | null = null;
  private readonly listeners: ((e: StrikeEvent) => void)[] = [];
  private readonly swingListeners: ((tool: ToolName, strength: number) => void)[] = [];
  private readonly landListeners: ((point: THREE.Vector3, force: number, charge: number) => void)[] = [];
  private pointerId = -1;
  private path: { x: number; y: number; t: number }[] = [];
  private struck = new Set<number>();
  private chargeStart = 0;
  private readonly ring: HTMLDivElement;
  private readonly bat: THREE.Group;
  private readonly hammer: THREE.Group;
  private batAnim = { t: 1, from: 0, to: 0 };
  /** The current bat gesture has already swung (animation and whoosh fired). */
  private swung = false;
  private readonly trail: HTMLCanvasElement;
  private trailPts: { x: number; y: number; t: number }[] = [];
  private hint: HTMLDivElement | null = null;
  private trailDirty = false;
  private hammerAnim = { t: 1, target: new THREE.Vector3(), lift: 0.45 };
  /** While the hammer is held down: raised over this point. */
  private windup: { target: THREE.Vector3 } | null = null;
  private readonly ray = new THREE.Raycaster();

  constructor(private readonly o: Options) {
    // Tool models live in front of the camera.
    o.scene.add(o.camera);
    this.bat = makeBat();
    this.hammer = makeHammer();
    this.bat.visible = false;
    this.hammer.visible = false;
    o.camera.add(this.bat);
    o.scene.add(this.hammer);

    this.ring = document.createElement('div');
    this.ring.className = 'charge-ring';
    o.stage.appendChild(this.ring);

    // The swipe streak: a fading line under the finger while swinging the bat.
    this.trail = document.createElement('canvas');
    this.trail.className = 'swipe-trail';
    o.stage.appendChild(this.trail);

    const el = o.element;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
  }

  onStrike(cb: (e: StrikeEvent) => void): void {
    this.listeners.push(cb);
  }
  onSwing(cb: (tool: ToolName, strength: number) => void): void {
    this.swingListeners.push(cb);
  }
  /** Fires when a hammer blow lands (after the swing). */
  onHammerLand(cb: (point: THREE.Vector3, force: number, charge: number) => void): void {
    this.landListeners.push(cb);
  }

  select(tool: ToolName): void {
    this.current = tool;
  }

  private rect() {
    return this.o.element.getBoundingClientRect();
  }

  private down(e: PointerEvent): void {
    if (this.current === 'hand' || this.pointerId !== -1) return;
    this.pointerId = e.pointerId;
    this.path = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    this.struck.clear();
    this.swung = false;
    if (this.current === 'bat') this.trailPts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (this.current === 'hammer') {
      this.chargeStart = e.timeStamp;
      const r = this.rect();
      this.ring.style.left = `${e.clientX - r.left}px`;
      this.ring.style.top = `${e.clientY - r.top}px`;
      this.ring.classList.add('on');
      this.ring.style.setProperty('--k', '0');
      // Wind-up: the hammer appears raised over the spot and lifts higher as the charge builds.
      const aim = this.hammerAim(e.clientX, e.clientY);
      if (aim && this.hammerAnim.t >= 1) {
        this.windup = { target: aim.point.clone() };
        this.hammer.visible = true;
      }
    }
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    if (this.current === 'bat') {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ce of events.length ? events : [e]) this.batSample(ce.clientX, ce.clientY, ce.timeStamp);
    } else if (this.current === 'hammer') {
      const r = this.rect();
      this.ring.style.left = `${e.clientX - r.left}px`;
      this.ring.style.top = `${e.clientY - r.top}px`;
      this.path.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (this.windup) {
        const aim = this.hammerAim(e.clientX, e.clientY);
        if (aim) this.windup.target.copy(aim.point);
      }
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    if (this.current === 'bat') {
      this.batSample(e.clientX, e.clientY, e.timeStamp);
      const a = this.path[0];
      const dx = e.clientX - a.x;
      const dy = e.clientY - a.y;
      if (this.swung) {
        // Already swung mid-gesture.
      } else if (Math.hypot(dx, dy) > 20) {
        this.swing(dx, dy, Math.min(1, this.speedOf(this.path.slice(-6)) / 3));
      } else {
        // A tap: chop down at whatever is under the finger.
        this.swing(1, 0.6, 0.6);
        const hit = this.castFat(e.clientX, e.clientY);
        if (hit) {
          const dir = this.ray.ray.direction.clone().add(new THREE.Vector3(0, -0.6, 0)).normalize();
          this.strike(hit.collider, hit.point, BAT_TAP_FORCE, dir, 'bat');
        }
      }
    } else if (this.current === 'hammer') {
      this.ring.classList.remove('on');
      const charge = Math.min(1, (e.timeStamp - this.chargeStart) / 1000 / HAMMER_CHARGE_S);
      const hit = this.hammerAim(e.clientX, e.clientY);
      this.windup = null;
      if (hit) {
        this.hammerAnim = { t: 0, target: hit.point.clone(), lift: 0.17 + 0.16 * charge };
        this.hammer.visible = true;
        for (const cb of this.swingListeners) cb('hammer', charge);
        // The blow lands at the bottom of the swing.
        const force = HAMMER_MIN + (HAMMER_MAX - HAMMER_MIN) * charge;
        setTimeout(() => {
          this.hammerStrike(hit.point, hit.collider, force, charge);
          for (const cb of this.landListeners) cb(hit.point, force, charge);
        }, 110);
      }
    }
  }

  /** Charge level 0..1 while holding the hammer (for UI). */
  get charge(): number {
    if (this.pointerId === -1 || this.current !== 'hammer') return 0;
    return Math.min(1, (performance.now() - this.chargeStart) / 1000 / HAMMER_CHARGE_S);
  }

  private speedOf(pts: { x: number; y: number; t: number }[]): number {
    if (pts.length < 2) return 0;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const dt = Math.max(0.008, (b.t - a.t) / 1000);
    return Math.hypot(b.x - a.x, b.y - a.y) / this.rect().height / dt;
  }

  /** Starts the bat's swing animation across the view in the swipe direction, once per gesture. */
  private swing(dx: number, dy: number, strength: number): void {
    if (this.swung) return;
    this.swung = true;
    const ang = Math.atan2(-dy, dx);
    this.batAnim = { t: 0, from: ang + Math.PI * 0.55, to: ang - Math.PI * 0.55 };
    this.bat.visible = true;
    this.clearHint();
    for (const cb of this.swingListeners) cb('bat', strength);
  }

  private batSample(x: number, y: number, t: number): void {
    const last = this.path[this.path.length - 1];
    this.path.push({ x, y, t });
    this.trailPts.push({ x, y, t: performance.now() });
    // Sample along the segment so fast swipes don't skip over objects.
    const steps = Math.max(1, Math.ceil(Math.hypot(x - last.x, y - last.y) / 12));
    const speed = this.speedOf(this.path.slice(-5));
    if (speed < BAT_MIN_SPEED) return; // a slow drag isn't a swing
    if (Math.hypot(x - this.path[0].x, y - this.path[0].y) > 20) this.swing(x - last.x, y - last.y, Math.min(1, speed / 3));
    const force = THREE.MathUtils.clamp(speed * BAT_FORCE_PER_SPEED, BAT_MIN_FORCE, BAT_MAX_FORCE);
    for (let i = 1; i <= steps; i++) {
      const sx = last.x + ((x - last.x) * i) / steps;
      const sy = last.y + ((y - last.y) * i) / steps;
      const hit = this.castFat(sx, sy, i === 1);
      if (!hit || this.struck.has(hit.collider.handle)) continue;
      this.struck.add(hit.collider.handle);
      // Swing direction in world space: the swipe direction across the view, plus some push away.
      const dir = this.screenDirToWorld(x - last.x, y - last.y).multiplyScalar(0.75).add(this.ray.ray.direction.clone().multiplyScalar(0.5)).normalize();
      this.strike(hit.collider, hit.point, force, dir, 'bat');
    }
  }

  private screenDirToWorld(dx: number, dy: number): THREE.Vector3 {
    const right = new THREE.Vector3().setFromMatrixColumn(this.o.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.o.camera.matrixWorld, 1);
    return right.multiplyScalar(dx).add(up.multiplyScalar(-dy)).normalize();
  }

  private cast(x: number, y: number): { collider: RAPIER.Collider; point: THREE.Vector3 } | null {
    const r = this.rect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1));
    this.ray.setFromCamera(ndc, this.o.camera);
    const { rapier, world } = this.o.physics;
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    const hit = world.castRay(new rapier.Ray({ x: o.x, y: o.y, z: o.z }, { x: d.x, y: d.y, z: d.z }), 6, true);
    if (!hit) return null;
    const p = o.clone().addScaledVector(d, hit.timeOfImpact);
    return { collider: hit.collider, point: p };
  }

  /** Can the bat do anything to this collider? (Breakable, damageable or loose.) */
  private hittable(c: RAPIER.Collider): boolean {
    return !!this.o.damage.targetFor(c) || !!c.parent()?.isDynamic();
  }

  /**
   * Handles of everything the bat can hit, gathered before a query: Rapier forbids calling back
   * into the world (e.g. collider.parent()) from inside a query's filter.
   */
  private hittableHandles = new Set<number>();
  private refreshHittable(): void {
    this.hittableHandles.clear();
    this.o.physics.world.forEachCollider((c) => {
      if (this.hittable(c)) this.hittableHandles.add(c.handle);
    });
  }

  /**
   * A forgiving cast for the bat: the exact ray first, then a ball swept along it so a swipe that
   * passes just beside an object still connects. The desk, walls and floor are ignored.
   */
  private castFat(x: number, y: number, refresh = true, reach = BAT_REACH): { collider: RAPIER.Collider; point: THREE.Vector3 } | null {
    if (refresh) this.refreshHittable();
    const exact = this.cast(x, y);
    if (exact && this.hittable(exact.collider)) return exact;
    const { rapier, world } = this.o.physics;
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    const hit = world.castShape(
      { x: o.x, y: o.y, z: o.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: d.x, y: d.y, z: d.z },
      new rapier.Ball(reach),
      0,
      6,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => this.hittableHandles.has(c.handle),
    );
    if (!hit) return null;
    // Don't reach through solid scenery: the object must be in front of whatever the exact ray hit.
    if (exact && hit.time_of_impact > exact.point.distanceTo(o) + 0.15) return null;
    const p = o.clone().addScaledVector(d, hit.time_of_impact + reach);
    return { collider: hit.collider, point: p };
  }

  /** Where a hammer blow at this screen point lands: the nearest breakable thing, else the surface. */
  private hammerAim(x: number, y: number): { collider: RAPIER.Collider; point: THREE.Vector3 } | null {
    return this.scriptedTarget?.() ?? this.castFat(x, y, true, HAMMER_REACH) ?? this.cast(x, y);
  }

  /** A looping ghost swipe over the desk, shown when the bat first unlocks, gone after the first swing. */
  showBatHint(): void {
    if (this.hint) return;
    this.hint = document.createElement('div');
    this.hint.className = 'bat-hint';
    this.hint.innerHTML = '<i></i>';
    this.o.stage.appendChild(this.hint);
  }

  private clearHint(): void {
    if (!this.hint) return;
    const h = this.hint;
    this.hint = null;
    h.classList.add('gone');
    setTimeout(() => h.remove(), 600);
  }

  private drawTrail(): void {
    const c = this.trail;
    const now = performance.now();
    this.trailPts = this.trailPts.filter((p) => now - p.t < TRAIL_MS);
    const r = this.rect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    const pts = this.trailPts;
    if (pts.length < 2) return;
    g.lineCap = 'round';
    for (let i = 1; i < pts.length; i++) {
      const k = 1 - (now - pts[i].t) / TRAIL_MS;
      g.strokeStyle = `rgba(255, 236, 214, ${0.55 * k})`;
      g.lineWidth = (2 + 10 * k) * dpr;
      g.beginPath();
      g.moveTo((pts[i - 1].x - r.left) * dpr, (pts[i - 1].y - r.top) * dpr);
      g.lineTo((pts[i].x - r.left) * dpr, (pts[i].y - r.top) * dpr);
      g.stroke();
    }
  }

  private strike(collider: RAPIER.Collider, point: THREE.Vector3, force: number, dir: THREE.Vector3, tool: ToolName): boolean {
    let hitSomething = false;
    // Read the body first: breaking the object below can remove it from the world.
    const parent = collider.parent();
    const bodyHandle = parent && parent.isDynamic() ? parent.handle : -1;
    const target = this.o.damage.targetFor(collider);
    if (target) {
      this.o.damage.apply(target, point, force);
      hitSomething = true;
    }
    if (this.o.breakables.strike(collider, force, point)) hitSomething = true;
    const body = bodyHandle >= 0 ? this.o.physics.world.getRigidBody(bodyHandle) : null;
    if (body) {
      const j = dir.clone().multiplyScalar(Math.min(4, force * 0.012) * Math.min(1, body.mass() * 4 + 0.15));
      body.applyImpulseAtPoint({ x: j.x, y: j.y + Math.abs(j.length()) * 0.25, z: j.z }, point, true);
      hitSomething = true;
    }
    for (const cb of this.listeners) cb({ tool, point, force, hitSomething });
    return hitSomething;
  }

  private hammerStrike(point: THREE.Vector3, collider: RAPIER.Collider, force: number, charge = 1): void {
    const radius = HAMMER_RADIUS_MIN + (HAMMER_RADIUS_MAX - HAMMER_RADIUS_MIN) * charge;
    const { rapier, world } = this.o.physics;
    const down = new THREE.Vector3(0, -1, 0).add(this.ray.ray.direction.clone().multiplyScalar(0.4)).normalize();
    this.strike(collider, point, force, down, 'hammer');
    // Shockwave: loose things nearby fly outward; mugs nearby break.
    // Collect first, act after: breaking things removes bodies, which Rapier forbids mid-query.
    const hits: RAPIER.Collider[] = [];
    world.intersectionsWithShape({ x: point.x, y: point.y, z: point.z }, { x: 0, y: 0, z: 0, w: 1 }, new rapier.Ball(radius), (c) => {
      if (c.handle !== collider.handle) hits.push(c);
      return true;
    });
    for (const c of hits) {
      if (world.getCollider(c.handle) !== c) continue; // removed by an earlier break
      const parent = c.parent();
      const bodyHandle = parent && parent.isDynamic() ? parent.handle : -1;
      const t = c.translation();
      const out = new THREE.Vector3(t.x - point.x, 0, t.z - point.z);
      const dist = Math.max(0.03, out.length());
      const falloff = 1 - Math.min(1, dist / radius);
      out.normalize().setY(0.9).normalize();
      const f = force * 0.75 * falloff;
      const target = this.o.damage.targetFor(c);
      if (target && f > 20) this.o.damage.apply(target, new THREE.Vector3(t.x, t.y, t.z), f);
      if (world.getCollider(c.handle) === c) this.o.breakables.strike(c, f, new THREE.Vector3(t.x, t.y, t.z));
      const body = bodyHandle >= 0 ? world.getRigidBody(bodyHandle) : null;
      if (body) {
        const j = out.multiplyScalar(Math.min(3, f * 0.01) * Math.min(1, body.mass() * 4 + 0.15));
        body.applyImpulse({ x: j.x, y: j.y, z: j.z }, true);
      }
    }
  }

  /** Animates the tool models. */
  update(dt: number): void {
    if (this.trailPts.length || this.trailDirty) {
      this.drawTrail();
      this.trailDirty = this.trailPts.length > 0;
    }
    this.ring.style.setProperty('--k', String(this.charge));
    if (this.batAnim.t < 1) {
      this.batAnim.t = Math.min(1, this.batAnim.t + dt / 0.2);
      const k = 1 - Math.pow(1 - this.batAnim.t, 3);
      const a = THREE.MathUtils.lerp(this.batAnim.from, this.batAnim.to, k);
      // Pivot below the frame; the bat sweeps across the view like a swing.
      this.bat.position.set(Math.cos(a) * 0.05, -0.22 + Math.sin(a) * 0.05, -0.32);
      this.bat.rotation.set(-0.25, 0, a - Math.PI / 2);
      if (this.batAnim.t >= 1) this.bat.visible = false;
    }
    if (this.windup && this.hammerAnim.t >= 1) {
      // Held: raised and tilted back over the target, rising with the charge, trembling when full.
      const k = this.charge;
      const target = this.windup.target;
      const toCam = new THREE.Vector3().subVectors(this.o.camera.position, target).setY(0).normalize();
      const shake = k >= 1 ? (Math.random() - 0.5) * 0.006 : 0;
      this.hammer.position.copy(target).add(new THREE.Vector3(shake, 0.17 + 0.16 * k, shake)).addScaledVector(toCam, 0.14 + 0.04 * k);
      this.hammer.lookAt(this.hammer.position.clone().add(toCam));
      this.hammer.rotateX(-1.1 - 0.35 * k);
    }
    if (this.hammerAnim.t < 1) {
      this.hammerAnim.t = Math.min(1, this.hammerAnim.t + dt / 0.5);
      const t = this.hammerAnim.t;
      const target = this.hammerAnim.target;
      // Raised above and in front of the target, tilted back; slams down by t = 0.22, rests, lifts off.
      const k = Math.min(1, t / 0.22);
      const slam = k * k;
      const toCam = new THREE.Vector3().subVectors(this.o.camera.position, target).setY(0).normalize();
      const start = target.clone().add(new THREE.Vector3(0, this.hammerAnim.lift, 0)).addScaledVector(toCam, 0.25);
      const end = target.clone().add(new THREE.Vector3(0, 0.03, 0));
      const lift = t > 0.6 ? (t - 0.6) / 0.4 : 0;
      this.hammer.position.lerpVectors(start, end, slam).add(new THREE.Vector3(0, lift * 0.25, 0));
      // Handle points back toward the camera; tilt goes from raised (-1.1 rad) to level.
      this.hammer.lookAt(this.hammer.position.clone().add(toCam));
      this.hammer.rotateX(THREE.MathUtils.lerp(-1.1, 0.35, slam) - lift * 0.4);
      if (t >= 1) this.hammer.visible = false;
    }
  }
}

function makeBat(): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  const L = 0.42;
  for (let i = 0; i <= 12; i++) {
    const y = (i / 12) * L;
    const r = 0.007 + 0.017 * Math.pow(i / 12, 1.6);
    pts.push(new THREE.Vector2(r, y));
  }
  pts.push(new THREE.Vector2(0.0, L));
  const bat = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), new THREE.MeshStandardMaterial({ color: 0xc9a56b, roughness: 0.45, metalness: 0 }));
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.08, 14), new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.8 }));
  grip.position.y = 0.04;
  g.add(bat, grip);
  return g;
}

function makeHammer(): THREE.Group {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.5, 14), new THREE.MeshStandardMaterial({ color: 0xa8824f, roughness: 0.55 }));
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, 0.02, 0.25);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.35, metalness: 0.9 }));
  head.position.y = 0.02;
  g.add(handle, head);
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
  return g;
}
