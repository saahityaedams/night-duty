import * as THREE from 'three';

/**
 * Camera shots and smooth moves between them.
 *
 * A portrait phone screen is narrow, so the room is revealed by camera moves instead of one wide
 * shot: tight on the desk at first, then pulling back and panning to each big object as it
 * unlocks. Each shot keeps a minimum horizontal field of view; the vertical field of view widens
 * on narrow screens to keep it.
 */

export interface Shot {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** Minimum horizontal field of view in degrees. */
  hfov: number;
}

export const SHOTS = {
  /** Act 1: seated, tight on the middle of the desk, monitor and window. */
  desk: { position: new THREE.Vector3(0, 1.4, 0.3), target: new THREE.Vector3(0, 0.9, -0.42), hfov: 40 },
  /** Act 2: leaning back, the whole desk. */
  // Portrait screens hit the vertical FOV cap, so a wider view comes from distance, not FOV.
  // Aimed so the bottom of the frame lands on the desk's front edge, not the floor.
  deskWide: { position: new THREE.Vector3(0, 1.66, 0.82), target: new THREE.Vector3(0, 1.3, -0.6), hfov: 50 },
  /** The locker, back-left, seen from the front. */
  left: { position: new THREE.Vector3(-0.62, 1.42, 0.95), target: new THREE.Vector3(-0.98, 1.0, -0.4), hfov: 48 },
  /** The printer counter and the roster whiteboard, back-right. */
  right: { position: new THREE.Vector3(0.45, 1.5, 0.8), target: new THREE.Vector3(1.1, 1.12, -0.6), hfov: 54 },
  /** Finale: square on the workstation, a little lower and closer, for the last swing. */
  finale: { position: new THREE.Vector3(0, 1.3, 0.2), target: new THREE.Vector3(0, 1.02, -0.55), hfov: 44 },
} satisfies Record<string, Shot>;

export type ShotName = keyof typeof SHOTS;

const MAX_VFOV = 76;

function vfovFor(hfov: number, aspect: number): number {
  const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov / 2)) / aspect));
  return THREE.MathUtils.clamp(v, 45, MAX_VFOV);
}

function ease(t: number): number {
  // Smooth start, gentle settle.
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class CameraRig {
  private from: Shot = SHOTS.desk;
  private to: Shot = SHOTS.desk;
  private t = 1;
  private duration = 1;
  private readonly pos = new THREE.Vector3();
  private readonly tgt = new THREE.Vector3();
  current: ShotName = 'desk';

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Move to a shot over `seconds` (0 = cut). */
  go(name: ShotName, seconds = 1.6): void {
    const k = ease(this.t);
    // Start from wherever the camera is now, even mid-move.
    this.from = {
      position: new THREE.Vector3().lerpVectors(this.from.position, this.to.position, k),
      target: new THREE.Vector3().lerpVectors(this.from.target, this.to.target, k),
      hfov: THREE.MathUtils.lerp(this.from.hfov, this.to.hfov, k),
    };
    this.to = SHOTS[name];
    this.current = name;
    this.t = seconds <= 0 ? 1 : 0;
    this.duration = Math.max(0.001, seconds);
    this.apply();
  }

  get moving(): boolean {
    return this.t < 1;
  }

  /** Advances the move. Returns true while the camera is moving. */
  update(dt: number): boolean {
    const moving = this.t < 1;
    if (moving) this.t = Math.min(1, this.t + dt / this.duration);
    // Always re-apply: camera shake offsets the pose after this, every frame.
    this.apply();
    return moving;
  }

  /** Re-apply after a resize (aspect changes the vertical field of view). */
  refresh(): void {
    this.apply();
  }

  private apply(): void {
    const k = ease(this.t);
    this.pos.lerpVectors(this.from.position, this.to.position, k);
    this.tgt.lerpVectors(this.from.target, this.to.target, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.tgt);
    this.camera.fov = vfovFor(THREE.MathUtils.lerp(this.from.hfov, this.to.hfov, k), this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }
}
