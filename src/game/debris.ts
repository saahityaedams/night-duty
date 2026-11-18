import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';

/**
 * Settled-debris batching.
 * Each shard is its own mesh while it moves. Once its body has been asleep for a moment, it is
 * drawn as part of one merged mesh per glaze material instead (two draw calls per glaze: glazed
 * faces and broken edges), so a desk full of debris stays cheap. The physics body stays, so new
 * debris still lands on old debris. If a merged shard is knocked awake, it becomes its own mesh
 * again until it settles.
 */

interface Entry {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  glaze: THREE.Material;
  asleepFor: number;
  merged: boolean;
}

const SETTLE_SECONDS = 0.6;
const REBUILD_DELAY = 0.25;

export class Debris {
  private readonly entries: Entry[] = [];
  private readonly batches = new Map<THREE.Material, THREE.Mesh>();
  private dirty = new Set<THREE.Material>();
  private rebuildIn = -1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly edgeMaterial: THREE.Material,
  ) {}

  add(mesh: THREE.Mesh, body: RAPIER.RigidBody, glaze: THREE.Material): void {
    this.entries.push({ mesh, body, glaze, asleepFor: 0, merged: false });
  }

  get count(): number {
    return this.entries.length;
  }

  /** Removes and returns the oldest entries beyond `max` (caller removes their bodies). */
  trim(max: number): { mesh: THREE.Mesh; body: RAPIER.RigidBody }[] {
    const out: Entry[] = [];
    while (this.entries.length > max) out.push(this.entries.shift()!);
    for (const e of out) {
      if (e.merged) this.markDirty(e.glaze);
      this.scene.remove(e.mesh);
    }
    return out;
  }

  update(dt: number): void {
    for (const e of this.entries) {
      const asleep = e.body.isSleeping();
      if (!e.merged) {
        e.asleepFor = asleep ? e.asleepFor + dt : 0;
        if (e.asleepFor > SETTLE_SECONDS) {
          e.merged = true;
          this.markDirty(e.glaze);
        }
      } else if (!asleep) {
        // Knocked loose: back to an individual mesh.
        e.merged = false;
        e.asleepFor = 0;
        e.mesh.visible = true;
        this.markDirty(e.glaze);
      }
    }
    if (this.rebuildIn >= 0) {
      this.rebuildIn -= dt;
      if (this.rebuildIn < 0) this.rebuild();
    }
  }

  private markDirty(glaze: THREE.Material): void {
    this.dirty.add(glaze);
    if (this.rebuildIn < 0) this.rebuildIn = REBUILD_DELAY;
  }

  private rebuild(): void {
    for (const glaze of this.dirty) {
      const members = this.entries.filter((e) => e.merged && e.glaze === glaze);
      const old = this.batches.get(glaze);
      if (old) {
        this.scene.remove(old);
        old.geometry.dispose();
        this.batches.delete(glaze);
      }
      if (!members.length) continue;
      const geometry = mergeTwoGroups(members.map((e) => e.mesh));
      const batch = new THREE.Mesh(geometry, [glaze, this.edgeMaterial]);
      batch.castShadow = true;
      batch.receiveShadow = true;
      batch.matrixAutoUpdate = false;
      this.scene.add(batch);
      this.batches.set(glaze, batch);
      for (const e of members) e.mesh.visible = false;
    }
    this.dirty.clear();
  }
}

/**
 * Merges meshes whose geometry has group 0 (glaze) and optional group 1 (edge) into one
 * non-indexed geometry with the same two groups, baking each mesh's world transform.
 */
function mergeTwoGroups(meshes: THREE.Mesh[]): THREE.BufferGeometry {
  const glazePos: number[] = [];
  const glazeNor: number[] = [];
  const edgePos: number[] = [];
  const edgeNor: number[] = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const mesh of meshes) {
    mesh.updateMatrixWorld();
    nm.getNormalMatrix(mesh.matrixWorld);
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    for (const grp of groups) {
      const tp = grp.materialIndex === 1 ? edgePos : glazePos;
      const tn = grp.materialIndex === 1 ? edgeNor : glazeNor;
      // Groups on non-indexed geometry count vertices; on converted indexed ones they count indices,
      // which equal vertices after toNonIndexed.
      const end = Math.min(pos.count, grp.start + grp.count);
      for (let i = grp.start; i < end; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        tp.push(v.x, v.y, v.z);
        tn.push(n.x, n.y, n.z);
      }
    }
    if (g !== mesh.geometry) g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...glazePos, ...edgePos], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([...glazeNor, ...edgeNor], 3));
  geo.addGroup(0, glazePos.length / 3, 0);
  geo.addGroup(glazePos.length / 3, edgePos.length / 3, 1);
  geo.computeBoundingSphere();
  return geo;
}
