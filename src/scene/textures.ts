import * as THREE from 'three';

const loader = new THREE.TextureLoader();
let maxAnisotropy = 4;

export function setMaxAnisotropy(renderer: THREE.WebGLRenderer): void {
  maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
}

/** Each material gets its own texture objects (repeat differs); the browser HTTP cache dedupes downloads. */
function load(url: string, color: boolean): THREE.Texture {
  const tex = loader.load(url);
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export interface PbrOptions {
  repeat?: [number, number];
  rotation?: number;
  color?: THREE.ColorRepresentation;
  normalScale?: number;
  roughnessScale?: number;
}

/** A scanned PBR material from public/textures/<name>/ (diffuse, OpenGL normal, roughness). */
export function pbrMaterial(name: string, opts: PbrOptions = {}): THREE.MeshStandardMaterial {
  const base = `${import.meta.env.BASE_URL}textures/${name}/`;
  const maps = {
    map: load(`${base}diffuse_1k.jpg`, true),
    normalMap: load(`${base}nor_gl_1k.jpg`, false),
    roughnessMap: load(`${base}rough_1k.jpg`, false),
  };
  for (const t of Object.values(maps)) {
    t.repeat.set(...(opts.repeat ?? [1, 1]));
    t.rotation = opts.rotation ?? 0;
    t.center.set(0.5, 0.5);
  }
  return new THREE.MeshStandardMaterial({
    ...maps,
    color: opts.color ?? 0xffffff,
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
    roughness: opts.roughnessScale ?? 1,
    metalness: 0,
  });
}
