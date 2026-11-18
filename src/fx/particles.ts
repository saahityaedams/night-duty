import * as THREE from 'three';

/**
 * Lightweight particles that don't need the physics engine:
 *  - chips: tiny ceramic fragments that bounce and come to rest, and stay
 *  - droplets: tea flung out of a breaking mug, stretched along their velocity
 *  - stains: flat tea splats left where droplets land, and stay
 * Pools are fixed-size instanced meshes; when full, the oldest entry is reused.
 */

export interface GroundQuery {
  /** Height of the surface below (x, z) that particles land on. */
  (x: number, z: number, y: number): number;
}

interface Chip {
  p: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
  w: THREE.Vector3;
  s: number;
  resting: boolean;
  color: THREE.Color;
}

interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  s: number;
  alive: boolean;
  water: boolean;
}

/** An irregular liquid splat drawn into an alpha texture: a main blob with satellite drops. */
function splatTexture(seed: number, satellites: number): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let a = seed;
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff';
  // Main blob: a wobbly polygon.
  g.beginPath();
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const r = S * (0.2 + 0.07 * Math.sin(ang * 3 + rnd() * 6) + 0.04 * rnd());
    const x = S / 2 + Math.cos(ang) * r;
    const y = S / 2 + Math.sin(ang) * r * 0.85;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.fill();
  for (let i = 0; i < satellites; i++) {
    const ang = rnd() * Math.PI * 2;
    const d = S * (0.27 + rnd() * 0.18);
    g.beginPath();
    g.arc(S / 2 + Math.cos(ang) * d, S / 2 + Math.sin(ang) * d, S * (0.012 + rnd() * 0.035), 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const CHIP_MAX = 500;
const DROP_MAX = 300;
const STAIN_MAX = 220;
const PUDDLE_MAX = 24;
const GRAVITY = -9.81;

export class Particles {
  readonly group = new THREE.Group();
  private readonly chipMesh: THREE.InstancedMesh;
  private readonly dropMesh: THREE.InstancedMesh;
  private readonly waterMesh: THREE.InstancedMesh;
  private readonly stainMesh: THREE.InstancedMesh;
  private readonly puddleMesh: THREE.InstancedMesh;
  private puddleNext = 0;
  private puddleCount = 0;
  private readonly chips: Chip[] = [];
  private readonly drops: Drop[] = [];
  private chipNext = 0;
  private dropNext = 0;
  private stainNext = 0;
  private stainCount = 0;
  private readonly m = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly ground: GroundQuery) {
    // Chips: irregular little shards.
    const chipGeo = new THREE.TetrahedronGeometry(1, 0);
    chipGeo.scale(1, 0.35, 0.8);
    const chipMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    this.chipMesh = new THREE.InstancedMesh(chipGeo, chipMat, CHIP_MAX);
    this.chipMesh.count = 0;
    this.chipMesh.castShadow = true;
    this.chipMesh.frustumCulled = false;
    this.chipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const dropGeo = new THREE.SphereGeometry(1, 8, 6);
    const dropMat = new THREE.MeshStandardMaterial({
      color: 0x8a5a2e,
      roughness: 0.08,
      envMapIntensity: 0.5,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.dropMesh = new THREE.InstancedMesh(dropGeo, dropMat, DROP_MAX);
    this.dropMesh.count = 0;
    this.dropMesh.frustumCulled = false;
    this.dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.waterMesh = new THREE.InstancedMesh(
      dropGeo,
      new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.02, envMapIntensity: 1.2, transparent: true, opacity: 0.5, depthWrite: false }),
      DROP_MAX,
    );
    this.waterMesh.count = 0;
    this.waterMesh.frustumCulled = false;
    this.waterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Tea on the desk: translucent warm brown with a faint wet sheen, irregular edges.
    const liquid = (alphaMap: THREE.Texture, opacity: number) =>
      new THREE.MeshStandardMaterial({
        color: 0x4a2a13,
        roughness: 0.26,
        envMapIntensity: 0.25,
        alphaMap,
        transparent: true,
        opacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    this.stainMesh = new THREE.InstancedMesh(flat, liquid(splatTexture(7, 5), 0.6), STAIN_MAX);
    this.stainMesh.count = 0;
    this.stainMesh.frustumCulled = false;
    this.stainMesh.renderOrder = 1;
    this.puddleMesh = new THREE.InstancedMesh(flat, liquid(splatTexture(31, 14), 0.72), PUDDLE_MAX);
    this.puddleMesh.count = 0;
    this.puddleMesh.frustumCulled = false;
    this.puddleMesh.renderOrder = 1;

    this.group.add(this.chipMesh, this.dropMesh, this.waterMesh, this.stainMesh, this.puddleMesh);
  }

  /** A burst of small ceramic chips at an impact. */
  chipsBurst(at: THREE.Vector3, baseVel: THREE.Vector3, count: number, color: THREE.Color, rng = Math.random): void {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(rng() - 0.5, rng() * 0.9 + 0.1, rng() - 0.5).normalize();
      const speed = 0.6 + rng() * 2.4;
      const chip: Chip = {
        p: at.clone().addScaledVector(dir, 0.01),
        v: baseVel.clone().multiplyScalar(0.5).addScaledVector(dir, speed),
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6, rng() * 6, rng() * 6)),
        w: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(40),
        s: 0.0015 + rng() * rng() * 0.005,
        resting: false,
        color: color.clone().multiplyScalar(0.9 + rng() * 0.2),
      };
      if (this.chips.length < CHIP_MAX) this.chips.push(chip);
      else this.chips[this.chipNext] = chip;
      this.chipNext = (this.chipNext + 1) % CHIP_MAX;
    }
    this.chipMesh.count = this.chips.length;
  }

  /** Tea flung out of a breaking mug. */
  splash(at: THREE.Vector3, baseVel: THREE.Vector3, amount: number, rng = Math.random, water = false): void {
    const n = Math.round(amount);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(rng() - 0.5, rng() * 0.8 + 0.2, rng() - 0.5).normalize();
      const drop: Drop = {
        p: at.clone().add(new THREE.Vector3((rng() - 0.5) * 0.04, rng() * 0.03, (rng() - 0.5) * 0.04)),
        v: baseVel.clone().multiplyScalar(0.6).addScaledVector(dir, 0.4 + rng() * 1.8),
        s: 0.0005 + rng() * rng() * 0.0016,
        alive: true,
        water,
      };
      if (this.drops.length < DROP_MAX) this.drops.push(drop);
      else this.drops[this.dropNext] = drop;
      this.dropNext = (this.dropNext + 1) % DROP_MAX;
    }
  }

  /** A tea puddle where a mug broke (only on a surface, not mid-air). */
  puddle(x: number, y: number, z: number, size: number): void {
    this.tmpQ.setFromAxisAngle(this.up, Math.random() * Math.PI * 2);
    this.m.compose(this.tmpV.set(x, y + 0.0006, z), this.tmpQ, this.tmpS.set(size * (0.8 + Math.random() * 0.4), 1, size));
    this.puddleMesh.setMatrixAt(this.puddleNext, this.m);
    this.puddleNext = (this.puddleNext + 1) % PUDDLE_MAX;
    this.puddleCount = Math.min(this.puddleCount + 1, PUDDLE_MAX);
    this.puddleMesh.count = this.puddleCount;
    this.puddleMesh.instanceMatrix.needsUpdate = true;
  }

  private stain(x: number, y: number, z: number, size: number): void {
    const s = size * (5 + Math.random() * 6);
    this.tmpQ.setFromAxisAngle(this.up, Math.random() * Math.PI);
    this.m.compose(this.tmpV.set(x, y + 0.0004 + Math.random() * 0.0001, z), this.tmpQ, this.tmpS.set(s * (0.7 + Math.random() * 0.6), 1, s));
    this.stainMesh.setMatrixAt(this.stainNext, this.m);
    this.stainNext = (this.stainNext + 1) % STAIN_MAX;
    this.stainCount = Math.min(this.stainCount + 1, STAIN_MAX);
    this.stainMesh.count = this.stainCount;
    this.stainMesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    // Chips.
    let chipsChanged = false;
    for (let i = 0; i < this.chips.length; i++) {
      const c = this.chips[i];
      if (!c.resting) {
        chipsChanged = true;
        c.v.y += GRAVITY * dt;
        c.p.addScaledVector(c.v, dt);
        this.tmpQ.setFromEuler(new THREE.Euler(c.w.x * dt, c.w.y * dt, c.w.z * dt));
        c.q.multiply(this.tmpQ);
        const g = this.ground(c.p.x, c.p.z, c.p.y);
        if (c.p.y < g + c.s * 0.35) {
          c.p.y = g + c.s * 0.35;
          if (Math.abs(c.v.y) < 0.4) {
            c.resting = true;
            c.v.set(0, 0, 0);
          } else {
            c.v.y = -c.v.y * 0.3;
            c.v.x *= 0.55;
            c.v.z *= 0.55;
            c.w.multiplyScalar(0.5);
          }
        }
      }
      this.m.compose(c.p, c.q, this.tmpS.setScalar(c.s));
      this.chipMesh.setMatrixAt(i, this.m);
      this.chipMesh.setColorAt(i, c.color);
    }
    if (chipsChanged) {
      this.chipMesh.instanceMatrix.needsUpdate = true;
      if (this.chipMesh.instanceColor) this.chipMesh.instanceColor.needsUpdate = true;
    }

    // Droplets (tea leaves stains; water just disappears into the surface).
    let live = 0;
    let liveWater = 0;
    for (const d of this.drops) {
      if (!d.alive) continue;
      d.v.y += GRAVITY * dt;
      d.p.addScaledVector(d.v, dt);
      const g = this.ground(d.p.x, d.p.z, d.p.y);
      if (d.p.y <= g) {
        d.alive = false;
        if (!d.water) this.stain(d.p.x, g, d.p.z, d.s);
        continue;
      }
      // Stretch along velocity.
      const speed = d.v.length();
      this.tmpQ.setFromUnitVectors(this.up, this.tmpV.copy(d.v).divideScalar(speed || 1));
      this.m.compose(d.p, this.tmpQ, this.tmpS.set(d.s * 0.8, d.s * Math.min(6, 1.2 + speed * 1.3), d.s * 0.8));
      if (d.water) this.waterMesh.setMatrixAt(liveWater++, this.m);
      else this.dropMesh.setMatrixAt(live++, this.m);
    }
    this.dropMesh.count = live;
    this.dropMesh.instanceMatrix.needsUpdate = true;
    this.waterMesh.count = liveWater;
    this.waterMesh.instanceMatrix.needsUpdate = true;
  }
}
