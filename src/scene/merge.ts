import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merges static meshes under `root` that share a material and shadow flags into one mesh each,
 * so a room built from dozens of boxes costs a handful of draw calls.
 * Skips meshes with array materials, instanced meshes, and anything marked
 * `userData.noMerge` (or under such a parent).
 */
export function mergeStatic(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; meshes: THREE.Mesh[] }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    for (let p: THREE.Object3D | null = m; p && p !== root; p = p.parent) if (p.userData.noMerge) return;
    const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { material: m.material, cast: m.castShadow, receive: m.receiveShadow, meshes: [] }));
    g.meshes.push(m);
  });
  for (const g of groups.values()) {
    if (g.meshes.length < 2) continue;
    const geos = g.meshes.map((m) => {
      const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()) as THREE.BufferGeometry;
      // Keep only attributes every mesh has, so merging can't fail on a stray attribute.
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      return geo;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, g.material);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    root.add(mesh);
    for (const m of g.meshes) m.removeFromParent();
  }
}
