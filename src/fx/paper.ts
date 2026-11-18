import * as THREE from 'three';
import type { GroundQuery } from './particles';

/**
 * Paper storms: sheets burst out of files and printers and flutter down.
 * Each sheet is an instanced, double-sided A4 quad with simple aerodynamics: strong drag, a
 * side-to-side glide that follows its tilt, and tumbling. Landed sheets lie flat and stay.
 */

interface Sheet {
  p: THREE.Vector3;
  v: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  phase: number;
  landed: boolean;
  tilt: number;
}

const MAX = 260;
const A4 = { w: 0.21, h: 0.297 };

function sheetTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 362;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3f1ea';
  g.fillRect(0, 0, 256, 362);
  g.fillStyle = '#2b2b2b';
  g.fillRect(40, 26, 176, 9);
  g.fillStyle = '#7a7a7a';
  for (let y = 60; y < 340; y += 14) g.fillRect(24, y, 120 + ((y * 37) % 88), 2);
  g.strokeStyle = '#999';
  g.strokeRect(20, 50, 216, 290);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class PaperStorm {
  readonly mesh: THREE.InstancedMesh;
  private readonly sheets: Sheet[] = [];
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private landedCount = 0;

  constructor(private readonly ground: GroundQuery) {
    const geo = new THREE.PlaneGeometry(A4.w, A4.h, 2, 2);
    geo.rotateX(-Math.PI / 2);
    // A slight curl so sheets aren't perfectly flat cards.
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, Math.abs(pos.getX(i)) * 0.04);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: sheetTexture(), side: THREE.DoubleSide, roughness: 0.92 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  get landed(): number {
    return this.landedCount;
  }

  /** A burst of `count` sheets from `at`, thrown with `vel` plus a spread. */
  burst(at: THREE.Vector3, vel: THREE.Vector3, count: number, spread = 1.6): void {
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.3, Math.random() - 0.5).normalize();
      const sheet: Sheet = {
        p: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.08, Math.random() * 0.05, (Math.random() - 0.5) * 0.08)),
        v: vel.clone().multiplyScalar(0.4).addScaledVector(dir, spread * (0.4 + Math.random())),
        rot: new THREE.Euler((Math.random() - 0.5) * 2, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 2),
        spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6),
        phase: Math.random() * Math.PI * 2,
        landed: false,
        tilt: 0,
      };
      if (this.sheets.length < MAX) this.sheets.push(sheet);
      else {
        if (this.sheets[this.next].landed) this.landedCount--;
        this.sheets[this.next] = sheet;
      }
      this.next = (this.next + 1) % MAX;
    }
    this.mesh.count = this.sheets.length;
  }

  update(dt: number, time: number): void {
    if (dt <= 0 || !this.sheets.length) return;
    let changed = false;
    for (let i = 0; i < this.sheets.length; i++) {
      const sh = this.sheets[i];
      if (!sh.landed) {
        changed = true;
        // Gravity against heavy drag: paper reaches ~0.6 m/s terminal speed.
        sh.v.y -= 9.81 * dt;
        sh.v.multiplyScalar(Math.exp(-dt * 4.5));
        // Side-to-side glide and flutter.
        const flutter = Math.sin(time * 3.2 + sh.phase);
        sh.v.x += Math.cos(sh.rot.y) * flutter * dt * 2.2;
        sh.v.z += Math.sin(sh.rot.y) * flutter * dt * 2.2;
        sh.p.addScaledVector(sh.v, dt);
        sh.rot.x += sh.spin.x * dt + flutter * dt * 1.5;
        sh.rot.y += sh.spin.y * dt;
        sh.rot.z += sh.spin.z * dt;
        sh.spin.multiplyScalar(Math.exp(-dt * 0.8));
        const g = this.ground(sh.p.x, sh.p.z, sh.p.y);
        if (sh.p.y <= g + 0.002) {
          sh.landed = true;
          this.landedCount++;
          sh.p.y = g + 0.001 + Math.random() * 0.002; // stacked sheets don't z-fight
          sh.rot.set(0, sh.rot.y, 0);
        }
      }
      this.q.setFromEuler(sh.rot);
      this.m.compose(sh.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
