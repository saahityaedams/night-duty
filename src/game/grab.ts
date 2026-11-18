import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../engine/physics';

/**
 * Grab and flick.
 * - Press on an object: it lifts and follows the finger (still a physical body, so it collides).
 * - Release with a flick: thrown with the finger's speed and direction (up the screen = away).
 * - Quick tap without moving: a smack that knocks it over or off the desk.
 */

export interface GrabOptions {
  physics: Physics;
  camera: THREE.PerspectiveCamera;
  element: HTMLElement;
  /** Meshes that can be picked, mapped to their body. */
  pickable: () => Map<THREE.Object3D, RAPIER.RigidBody>;
  /** Grabbing only works while this returns true (the hand tool is selected). */
  enabled?: () => boolean;
  /** Lowest height a held object may be dragged to (desk surface + clearance). */
  minHeight: number;
  onGrab?: (body: RAPIER.RigidBody) => void;
  /** Where forward throws are gently steered toward (x, z on the floor plan), per moment. */
  aimTarget?: () => THREE.Vector3 | null;
  onThrow?: (body: RAPIER.RigidBody, speed: number) => void;
}

const FOLLOW_GAIN = 16; // 1/s
const FOLLOW_MAX_SPEED = 5; // m/s
const LIFT = 0.07; // m above the grab point
const THROW_GAIN = 3.4; // m/s per screen-height-per-second
const THROW_MAX = 11; // m/s
const TAP_MS = 180;
const TAP_PX = 10;

interface Sample {
  t: number;
  x: number;
  y: number;
}

export class Grab {
  private held: RAPIER.RigidBody | null = null;
  private pointerId = -1;
  private readonly plane = new THREE.Plane();
  private readonly target = new THREE.Vector3();
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private history: Sample[] = [];
  private downAt = { t: 0, x: 0, y: 0 };
  private lastScreen = { x: 0, y: 0 };

  constructor(private readonly o: GrabOptions) {
    const el = o.element;
    el.addEventListener('pointerdown', (e) => this.down(e.pointerId, e.clientX, e.clientY, e.timeStamp));
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      // Coalesced events give the full finger path at the display rate on phones.
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ce of events.length ? events : [e]) this.move(ce.clientX, ce.clientY, ce.timeStamp);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.pointerId) this.up(e.clientX, e.clientY, e.timeStamp);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  get holding(): boolean {
    return this.held !== null;
  }

  private rect() {
    return this.o.element.getBoundingClientRect();
  }

  private castFrom(x: number, y: number): THREE.Raycaster {
    const r = this.rect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -(((y - r.top) / r.height) * 2 - 1));
    this.ray.setFromCamera(this.ndc, this.o.camera);
    return this.ray;
  }

  /** Programmatic input for tests: same path as real touches. */
  down(id: number, x: number, y: number, t: number): boolean {
    if (this.pointerId !== -1) return false;
    if (this.o.enabled && !this.o.enabled()) return false;
    const map = this.o.pickable();
    const hit = this.castFrom(x, y).intersectObjects([...map.keys()], false)[0];
    if (!hit) return false;
    const body = map.get(hit.object)!;
    this.pointerId = id;
    this.held = body;
    this.downAt = { t, x, y };
    this.lastScreen = { x, y };
    this.history = [{ t, x, y }];
    // Drag plane faces the camera through the grab point.
    const n = new THREE.Vector3();
    this.o.camera.getWorldDirection(n);
    this.plane.setFromNormalAndCoplanarPoint(n.negate(), hit.point);
    this.target.copy(hit.point).y += LIFT;
    const b = this.o.physics.binding(body);
    if (b) b.held = true;
    body.wakeUp();
    this.o.onGrab?.(body);
    return true;
  }

  move(x: number, y: number, t: number): void {
    if (!this.held) return;
    this.lastScreen = { x, y };
    this.history.push({ t, x, y });
    while (this.history.length > 2 && t - this.history[0].t > 120) this.history.shift();
    const p = new THREE.Vector3();
    if (this.castFrom(x, y).ray.intersectPlane(this.plane, p)) {
      this.target.copy(p);
      this.target.y = Math.max(this.target.y + LIFT, this.o.minHeight);
    }
  }

  up(x: number, y: number, t: number): void {
    const body = this.held;
    if (!body) return;
    this.move(x, y, t);
    const b = this.o.physics.binding(body);
    if (b) b.held = false;
    this.held = null;
    this.pointerId = -1;

    const r = this.rect();
    const moved = Math.hypot(x - this.downAt.x, y - this.downAt.y);
    const forward = new THREE.Vector3();
    this.o.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    if (t - this.downAt.t < TAP_MS && moved < TAP_PX) {
      // Smack: knock it away from the camera with a little lift and spin.
      const v = forward.clone().multiplyScalar(1.6).add(right.clone().multiplyScalar((Math.random() - 0.5) * 1.2));
      body.setLinvel({ x: v.x, y: 1.2, z: v.z }, true);
      body.setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 12 }, true);
      this.o.onThrow?.(body, 2);
      return;
    }

    // Finger velocity over the last ~80ms, in screen heights per second.
    const h = this.history;
    let i = h.length - 1;
    while (i > 0 && t - h[i - 1].t < 80) i--;
    const a = h[Math.max(0, i - 1)];
    const dt = Math.max(0.008, (t - a.t) / 1000);
    const vx = (x - a.x) / r.height / dt;
    const vy = (y - a.y) / r.height / dt;
    const flick = Math.hypot(vx, vy);
    if (flick < 0.25) return; // just let go: it drops

    const v = new THREE.Vector3()
      .addScaledVector(right, vx * THROW_GAIN)
      .addScaledVector(forward, -vy * THROW_GAIN * 1.15)
      // A modest arc: enough lift to clear the keyboard, not enough to sail over the monitor.
      .add(new THREE.Vector3(0, 0.7 + Math.min(1.6, Math.max(0, -vy) * 0.45), 0));
    if (v.length() > THROW_MAX) v.setLength(THROW_MAX);
    // Aim assist: bend the horizontal direction partway toward the target area (the monitor and
    // window), so throws land where she can see them break. Speed is preserved.
    const aim = this.o.aimTarget?.() ?? null;
    if (aim && v.z < 0) {
      const p = body.translation();
      const toTarget = new THREE.Vector3(aim.x - p.x, 0, aim.z - p.z).normalize();
      const flat = new THREE.Vector3(v.x, 0, v.z);
      const speed = flat.length();
      flat.normalize().lerp(toTarget, 0.4).normalize().multiplyScalar(speed);
      v.x = flat.x;
      v.z = flat.z;
    }
    body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
    body.setAngvel({ x: (Math.random() - 0.5) * 16, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 16 }, true);
    this.o.onThrow?.(body, v.length());
  }

  /** Drives the held body toward the finger. Call every frame before stepping physics. */
  update(): void {
    const body = this.held;
    if (!body) return;
    const p = body.translation();
    const v = new THREE.Vector3(this.target.x - p.x, this.target.y - p.y, this.target.z - p.z).multiplyScalar(FOLLOW_GAIN);
    if (v.length() > FOLLOW_MAX_SPEED) v.setLength(FOLLOW_MAX_SPEED);
    body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
    const w = body.angvel();
    body.setAngvel({ x: w.x * 0.8, y: w.y * 0.8, z: w.z * 0.8 }, true);
  }

  /** Last finger position (for effects that follow the finger). */
  get screen(): { x: number; y: number } {
    return this.lastScreen;
  }
}
