import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { ARC } from './arcConfig';
import type { CameraRig, ShotName } from '../scene/camera';
import type { Hud } from '../ui/hud';
import type { Tools } from './tools';
import type { AudioEngine } from '../audio/audio';
import type { RoomObjects } from './objects';
import type { Breakables } from './breakables';
import type { Physics } from '../engine/physics';
import type { Room } from '../scene/room';
import type { Monitor } from '../scene/props/monitor';
import type { PostPipeline } from '../engine/post';
import type { TimeFx, CameraShake, Haptics } from './juice';
import type { Stats } from './stats';
import type { Particles } from '../fx/particles';
import type { PaperStorm } from '../fx/paper';
import { EndingUi } from '../ui/ending';
import { TEXT } from '../content/text';
import { isIOS, isStandalone } from '../platform/mobile';

/**
 * The session arc. One small state machine owns it:
 *   warm-up (hand only, the desk) → bat unlocks (the whole desk) → the printer side is revealed →
 *   hammer unlocks (the locker is revealed) → the meter fills → finale → silence → dawn → ending.
 * Progress comes only from what she breaks. Nothing is timed.
 */

export type ArcStage = 'warmup' | 'bat' | 'right' | 'hammer' | 'finale' | 'dawn' | 'ending';

export interface ArcDeps {
  rig: CameraRig;
  hud: Hud;
  tools: Tools;
  audio: AudioEngine;
  objects: RoomObjects;
  breakables: Breakables;
  physics: Physics;
  room: Room;
  monitor: Monitor;
  post: PostPipeline;
  timefx: TimeFx;
  shake: CameraShake;
  haptics: Haptics;
  stats: Stats;
  particles: Particles;
  paper: PaperStorm;
  stage: HTMLElement;
  /** Stops the prototype's refill of mugs once the finale begins. */
  setRefill(on: boolean): void;
  /** Intact mug bodies (for the chain reaction). */
  intactMugs(): RAPIER.RigidBody[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Arc {
  stage: ArcStage = 'warmup';
  progress = 0;
  private revealed = { left: false, right: false };
  private busy = false;
  private musicStarted = false;
  private dawnStart = -1;
  private time = 0;
  private flicker = 0;
  private readonly ending: EndingUi;
  private readonly crumpled = new Set<string>();
  private readonly base: { overhead: number; counter: number; corridor: number; windowLight: number; ambient: number; glow: number };

  constructor(private readonly d: ArcDeps) {
    this.ending = new EndingUi(d.stage);
    const L = d.room.lights;
    this.base = {
      overhead: L.overhead.intensity,
      counter: L.counterLight.intensity,
      corridor: L.corridor.intensity,
      windowLight: L.windowLight.intensity,
      ambient: L.ambient.intensity,
      glow: d.monitor.glow.intensity,
    };

    // Warm-up: the hand only, the desk, a faint meter.
    d.hud.setTools(['hand']);
    d.hud.setTool('hand');
    d.tools.select('hand');
    this.updateArrows();
    d.hud.setMeter(0);
    d.hud.onLook((dir) => this.look(dir));

    if (d.stats.lifetimeAtStart > 0) this.ending.returning(d.stats.lifetimeAtStart);

    // Progress and stats from everything that breaks.
    d.breakables.onBreak(() => {
      d.stats.add('cups');
      d.stats.add('things');
      this.add(ARC.points.mug);
    });
    d.objects.onEvent((e) => {
      if (e.kind === 'break') {
        d.stats.add('things');
        if (e.name === 'phone') d.stats.add('calls');
        const big = ['printer', 'tower', 'locker', 'whiteboard'].includes(e.name);
        this.add(big ? ARC.points.big : ARC.points.small);
      } else if (e.name.startsWith('paper-cup')) {
        if (!this.crumpled.has(e.name)) {
          this.crumpled.add(e.name);
          d.stats.add('cups');
          d.stats.add('things');
        }
        this.add(ARC.points.crumple);
      } else {
        this.add(ARC.points.hit);
      }
    });
  }

  /** Unlocks every tool and view at once (preview links, tests). */
  unlockAll(): void {
    this.stage = 'hammer';
    this.revealed = { left: true, right: true };
    this.d.hud.setTools(['hand', 'bat', 'hammer']);
    this.updateArrows();
  }

  add(points: number): void {
    if (this.stage === 'finale' || this.stage === 'dawn' || this.stage === 'ending') return;
    if (!this.musicStarted) {
      this.musicStarted = true;
      this.d.audio.score?.start();
    }
    this.progress += points;
    const meter = Math.min(1, this.progress / ARC.finale);
    this.d.hud.setMeter(meter);
    this.d.audio.score?.setIntensity(meter);
    void this.advance();
  }

  private async advance(): Promise<void> {
    if (this.busy) return;
    const p = this.progress;
    const { hud, tools } = this.d;
    if (this.stage === 'warmup' && p >= ARC.unlockBat) {
      this.stage = 'bat';
      hud.setTools(['hand', 'bat']);
      hud.markNew('bat');
      tools.select('bat');
      hud.setTool('bat');
      this.unlockCue();
      await this.reveal('deskWide');
      if (tools.current === 'bat') tools.showBatHint();
    } else if (this.stage === 'bat' && p >= ARC.revealRight) {
      this.stage = 'right';
      this.revealed.right = true;
      this.unlockCue();
      await this.reveal('right');
    } else if (this.stage === 'right' && p >= ARC.unlockHammer) {
      this.stage = 'hammer';
      this.revealed.left = true;
      hud.setTools(['hand', 'bat', 'hammer']);
      hud.markNew('hammer');
      tools.select('hammer');
      hud.setTool('hammer');
      this.unlockCue();
      await this.reveal('left');
    } else if (this.stage === 'hammer' && p >= ARC.finale) {
      void this.finale();
      return;
    } else {
      return;
    }
    // Several thresholds can be crossed by one big break.
    void this.advance();
  }

  private unlockCue(): void {
    this.d.haptics.tick(0.6);
    this.d.audio.unlockTone();
  }

  private async reveal(shot: ShotName): Promise<void> {
    this.busy = true;
    this.d.rig.go(shot, ARC.revealSeconds);
    this.updateArrows();
    await sleep(ARC.revealSeconds * 1000);
    this.busy = false;
  }

  private look(dir: 'left' | 'right'): void {
    if (this.busy || this.stage === 'finale' || this.stage === 'dawn' || this.stage === 'ending') return;
    const cur = this.d.rig.current;
    const centre: ShotName = this.stage === 'warmup' ? 'desk' : 'deskWide';
    let next: ShotName | null = null;
    if (dir === 'left') next = cur === 'right' ? centre : this.revealed.left ? 'left' : null;
    else next = cur === 'left' ? centre : this.revealed.right ? 'right' : null;
    if (!next) return;
    this.d.rig.go(next, 1.1);
    this.updateArrows(next);
  }

  private updateArrows(shot: ShotName = this.d.rig.current): void {
    const left = shot === 'right' || (shot !== 'left' && this.revealed.left);
    const right = shot === 'left' || (shot !== 'right' && this.revealed.right);
    this.d.hud.setArrows(left, right);
  }

  // --- Finale ---------------------------------------------------------------------------------

  private async finale(): Promise<void> {
    if (this.stage === 'finale') return;
    this.stage = 'finale';
    const d = this.d;
    d.setRefill(false);
    d.hud.setVisible(false);
    d.tools.select('hammer');
    d.rig.go('finale', 1.8);
    const score = d.audio.score;
    d.objects.finale.start();
    score?.setIntensity(1);
    if (!d.objects.isBroken('phone')) score?.startLoop('ring');
    if (!d.objects.isBroken('clock')) score?.startLoop('alarm');
    if (!d.objects.isBroken('printer')) score?.startLoop('grind');
    score?.startLoop('chimes');
    score?.startLoop('buzz');
    this.flicker = 1;

    // Wherever she taps, the hammer comes down on the monitor.
    const monitorCol = d.objects.monitorTarget.colliders[0];
    const mp = monitorCol.translation();
    const monitorPoint = new THREE.Vector3(mp.x, mp.y, mp.z + 0.02);
    d.tools.scriptedTarget = () => ({ collider: monitorCol, point: monitorPoint.clone() });
    const swung = new Promise<void>((resolve) => {
      d.tools.onSwing((tool) => {
        if (tool === 'hammer' && this.stage === 'finale') {
          score?.swell();
          resolve();
        }
      });
    });
    const landed = new Promise<void>((resolve) => d.tools.onHammerLand(() => this.stage === 'finale' && resolve()));
    await swung;
    await landed;
    d.tools.scriptedTarget = null;
    this.chainReaction(monitorPoint);
  }

  private async chainReaction(origin: THREE.Vector3): Promise<void> {
    const d = this.d;
    const score = d.audio.score;
    // Everything stops at the moment of impact.
    score?.stopAllLoops();
    score?.stopMusic(0.02);
    d.audio.setRain(0, 0.4);
    d.audio.setHum(false);
    this.flicker = 0;
    d.objects.damage.apply(d.objects.monitorTarget, origin, 99999);
    d.timefx.slowMo(0.22, 3200);
    d.shake.add(1);
    d.haptics.tick(1);

    // The light dies: a spark shower and darkness.
    const L = d.room.lights;
    const lightPos = L.overhead.position.clone().setY(2.25);
    d.particles.chipsBurst(lightPos, new THREE.Vector3(0, -0.5, 0), 70, new THREE.Color(1.4, 0.9, 0.45));
    L.overhead.intensity = 0;
    L.counterLight.intensity = 0;
    d.monitor.glow.intensity = 0;
    L.corridor.intensity = this.base.corridor * 0.35;

    // Shockwave: every loose thing flies away from the monitor.
    const { world } = d.physics;
    // Collect first, push after: Rapier refuses changes to bodies mid-iteration.
    const bodies: RAPIER.RigidBody[] = [];
    world.forEachRigidBody((b) => {
      if (b.isDynamic()) bodies.push(b);
    });
    bodies.forEach((b) => {
      const t = b.translation();
      const out = new THREE.Vector3(t.x - origin.x, 0, t.z - origin.z);
      const dist = Math.max(0.15, out.length());
      out.normalize().setY(0.8).normalize().multiplyScalar(Math.min(2.5, 1.2 / dist) * Math.min(1, b.mass() * 3 + 0.1));
      b.applyImpulse({ x: out.x, y: out.y, z: out.z }, true);
    });

    // Then the rest of the room goes, nearest first.
    const remaining = d.objects.targets
      .filter((t) => !d.objects.damage.isBroken(t) && t !== d.objects.monitorTarget && !t.name.startsWith('paper-cup'))
      .map((t) => {
        const c = t.colliders.find((col) => world.getCollider(col.handle) === col);
        return { t, c };
      })
      .filter((x) => x.c)
      .sort((a, b) => a.c!.translation().x ** 2 + a.c!.translation().z ** 2 - (b.c!.translation().x ** 2 + b.c!.translation().z ** 2));
    remaining.forEach(({ t }, i) => {
      setTimeout(() => {
        // The shockwave may have broken it (or torn this part off) since it was scheduled.
        if (d.objects.damage.isBroken(t)) return;
        const live = t.colliders.find((col) => world.getCollider(col.handle) === col);
        if (!live) return;
        const p = live.translation();
        d.objects.damage.apply(t, new THREE.Vector3(p.x, p.y, p.z + 0.05), 5000);
      }, 150 + i * 160);
    });
    d.intactMugs().forEach((b, i) => setTimeout(() => d.breakables.breakBody(b, 260), 80 + i * 120));

    // Drift back as it all comes down.
    setTimeout(() => d.rig.go('deskWide', 3), 600);
    await sleep(3400 + ARC.silence * 1000);
    await d.objects.finale.pendingZero();
    await sleep(500);
    this.dawn();
  }

  // --- Dawn and the ending --------------------------------------------------------------------

  private dawn(): void {
    const d = this.d;
    this.stage = 'dawn';
    this.dawnStart = this.time;
    d.audio.setRain(0, 2);
    void d.audio.dawnAmbience();
    d.audio.score?.dawn();
    d.rig.go('dawn', ARC.dawnSeconds + 3);
    // The overhead light becomes the low morning sun through the window.
    const sun = d.room.lights.overhead;
    sun.color.set(0xffb27a);
    sun.position.set(0.5, 1.75, -1.9);
    sun.target.position.set(-0.15, 0.76, -0.2);
    sun.angle = 0.6;
    sun.penumbra = 0.6;
    sun.decay = 0.9;
    sun.distance = 7;
    setTimeout(() => void this.showEnding(), (ARC.dawnSeconds * 0.65) * 1000);
  }

  private async showEnding(): Promise<void> {
    const d = this.d;
    this.stage = 'ending';
    d.stats.add('pages', d.paper.total);
    d.stats.add('popups', d.objects.popupCount());
    d.stats.commit();
    const homeHint = isStandalone ? null : isIOS ? TEXT.homeScreenIOS : TEXT.homeScreenAndroid;
    await this.ending.show(d.stats.session, { homeHint }, {
      onTick: () => d.audio.tick(),
      onAgain: async () => {
        await this.ending.blackout();
        location.reload();
      },
      onSleep: async () => {
        d.audio.fadeOut(4);
        await this.ending.goodnight();
      },
    });
  }

  /** Per-frame: flickering light in the finale, the dawn grade. */
  update(dt: number): void {
    this.time += dt;
    const d = this.d;
    if (this.stage === 'finale' && this.flicker > 0) {
      const L = d.room.lights;
      L.overhead.intensity = this.base.overhead * (Math.random() < 0.18 ? 0.15 : 0.85 + Math.random() * 0.3);
      d.objects.finale.update(dt);
    }
    if (this.dawnStart >= 0) {
      const k = Math.min(1, (this.time - this.dawnStart) / ARC.dawnSeconds);
      d.room.window.setDawn(k);
      const warm = THREE.MathUtils.smoothstep(k, 0.4, 1);
      const L = d.room.lights;
      L.overhead.intensity = warm * 36;
      L.windowLight.color.lerpColors(new THREE.Color(0x5f78ad), new THREE.Color(0xffc49a), warm);
      L.windowLight.intensity = THREE.MathUtils.lerp(this.base.windowLight, 5, THREE.MathUtils.smoothstep(k, 0.25, 1));
      L.ambient.color.lerpColors(new THREE.Color(0x1b2230), new THREE.Color(0xffe2c4), warm);
      L.ambient.intensity = THREE.MathUtils.lerp(this.base.ambient, 1.0, THREE.MathUtils.smoothstep(k, 0.3, 1));
      L.corridor.intensity = this.base.corridor * 0.35 * (1 - warm);
      d.post.grade.saturation.saturation = THREE.MathUtils.lerp(-0.12, 0.06, warm);
      d.post.vignette.darkness = THREE.MathUtils.lerp(0.78, 0.5, warm);
    }
  }
}
