import * as THREE from 'three';

/**
 * Reflection environment generated from a tiny proxy of the room, so reflections on glaze, glass
 * and plastic match the actual light sources: the monitor (cool, bright, in front), the window
 * (dim blue, behind it), the warm overhead light, and dark walls everywhere else.
 * Built once at start-up; nothing is downloaded.
 */
export function createRoomEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(4, 3, 4),
    new THREE.MeshBasicMaterial({ color: 0x0a0b0d, side: THREE.BackSide }),
  );
  box.position.set(0, 1.2, 0.6);
  env.add(box);

  const panel = (w: number, h: number, color: THREE.ColorRepresentation, intensity: number, pos: THREE.Vector3, look: THREE.Vector3) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.copy(pos);
    m.lookAt(look);
    env.add(m);
  };
  const origin = new THREE.Vector3(0, 0.8, -0.3);
  panel(0.53, 0.3, 0xcfe0ff, 6, new THREE.Vector3(0, 1.06, -0.56), origin); // monitor
  panel(1.9, 1.15, 0x24324c, 1.2, new THREE.Vector3(0, 1.5, -0.9), origin); // window
  panel(0.35, 0.35, 0xffc995, 10, new THREE.Vector3(0.32, 2.4, 0.05), origin); // overhead downlight
  panel(0.6, 0.02, 0xffffff, 3, new THREE.Vector3(-0.6, 2.4, 0.8), origin); // a corridor strip light behind her

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.02, 0.05, 20);
  pmrem.dispose();
  env.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return target.texture;
}
