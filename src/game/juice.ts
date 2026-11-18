import * as THREE from 'three';

/**
 * Game feel: time effects (hit-stop, slow motion), camera shake, and haptics.
 */

export class TimeFx {
  private stopUntil = 0;
  private slowUntil = 0;
  private slowScale = 1;
  private slowDuration = 0;

  /** Freeze the simulation for a few milliseconds of real time. */
  hitStop(ms: number, now = performance.now()): void {
    this.stopUntil = Math.max(this.stopUntil, now + ms);
  }

  /** Slow time to `scale`, easing back to normal over `ms`. */
  slowMo(scale: number, ms: number, now = performance.now()): void {
    this.slowScale = Math.min(this.slowScale, scale);
    this.slowDuration = ms;
    this.slowUntil = Math.max(this.slowUntil, now + ms);
  }

  /** Converts real elapsed seconds into game seconds. */
  scale(realDt: number, now = performance.now()): number {
    if (now < this.stopUntil) return realDt * 0.02;
    if (now < this.slowUntil) {
      const k = 1 - (this.slowUntil - now) / this.slowDuration; // 0 -> 1 as it ends
      return realDt * THREE.MathUtils.lerp(this.slowScale, 1, k * k);
    }
    this.slowScale = 1;
    return realDt;
  }
}

/** Trauma-based camera shake: impacts add trauma, shake grows with its square, decays smoothly. */
export class CameraShake {
  private trauma = 0;
  private t = 0;
  private readonly basePos = new THREE.Vector3();
  private readonly baseQuat = new THREE.Quaternion();
  enabled = true;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  /** Call after the camera's resting pose is set. */
  captureBase(): void {
    this.basePos.copy(this.camera.position);
    this.baseQuat.copy(this.camera.quaternion);
  }

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const s = this.enabled ? this.trauma * this.trauma : 0;
    const n = (seed: number) => Math.sin(this.t * 37.0 + seed) * 0.6 + Math.sin(this.t * 71.0 + seed * 2.1) * 0.4;
    this.camera.position.copy(this.basePos).add(new THREE.Vector3(n(1) * 0.012 * s, n(2) * 0.01 * s, 0));
    const e = new THREE.Euler(n(3) * 0.018 * s, n(4) * 0.018 * s, n(5) * 0.03 * s);
    this.camera.quaternion.copy(this.baseQuat).multiply(new THREE.Quaternion().setFromEuler(e));
  }
}

/**
 * Haptics. Android: the Vibration API. iPhone Safari has no Vibration API; on iOS 18+ toggling a
 * native switch control produces the system haptic tick, so we keep a hidden one and click it.
 * Both are best-effort: the game must feel complete without them.
 */
export class Haptics {
  private readonly label: HTMLLabelElement | null = null;
  private last = 0;
  enabled = true;

  constructor() {
    const canVibrate = typeof navigator.vibrate === 'function';
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!canVibrate && isIOS) {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      label.appendChild(input);
      document.body.appendChild(label);
      this.label = label;
    }
  }

  /** A short tick. `strength` 0..1 maps to duration on Android. */
  tick(strength = 0.5): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.last < 35) return;
    this.last = now;
    try {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(Math.round(8 + strength * 22));
      else this.label?.click();
    } catch {
      /* best-effort */
    }
  }
}
